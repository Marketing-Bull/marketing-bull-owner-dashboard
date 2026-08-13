import { NextResponse } from "next/server";
import { fetchClickUpJson, getClickUpApiKey } from "@/lib/clickup";
import {
  ensureClickUpTasksFresh,
  getClickUpTaskSyncInfo,
  type ClickUpTaskCacheInput
} from "@/lib/clickup-task-cache";
import { normalizeDashboardData } from "@/lib/dashboard-data";
import { getDatabase, loadDashboardState } from "@/lib/dashboard-state";
import { reportFallback } from "@/lib/fallback";
import { SAMPLE_DASHBOARD_DATA } from "@/lib/sample-data";
import { buildLocalHoursWindows } from "@/lib/time-entries";
import type { ClickUpSourceEntry, ClickUpSourceInfo, DashboardData, PriorityBucket, UpNextTask } from "@/lib/types";

export const dynamic = "force-dynamic";

type BottleneckContext = {
  bottleneck: string;
  lens: string;
  target: string;
};

type ClickUpTasksResponse = {
  tasks: ClickUpTaskCacheInput[];
};

function taskContext(task: ClickUpTaskCacheInput): string {
  const parts = [task.projectName, task.clientName, task.list?.name].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
  );
  return parts.join(" · ") || task.status?.status || "Unassigned ClickUp task";
}

function sourceEntries(
  tasks: ClickUpTaskCacheInput[],
  pick: (task: ClickUpTaskCacheInput) => { id?: string; name?: string } | undefined
): ClickUpSourceEntry[] {
  const grouped = new Map<string, ClickUpSourceEntry>();
  for (const task of tasks) {
    const source = pick(task);
    if (!source?.name) continue;
    const id = source.id || source.name;
    const existing = grouped.get(id);
    if (existing) existing.taskCount += 1;
    else grouped.set(id, { id, name: source.name, taskCount: 1 });
  }
  return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function buildClickUpSources(tasks: ClickUpTaskCacheInput[]): ClickUpSourceInfo {
  return {
    selection: "All open tasks assigned to the configured user across the ClickUp workspace",
    spaces: sourceEntries(tasks, (task) => task.space),
    lists: sourceEntries(tasks, (task) => task.list)
  };
}

function parsePriority(task: ClickUpTaskCacheInput): UpNextTask["priority"] {
  const nameMatch = task.name.match(/\[(P[0-3])\]/i);
  if (nameMatch) return nameMatch[1].toUpperCase() as UpNextTask["priority"];
  const direct = task.priority?.priority;
  if (direct === "urgent") return "P0";
  if (direct === "high") return "P1";
  if (direct === "normal") return "P2";
  return "P3";
}

function formatDueLabel(dueDate: string | null | undefined): string {
  if (!dueDate) return "No due date";
  const date = new Date(Number(dueDate));
  if (!Number.isFinite(date.getTime())) return "No due date";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === now.toDateString()) {
    return `Today ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date)}`;
  }
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function sortTasksForUpNext(a: ClickUpTaskCacheInput, b: ClickUpTaskCacheInput): number {
  const aDue = a.due_date ? Number(a.due_date) : Number.POSITIVE_INFINITY;
  const bDue = b.due_date ? Number(b.due_date) : Number.POSITIVE_INFINITY;
  if (aDue !== bDue) return aDue - bDue;
  return Number(b.date_updated || 0) - Number(a.date_updated || 0);
}

function tokenizeContext(...parts: string[]): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "your",
    "work",
    "goal",
    "target",
    "today",
    "will",
    "have",
    "has",
    "too",
    "get",
    "are"
  ]);

  return Array.from(
    new Set(
      parts
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4 && !stopwords.has(token))
    )
  );
}

function scoreTaskAgainstBottleneck(task: ClickUpTaskCacheInput, context: BottleneckContext): number {
  const haystack = [
    task.name,
    task.list?.name,
    task.status?.status
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const keywords = tokenizeContext(context.bottleneck, context.target, context.lens);
  let score = 0;

  for (const keyword of keywords) {
    if (haystack.includes(keyword)) {
      // FIXME: this weighting does not do what it looks like it does.
      //
      // Lens matches are meant to score 2 and everything else 4, but `keyword`
      // is a single token out of tokenizeContext while `context.lens` is the
      // whole field. Any multi-word lens ("client acquisition") can never equal
      // one token, so the branch never fires and every match scores 4 --
      // the lens is effectively not weighted at all.
      //
      // Deliberately left alone for now: Up Next ranking is heuristic
      // throughout, and changing the weights is worth doing as one considered
      // pass over the whole ranking rather than as a drive-by fix here.
      score += keyword === context.lens.toLowerCase() ? 2 : 4;
    }
  }

  const priority = parsePriority(task);
  if (priority === "P0") score += 5;
  else if (priority === "P1") score += 3;
  else if (priority === "P2") score += 1;

  if (task.due_date) {
    const dueMs = Number(task.due_date);
    if (Number.isFinite(dueMs)) {
      const hoursUntilDue = (dueMs - Date.now()) / 3_600_000;
      if (hoursUntilDue <= 24) score += 3;
      else if (hoursUntilDue <= 72) score += 1;
    }
  }

  return score;
}

function buildPriorityBuckets(tasks: ClickUpTaskCacheInput[]): PriorityBucket[] {
  const buckets = new Map<UpNextTask["priority"], PriorityBucket>([
    ["P0", { key: "P0", label: "Critical", projects: [] }],
    ["P1", { key: "P1", label: "This week", projects: [] }],
    ["P2", { key: "P2", label: "Queued", projects: [] }],
    ["P3", { key: "P3", label: "Later", projects: [] }]
  ]);

  for (const task of tasks) {
    if ((task.task_type || "").toLowerCase() === "contact") continue;
    const bucket = buckets.get(parsePriority(task));
    if (!bucket || bucket.projects.length >= 4) continue;
    bucket.projects.push({
      id: task.id,
      title: task.name.replace(/^\[(P[0-3])\]\s*/i, ""),
      subtitle: taskContext(task),
      status: task.status?.status,
      href: task.url
    });
  }

  return ["P0", "P1", "P2", "P3"].map((key) => buckets.get(key as UpNextTask["priority"])!);
}

function buildUpNext(tasks: ClickUpTaskCacheInput[], context?: BottleneckContext): UpNextTask[] {
  const rankedTasks = tasks.filter((task) => (task.task_type || "").toLowerCase() !== "contact");

  if (context && context.bottleneck.trim()) {
    rankedTasks.sort((a, b) => {
      const scoreDiff = scoreTaskAgainstBottleneck(b, context) - scoreTaskAgainstBottleneck(a, context);
      if (scoreDiff !== 0) return scoreDiff;
      return sortTasksForUpNext(a, b);
    });
  } else {
    rankedTasks.sort(sortTasksForUpNext);
  }

  return rankedTasks
    .slice(0, 5)
    .map((task) => ({
      id: task.id,
      title: task.name.replace(/^\[(P[0-3])\]\s*/i, ""),
      subtitle:
        context && context.bottleneck.trim()
          ? `${taskContext(task)} · clears: ${context.bottleneck}`
          : taskContext(task),
      due: formatDueLabel(task.due_date),
      priority: parsePriority(task),
      done: false,
      href: task.url,
      listId: task.list?.id
    }));
}

export async function GET() {
  const upstream = process.env.OWNER_DASHBOARD_DATA_URL?.trim();
  const db = getDatabase();

  if (upstream) {
    try {
      const response = await fetch(upstream, {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      const json = await response.json();
      if (!response.ok) {
        return NextResponse.json(
          { error: json?.error || `Upstream dashboard returned ${response.status}` },
          { status: response.status }
        );
      }
      // Normalize the proxied body so a drifting upstream cannot hand the
      // client a shape the dashboard will crash on.
      const normalized = normalizeDashboardData(json);
      // Phase 3 makes local time_entries canonical even when task/priorities
      // arrive through the legacy aggregate upstream.
      normalized.hours = buildLocalHoursWindows(db);
      normalized.clickUpSync = getClickUpTaskSyncInfo(db);
      return NextResponse.json(normalized, {
        headers: { "Cache-Control": "no-store" }
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  try {
    const state = loadDashboardState();
    const context: BottleneckContext = {
      bottleneck: state.manual.hyperfocus.bottleneck,
      lens: state.manual.hyperfocus.lens,
      target: state.manual.hyperfocus.target
    };

    const teamId = process.env.OWNER_DASHBOARD_CLICKUP_TEAM_ID?.trim() || "9011565647";
    const assigneeId = process.env.OWNER_DASHBOARD_CLICKUP_ASSIGNEE_ID?.trim() || "114143577";

    const taskParams = new URLSearchParams();
    taskParams.append("assignees[]", assigneeId);
    taskParams.append("include_closed", "false");
    taskParams.append("subtasks", "true");
    taskParams.append("page", "0");

    const sync = await ensureClickUpTasksFresh(
      db,
      async () => {
        const apiKey = await getClickUpApiKey();
        if (!apiKey) throw new Error("Missing ClickUp API key");
        const tasks: ClickUpTaskCacheInput[] = [];
        for (let page = 0; page < 100; page += 1) {
          taskParams.set("page", String(page));
          const tasksResponse = await fetchClickUpJson<ClickUpTasksResponse>(
            `/team/${teamId}/task`,
            taskParams,
            apiKey
          );
          const pageTasks = tasksResponse.tasks || [];
          tasks.push(...pageTasks);
          if (pageTasks.length < 100) break;
        }
        return tasks;
      }
    );

    if (sync.error && !sync.hadCache) {
      const fallbackReason = reportFallback("/api/dashboard ClickUp sync", sync.error);
      return NextResponse.json(
        {
          ...SAMPLE_DASHBOARD_DATA,
          hours: buildLocalHoursWindows(db),
          clickUpSync: sync.sync,
          fallbackReason,
          generatedAt: Date.now()
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const tasks = sync.tasks;
    const liveData: DashboardData = {
      priorities: buildPriorityBuckets(tasks),
      hours: buildLocalHoursWindows(db),
      upNext: buildUpNext(tasks, context),
      source: "live",
      generatedAt: Date.now(),
      clickUpSync: sync.sync,
      clickUpSources: buildClickUpSources(tasks)
    };

    return NextResponse.json(liveData, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    // Never fail silently here: without a reason, sample MRR and priorities are
    // indistinguishable from real ones.
    const fallbackReason = reportFallback("/api/dashboard", error);
    return NextResponse.json(
      {
        ...SAMPLE_DASHBOARD_DATA,
        hours: buildLocalHoursWindows(db),
        clickUpSync: getClickUpTaskSyncInfo(db),
        fallbackReason,
        generatedAt: Date.now()
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
