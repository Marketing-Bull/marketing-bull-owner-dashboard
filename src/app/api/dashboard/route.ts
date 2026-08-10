import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { normalizeDashboardData } from "@/lib/dashboard-data";
import { loadDashboardState } from "@/lib/dashboard-state";
import { reportFallback } from "@/lib/fallback";
import { SAMPLE_DASHBOARD_DATA } from "@/lib/sample-data";
import type { DashboardData, HoursEntry, PriorityBucket, UpNextTask } from "@/lib/types";

export const dynamic = "force-dynamic";

type SecretsFile = {
  env?: {
    CLICKUP_API_KEY?: string;
  };
};

type ClickUpTask = {
  id: string;
  name: string;
  url?: string;
  due_date?: string | null;
  date_updated?: string;
  priority?: {
    priority?: string | null;
  } | null;
  status?: {
    status?: string;
  };
  list?: {
    name?: string;
  };
  task_type?: string | null;
};

type ClickUpTimeEntry = {
  duration?: string;
  task?: {
    list?: {
      name?: string;
    };
    name?: string;
  };
};

type BottleneckContext = {
  bottleneck: string;
  lens: string;
  target: string;
};

function startOfCurrentWeek(): Date {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function parsePriority(task: ClickUpTask): UpNextTask["priority"] {
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

function sortTasksForUpNext(a: ClickUpTask, b: ClickUpTask): number {
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

function scoreTaskAgainstBottleneck(task: ClickUpTask, context: BottleneckContext): number {
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

function buildPriorityBuckets(tasks: ClickUpTask[]): PriorityBucket[] {
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
      subtitle: task.list?.name || task.status?.status || "ClickUp",
      status: task.status?.status,
      href: task.url
    });
  }

  return ["P0", "P1", "P2", "P3"].map((key) => buckets.get(key as UpNextTask["priority"])!);
}

function buildUpNext(tasks: ClickUpTask[], context?: BottleneckContext): UpNextTask[] {
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
          ? `${task.list?.name || task.status?.status || "ClickUp"} · clears: ${context.bottleneck}`
          : task.list?.name || task.status?.status || "ClickUp",
      due: formatDueLabel(task.due_date),
      priority: parsePriority(task),
      done: false,
      href: task.url
    }));
}

function buildHours(entries: ClickUpTimeEntry[]): HoursEntry[] {
  const grouped = new Map<string, number>();
  for (const entry of entries) {
    const key = entry.task?.list?.name || entry.task?.name || "Other";
    const hours = Number(entry.duration || 0) / 3_600_000;
    if (!Number.isFinite(hours) || hours <= 0) continue;
    grouped.set(key, (grouped.get(key) || 0) + hours);
  }
  return [...grouped.entries()]
    .map(([label, hours]) => ({ label, hours: Number(hours.toFixed(1)) }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 6);
}

async function getClickUpApiKey(): Promise<string | null> {
  const raw = await readFile(join(homedir(), ".openclaw", "secrets.json"), "utf8");
  const secrets = JSON.parse(raw) as SecretsFile;
  return secrets.env?.CLICKUP_API_KEY?.trim() || null;
}

async function fetchClickUpJson<T>(path: string, params: URLSearchParams, apiKey: string): Promise<T> {
  const url = `https://api.clickup.com/api/v2${path}?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`ClickUp returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function GET() {
  const upstream = process.env.OWNER_DASHBOARD_DATA_URL?.trim();

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
      return NextResponse.json(normalizeDashboardData(json), {
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
    const apiKey = await getClickUpApiKey();
    if (!apiKey) throw new Error("Missing ClickUp API key");
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

    const [tasksResponse, weekTimeResponse, monthTimeResponse] = await Promise.all([
      fetchClickUpJson<{ tasks: ClickUpTask[] }>(`/team/${teamId}/task`, taskParams, apiKey),
      fetchClickUpJson<{ data: ClickUpTimeEntry[] }>(
        `/team/${teamId}/time_entries`,
        new URLSearchParams({
          start_date: String(startOfCurrentWeek().getTime()),
          end_date: String(Date.now()),
          assignee: assigneeId
        }),
        apiKey
      ),
      fetchClickUpJson<{ data: ClickUpTimeEntry[] }>(
        `/team/${teamId}/time_entries`,
        new URLSearchParams({
          start_date: String(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).getTime()),
          end_date: String(Date.now()),
          assignee: assigneeId
        }),
        apiKey
      )
    ]);

    const tasks = tasksResponse.tasks || [];
    const liveData: DashboardData = {
      priorities: buildPriorityBuckets(tasks),
      hours: {
        week: buildHours(weekTimeResponse.data || []),
        month: buildHours(monthTimeResponse.data || [])
      },
      upNext: buildUpNext(tasks, context),
      source: "live",
      generatedAt: Date.now()
    };

    return NextResponse.json(liveData, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    // Never fail silently here: without a reason, sample MRR and priorities are
    // indistinguishable from real ones.
    const fallbackReason = reportFallback("/api/dashboard", error);
    return NextResponse.json(
      { ...SAMPLE_DASHBOARD_DATA, fallbackReason, generatedAt: Date.now() },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
