import type { DatabaseSync } from "node:sqlite";
import { describeError } from "@/lib/fallback";
import type { ClickUpSyncInfo } from "@/lib/types";

export const CLICKUP_TASK_SYNC_SOURCE = "assigned_tasks";
export const CLICKUP_TASK_SYNC_STALE_MS = 60 * 60 * 1000;

export type ClickUpTaskCacheInput = {
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
    id?: string;
    name?: string;
  };
  task_type?: string | null;
};

type SyncRow = {
  source: string;
  last_synced_at: string | null;
  last_attempted_at: string | null;
  status: string;
  error: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  name: string;
  url: string | null;
  due_date: string | null;
  date_updated: string | null;
  priority: string | null;
  status: string | null;
  list_id: string | null;
  list_name: string | null;
  task_type: string | null;
  raw_json: string;
  synced_at: string;
};

export type ClickUpTaskSyncResult = {
  tasks: ClickUpTaskCacheInput[];
  sync: ClickUpSyncInfo;
  error: string | null;
  hadCache: boolean;
};

function nowIso(now: Date): string {
  return now.toISOString();
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function syncRowToInfo(row: SyncRow | null, refreshed: boolean, now: Date, error?: string): ClickUpSyncInfo {
  return {
    lastSyncedAt: row?.last_synced_at ?? null,
    lastAttemptedAt: row?.last_attempted_at ?? null,
    stale: isClickUpTaskSyncStale(row, now),
    refreshed,
    error: error || row?.error || undefined
  };
}

function taskRowToInput(row: TaskRow): ClickUpTaskCacheInput {
  return {
    id: row.id,
    name: row.name,
    url: row.url ?? undefined,
    due_date: row.due_date,
    date_updated: row.date_updated ?? undefined,
    priority: row.priority ? { priority: row.priority } : null,
    status: row.status ? { status: row.status } : undefined,
    list:
      row.list_id || row.list_name
        ? {
            id: row.list_id ?? undefined,
            name: row.list_name ?? undefined
          }
        : undefined,
    task_type: row.task_type
  };
}

export function getClickUpTaskSyncRow(db: DatabaseSync): SyncRow | null {
  const row = db
    .prepare("SELECT * FROM clickup_sync_state WHERE source = ?")
    .get(CLICKUP_TASK_SYNC_SOURCE) as SyncRow | undefined;
  return row ?? null;
}

export function isClickUpTaskSyncStale(row: SyncRow | null, now: Date = new Date()): boolean {
  if (!row?.last_synced_at) return true;
  const syncedAt = Date.parse(row.last_synced_at);
  if (!Number.isFinite(syncedAt)) return true;
  return now.getTime() - syncedAt > CLICKUP_TASK_SYNC_STALE_MS;
}

export function getClickUpTaskSyncInfo(db: DatabaseSync, now: Date = new Date()): ClickUpSyncInfo {
  return syncRowToInfo(getClickUpTaskSyncRow(db), false, now);
}

export function listCachedClickUpTasks(db: DatabaseSync): ClickUpTaskCacheInput[] {
  const rows = db
    .prepare(
      `SELECT * FROM clickup_tasks
       ORDER BY
         CASE WHEN due_date IS NULL OR due_date = '' THEN 1 ELSE 0 END,
         CAST(due_date AS INTEGER),
         CAST(date_updated AS INTEGER) DESC,
         name COLLATE NOCASE`
    )
    .all() as TaskRow[];
  return rows.map(taskRowToInput);
}

export function replaceCachedClickUpTasks(
  db: DatabaseSync,
  tasks: ClickUpTaskCacheInput[],
  syncedAt: Date = new Date()
): void {
  const syncedAtIso = nowIso(syncedAt);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM clickup_tasks").run();
    const insert = db.prepare(`
      INSERT INTO clickup_tasks (
        id, name, url, due_date, date_updated, priority, status, list_id, list_name,
        task_type, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const task of tasks) {
      if (!task.id || !task.name) continue;
      insert.run(
        task.id,
        task.name,
        optionalText(task.url),
        optionalText(task.due_date),
        optionalText(task.date_updated),
        optionalText(task.priority?.priority),
        optionalText(task.status?.status),
        optionalText(task.list?.id),
        optionalText(task.list?.name),
        optionalText(task.task_type),
        JSON.stringify(task),
        syncedAtIso
      );
    }

    db.prepare(`
      INSERT INTO clickup_sync_state (
        source, last_synced_at, last_attempted_at, status, error, updated_at
      ) VALUES (?, ?, ?, 'success', '', ?)
      ON CONFLICT(source) DO UPDATE SET
        last_synced_at = excluded.last_synced_at,
        last_attempted_at = excluded.last_attempted_at,
        status = excluded.status,
        error = excluded.error,
        updated_at = excluded.updated_at
    `).run(CLICKUP_TASK_SYNC_SOURCE, syncedAtIso, syncedAtIso, syncedAtIso);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordClickUpTaskSyncFailure(
  db: DatabaseSync,
  error: unknown,
  attemptedAt: Date = new Date()
): string {
  const message = describeError(error);
  const attemptedAtIso = nowIso(attemptedAt);
  db.prepare(`
    INSERT INTO clickup_sync_state (
      source, last_synced_at, last_attempted_at, status, error, updated_at
    ) VALUES (?, NULL, ?, 'error', ?, ?)
    ON CONFLICT(source) DO UPDATE SET
      last_attempted_at = excluded.last_attempted_at,
      status = excluded.status,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run(CLICKUP_TASK_SYNC_SOURCE, attemptedAtIso, message, attemptedAtIso);
  return message;
}

export function deleteCachedClickUpTask(db: DatabaseSync, taskId: string): void {
  db.prepare("DELETE FROM clickup_tasks WHERE id = ?").run(taskId);
}

export async function ensureClickUpTasksFresh(
  db: DatabaseSync,
  fetchTasks: () => Promise<ClickUpTaskCacheInput[]>,
  now: Date = new Date()
): Promise<ClickUpTaskSyncResult> {
  const before = getClickUpTaskSyncRow(db);
  if (!isClickUpTaskSyncStale(before, now)) {
    return {
      tasks: listCachedClickUpTasks(db),
      sync: syncRowToInfo(before, false, now),
      error: null,
      hadCache: Boolean(before?.last_synced_at)
    };
  }

  try {
    const tasks = await fetchTasks();
    replaceCachedClickUpTasks(db, tasks, now);
    const after = getClickUpTaskSyncRow(db);
    return {
      tasks: listCachedClickUpTasks(db),
      sync: syncRowToInfo(after, true, now),
      error: null,
      hadCache: true
    };
  } catch (error) {
    const message = recordClickUpTaskSyncFailure(db, error, now);
    const after = getClickUpTaskSyncRow(db);
    return {
      tasks: listCachedClickUpTasks(db),
      sync: syncRowToInfo(after, false, now, message),
      error: message,
      hadCache: Boolean(before?.last_synced_at)
    };
  }
}
