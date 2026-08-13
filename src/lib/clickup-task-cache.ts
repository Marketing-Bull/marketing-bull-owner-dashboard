import type { DatabaseSync } from "node:sqlite";
import { describeError } from "@/lib/fallback";
import { listClients, listProjects } from "@/lib/entities";
import {
  resolveClickUpTaskAssociation,
  type ClickUpAssociationSource
} from "@/lib/clickup-task-association";
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
  folder?: { id?: string; name?: string };
  space?: { id?: string; name?: string };
  tags?: Array<{ name?: string }>;
  custom_fields?: Array<{
    name?: string;
    value?: unknown;
    type_config?: { options?: Array<{ id?: string | number; name?: string; label?: string }> };
  }>;
  task_type?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  associationSource?: ClickUpAssociationSource;
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
  folder_id: string | null;
  folder_name: string | null;
  space_id: string | null;
  space_name: string | null;
  client_id: string | null;
  client_name: string | null;
  project_id: string | null;
  project_name: string | null;
  association_source: ClickUpAssociationSource | null;
  task_type: string | null;
  raw_json: string;
  synced_at: string;
};

type CachedAssociationRow = Pick<TaskRow, "id" | "name" | "raw_json">;

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
  let raw: ClickUpTaskCacheInput = { id: row.id, name: row.name };
  try {
    raw = JSON.parse(row.raw_json) as ClickUpTaskCacheInput;
  } catch {
    // The selected columns below are the durable fallback for a damaged blob.
  }
  return {
    ...raw,
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
    folder:
      row.folder_id || row.folder_name
        ? { id: row.folder_id ?? undefined, name: row.folder_name ?? undefined }
        : raw.folder,
    space:
      row.space_id || row.space_name
        ? { id: row.space_id ?? undefined, name: row.space_name ?? undefined }
        : raw.space,
    task_type: row.task_type,
    clientId: row.client_id,
    clientName: row.client_name,
    projectId: row.project_id,
    projectName: row.project_name,
    associationSource: row.association_source ?? "none"
  };
}

function cachedAssociationRowToInput(row: CachedAssociationRow): ClickUpTaskCacheInput {
  try {
    return {
      ...(JSON.parse(row.raw_json) as ClickUpTaskCacheInput),
      id: row.id,
      name: row.name
    };
  } catch {
    return { id: row.id, name: row.name };
  }
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

export function reassociateCachedClickUpTasks(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, name, raw_json FROM clickup_tasks").all() as CachedAssociationRow[];
  if (rows.length === 0) return;

  const clients = listClients(db, { includeArchived: true });
  const projects = listProjects(db, { includeArchived: true });
  const update = db.prepare(`
    UPDATE clickup_tasks
    SET client_id = ?, project_id = ?, association_source = ?
    WHERE id = ?
  `);

  for (const row of rows) {
    const association = resolveClickUpTaskAssociation(cachedAssociationRowToInput(row), clients, projects);
    update.run(association.clientId, association.projectId, association.source, row.id);
  }
}

export function listCachedClickUpTasks(db: DatabaseSync): ClickUpTaskCacheInput[] {
  reassociateCachedClickUpTasks(db);
  const rows = db
    .prepare(
      `SELECT t.*, c.name AS client_name, p.name AS project_name
       FROM clickup_tasks t
       LEFT JOIN clients c ON c.id = t.client_id
       LEFT JOIN projects p ON p.id = t.project_id
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
  const clients = listClients(db, { includeArchived: true });
  const projects = listProjects(db, { includeArchived: true });
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM clickup_tasks").run();
    const insert = db.prepare(`
      INSERT INTO clickup_tasks (
        id, name, url, due_date, date_updated, priority, status, list_id, list_name,
        folder_id, folder_name, space_id, space_name, client_id, project_id,
        association_source, task_type, raw_json, synced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const task of tasks) {
      if (!task.id || !task.name) continue;
      const association = resolveClickUpTaskAssociation(task, clients, projects);
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
        optionalText(task.folder?.id),
        optionalText(task.folder?.name),
        optionalText(task.space?.id),
        optionalText(task.space?.name),
        association.clientId,
        association.projectId,
        association.source,
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
