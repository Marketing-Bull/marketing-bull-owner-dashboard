/**
 * Shape-guard for `DashboardData`.
 *
 * `/api/dashboard` can proxy an arbitrary upstream via
 * `OWNER_DASHBOARD_DATA_URL`, and the ClickUp mapping can drift. Without this,
 * one missing field reaches the render as `undefined` and takes the whole page
 * down -- including the manual widgets that never touch this data.
 */

import type {
  ClickUpProject,
  ClickUpSyncInfo,
  DashboardData,
  HoursEntry,
  PriorityBucket,
  UpNextTask
} from "@/lib/types";

const PRIORITY_KEYS = ["P0", "P1", "P2", "P3"] as const;

const BUCKET_LABELS: Record<UpNextTask["priority"], string> = {
  P0: "Critical",
  P1: "This week",
  P2: "Queued",
  P3: "Later"
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asPriority(value: unknown): UpNextTask["priority"] {
  return PRIORITY_KEYS.includes(value as UpNextTask["priority"]) ? (value as UpNextTask["priority"]) : "P3";
}

function normalizeProject(value: unknown, index: number): ClickUpProject {
  const item = asRecord(value);
  return {
    id: asString(item.id) || `project-${index}`,
    title: asString(item.title),
    subtitle: asOptionalString(item.subtitle),
    status: asOptionalString(item.status),
    href: asOptionalString(item.href)
  };
}

function normalizePriorities(value: unknown): PriorityBucket[] {
  const provided = new Map<UpNextTask["priority"], PriorityBucket>();

  if (Array.isArray(value)) {
    for (const entry of value) {
      const bucket = asRecord(entry);
      if (!PRIORITY_KEYS.includes(bucket.key as UpNextTask["priority"])) continue;
      const key = bucket.key as UpNextTask["priority"];
      provided.set(key, {
        key,
        label: asString(bucket.label, BUCKET_LABELS[key]),
        projects: Array.isArray(bucket.projects) ? bucket.projects.map(normalizeProject) : []
      });
    }
  }

  // Always return all four buckets so the quadrant grid keeps its shape.
  return PRIORITY_KEYS.map(
    (key) => provided.get(key) ?? { key, label: BUCKET_LABELS[key], projects: [] }
  );
}

function normalizeHoursEntries(value: unknown): HoursEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const item = asRecord(entry);
      const hours = Number(item.hours);
      return { label: asString(item.label), hours: Number.isFinite(hours) ? hours : 0 };
    })
    .filter((entry) => entry.label !== "");
}

function normalizeUpNext(value: unknown): UpNextTask[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      id: asString(item.id) || `task-${index}`,
      title: asString(item.title),
      subtitle: asOptionalString(item.subtitle),
      due: asString(item.due, "No due date"),
      priority: asPriority(item.priority),
      done: Boolean(item.done),
      href: asOptionalString(item.href),
      listId: asOptionalString(item.listId)
    };
  });
}

function normalizeClickUpSync(value: unknown): ClickUpSyncInfo | undefined {
  const item = asRecord(value);
  if (Object.keys(item).length === 0) return undefined;
  return {
    lastSyncedAt: typeof item.lastSyncedAt === "string" ? item.lastSyncedAt : null,
    lastAttemptedAt: typeof item.lastAttemptedAt === "string" ? item.lastAttemptedAt : null,
    stale: Boolean(item.stale),
    refreshed: Boolean(item.refreshed),
    error: asOptionalString(item.error)
  };
}

export function normalizeDashboardData(value: unknown): DashboardData {
  const root = asRecord(value);
  const hours = asRecord(root.hours);
  const generatedAt = Number(root.generatedAt);

  return {
    priorities: normalizePriorities(root.priorities),
    hours: {
      week: normalizeHoursEntries(hours.week),
      month: normalizeHoursEntries(hours.month)
    },
    upNext: normalizeUpNext(root.upNext),
    source: root.source === "live" ? "live" : "sample",
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : undefined,
    clickUpSync: normalizeClickUpSync(root.clickUpSync),
    fallbackReason: asOptionalString(root.fallbackReason)
  };
}
