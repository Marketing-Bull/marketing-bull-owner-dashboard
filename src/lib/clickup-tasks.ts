/**
 * The Tasks ledger: reading the cached ClickUp tasks the way Time, Expenses,
 * and Mileage read their own rows.
 *
 * ClickUp owns these records; this dashboard owns a cache of them
 * (`clickup_tasks`, migration 004/007). So the query contract here is the same
 * one the transaction ledgers use — validated filters, server-side sort and
 * pagination, filtered totals, facets — while writes stay where they belong:
 * the only mutation is marking a task complete, and that goes to ClickUp.
 *
 * The workspace fetch also lives here rather than inside a route handler, so
 * the dashboard widget and the Tasks screen refresh the same cache the same
 * way instead of each keeping their own copy of the query.
 */

import type { DatabaseSync } from "node:sqlite";
import { fetchClickUpJson, getClickUpApiKey } from "@/lib/clickup";
import {
  ensureClickUpTasksFresh,
  reassociateCachedClickUpTasks,
  type ClickUpTaskCacheInput,
  type ClickUpTaskSyncResult
} from "@/lib/clickup-task-cache";
import {
  addLikeFilter,
  assertRange,
  booleanParam,
  countRows,
  dateParam,
  enumParam,
  facetCounts,
  listParam,
  makePageInfo,
  pageParams,
  sortParams,
  textParam,
  TransactionQueryValidationError,
  type FacetCount,
  type QueryScalar,
  type SortDirection,
  type TransactionQueryResult
} from "@/lib/transaction-query";
import type { ClickUpTaskRecord } from "@/lib/types";

type Row = Record<string, unknown>;

/** Every task row is read through this join so client and project have names. */
const TASK_SOURCE = `clickup_tasks t
  LEFT JOIN clients c ON c.id = t.client_id
  LEFT JOIN projects p ON p.id = t.project_id`;

export const CLICKUP_TASK_SORTS = [
  "due",
  "name",
  "priority",
  "status",
  "list",
  "space",
  "client",
  "project",
  "updated"
] as const;

export type ClickUpTaskSort = (typeof CLICKUP_TASK_SORTS)[number];

/** ClickUp's own priority vocabulary, plus the absence of one. */
export const CLICKUP_PRIORITIES = ["urgent", "high", "normal", "low", "none"] as const;

export const CLICKUP_ASSIGNMENTS = ["assigned", "unassigned"] as const;

export type ClickUpTaskQuery = {
  page: number;
  pageSize: number;
  sort: ClickUpTaskSort;
  direction: SortDirection;
  id?: string;
  search?: string;
  name?: string;
  statuses?: string[];
  priorities?: string[];
  listIds?: string[];
  spaceIds?: string[];
  clientIds?: string[];
  projectIds?: string[];
  assignment?: (typeof CLICKUP_ASSIGNMENTS)[number];
  taskType?: string;
  /** Internal callers only — not parsed from the URL. Case-insensitive. */
  excludeTaskTypes?: string[];
  dueFrom?: string;
  dueTo?: string;
  hasDueDate?: boolean;
  overdue?: boolean;
  updatedFrom?: string;
  updatedTo?: string;
};

export type ClickUpTaskTotals = {
  tasks: number;
  overdue: number;
  dueSoon: number;
  unassigned: number;
};

export type ClickUpTaskGroupFacet = { id: string; name: string; count: number };

export type ClickUpTaskFacets = {
  statuses: FacetCount[];
  priorities: FacetCount[];
  taskTypes: FacetCount[];
  lists: ClickUpTaskGroupFacet[];
  spaces: ClickUpTaskGroupFacet[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDayMs(date: string): number {
  return new Date(`${date}T00:00:00`).getTime();
}

function endOfDayMs(date: string): number {
  return new Date(`${date}T23:59:59.999`).getTime();
}

function optionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function rowToTask(row: Row): ClickUpTaskRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    url: optionalText(row.url),
    dueDate: optionalNumber(row.due_date),
    updatedAt: optionalNumber(row.date_updated),
    priority: optionalText(row.priority),
    status: optionalText(row.status),
    listId: optionalText(row.list_id),
    listName: optionalText(row.list_name),
    folderName: optionalText(row.folder_name),
    spaceId: optionalText(row.space_id),
    spaceName: optionalText(row.space_name),
    clientId: optionalText(row.client_id),
    clientName: optionalText(row.client_display_name),
    projectId: optionalText(row.project_id),
    projectName: optionalText(row.project_display_name),
    associationSource: (optionalText(row.association_source) ?? "none") as ClickUpTaskRecord["associationSource"],
    taskType: optionalText(row.task_type),
    syncedAt: String(row.synced_at ?? "")
  };
}

export function parseClickUpTaskQuery(params: URLSearchParams): ClickUpTaskQuery {
  const query: ClickUpTaskQuery = {
    ...pageParams(params),
    ...sortParams(params, CLICKUP_TASK_SORTS, "due"),
    id: textParam(params, "id", { maxLength: 80 }),
    search: textParam(params, "search"),
    name: textParam(params, "name"),
    statuses: listParam(params, "status"),
    priorities: listParam(params, "priority"),
    listIds: listParam(params, "listId"),
    spaceIds: listParam(params, "spaceId"),
    clientIds: listParam(params, "clientId"),
    projectIds: listParam(params, "projectId"),
    assignment: enumParam(params, "assignment", CLICKUP_ASSIGNMENTS),
    taskType: textParam(params, "taskType", { maxLength: 60 }),
    dueFrom: dateParam(params, "dueFrom"),
    dueTo: dateParam(params, "dueTo"),
    hasDueDate: booleanParam(params, "hasDueDate"),
    overdue: booleanParam(params, "overdue"),
    updatedFrom: dateParam(params, "updatedFrom"),
    updatedTo: dateParam(params, "updatedTo")
  };
  for (const priority of query.priorities ?? []) {
    if (!CLICKUP_PRIORITIES.includes(priority as (typeof CLICKUP_PRIORITIES)[number])) {
      throw new TransactionQueryValidationError(`priority must be one of: ${CLICKUP_PRIORITIES.join(", ")}.`);
    }
  }
  assertRange(query.dueFrom, query.dueTo, "Due date");
  assertRange(query.updatedFrom, query.updatedTo, "Updated date");
  return query;
}

/**
 * `IN (…)` over a column that is sometimes NULL and sometimes the empty
 * string, with "none" standing for both — which is how ClickUp reports a task
 * nobody has prioritised.
 */
function addOptionalInFilter(
  clauses: string[],
  params: QueryScalar[],
  column: string,
  selected: readonly string[] | undefined
): void {
  if (!selected?.length) return;
  const concrete = selected.filter((value) => value !== "none");
  const parts: string[] = [];
  if (concrete.length) {
    parts.push(`LOWER(${column}) IN (${concrete.map(() => "?").join(", ")})`);
    params.push(...concrete.map((value) => value.toLowerCase()));
  }
  if (selected.length !== concrete.length) parts.push(`(${column} IS NULL OR ${column} = '')`);
  clauses.push(`(${parts.join(" OR ")})`);
}

function taskWhere(query: ClickUpTaskQuery, nowMs: number): { where: string; params: QueryScalar[] } {
  const clauses: string[] = [];
  const params: QueryScalar[] = [];
  const dueMs = "CAST(t.due_date AS INTEGER)";
  const hasDue = "t.due_date IS NOT NULL AND t.due_date <> ''";

  if (query.id) { clauses.push("t.id = ?"); params.push(query.id); }
  addLikeFilter(clauses, params, "t.name", query.name);
  addLikeFilter(
    clauses,
    params,
    "t.name || ' ' || COALESCE(t.list_name, '') || ' ' || COALESCE(t.folder_name, '') || ' ' || COALESCE(t.space_name, '') || ' ' || COALESCE(t.status, '') || ' ' || COALESCE(c.name, '') || ' ' || COALESCE(p.name, '')",
    query.search
  );
  addOptionalInFilter(clauses, params, "t.status", query.statuses);
  addOptionalInFilter(clauses, params, "t.priority", query.priorities);
  addOptionalInFilter(clauses, params, "t.list_id", query.listIds);
  addOptionalInFilter(clauses, params, "t.space_id", query.spaceIds);
  addOptionalInFilter(clauses, params, "t.client_id", query.clientIds);
  addOptionalInFilter(clauses, params, "t.project_id", query.projectIds);
  addLikeFilter(clauses, params, "t.task_type", query.taskType);
  if (query.excludeTaskTypes?.length) {
    clauses.push(`LOWER(COALESCE(t.task_type, '')) NOT IN (${query.excludeTaskTypes.map(() => "?").join(", ")})`);
    params.push(...query.excludeTaskTypes.map((value) => value.toLowerCase()));
  }

  if (query.assignment === "assigned") clauses.push("(t.client_id IS NOT NULL OR t.project_id IS NOT NULL)");
  if (query.assignment === "unassigned") clauses.push("(t.client_id IS NULL AND t.project_id IS NULL)");

  if (query.dueFrom) { clauses.push(`${hasDue} AND ${dueMs} >= ?`); params.push(startOfDayMs(query.dueFrom)); }
  if (query.dueTo) { clauses.push(`${hasDue} AND ${dueMs} <= ?`); params.push(endOfDayMs(query.dueTo)); }
  if (query.hasDueDate === true) clauses.push(`(${hasDue})`);
  if (query.hasDueDate === false) clauses.push("(t.due_date IS NULL OR t.due_date = '')");
  if (query.overdue === true) { clauses.push(`${hasDue} AND ${dueMs} < ?`); params.push(nowMs); }
  if (query.overdue === false) { clauses.push(`(t.due_date IS NULL OR t.due_date = '' OR ${dueMs} >= ?)`); params.push(nowMs); }

  if (query.updatedFrom) { clauses.push("CAST(t.date_updated AS INTEGER) >= ?"); params.push(startOfDayMs(query.updatedFrom)); }
  if (query.updatedTo) { clauses.push("CAST(t.date_updated AS INTEGER) <= ?"); params.push(endOfDayMs(query.updatedTo)); }

  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

function groupFacet(
  db: DatabaseSync,
  idColumn: string,
  nameColumn: string,
  where: string,
  params: readonly QueryScalar[]
): ClickUpTaskGroupFacet[] {
  const rows = db
    .prepare(`
      SELECT ${idColumn} AS id, ${nameColumn} AS name, COUNT(*) AS count
      FROM ${TASK_SOURCE}
      ${where || "WHERE 1=1"} AND ${nameColumn} IS NOT NULL AND ${nameColumn} <> ''
      GROUP BY ${idColumn}, ${nameColumn}
      ORDER BY count DESC, name COLLATE NOCASE
      LIMIT 100
    `)
    .all(...params) as Row[];
  return rows.map((row) => ({ id: String(row.id ?? row.name), name: String(row.name), count: Number(row.count) }));
}

export function queryClickUpTasks(
  db: DatabaseSync,
  query: ClickUpTaskQuery,
  now: Date = new Date()
): TransactionQueryResult<ClickUpTaskRecord, ClickUpTaskTotals, ClickUpTaskFacets> {
  const nowMs = now.getTime();
  const { where, params } = taskWhere(query, nowMs);
  const totalItems = countRows(db, TASK_SOURCE, where, params);
  const direction = query.direction.toUpperCase();
  // Undated tasks sort last in either direction: "no due date" is not a date,
  // and burying dated work under it would defeat the point of the column.
  const undatedLast = "CASE WHEN t.due_date IS NULL OR t.due_date = '' THEN 1 ELSE 0 END ASC";
  const priorityRank = "CASE LOWER(COALESCE(t.priority, '')) WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END";
  const orderBy: Record<ClickUpTaskSort, string> = {
    due: `${undatedLast}, CAST(t.due_date AS INTEGER) ${direction}`,
    name: `t.name COLLATE NOCASE ${direction}`,
    priority: `${priorityRank} ${direction}`,
    status: `t.status COLLATE NOCASE ${direction}`,
    list: `t.list_name COLLATE NOCASE ${direction}`,
    space: `t.space_name COLLATE NOCASE ${direction}`,
    client: `c.name COLLATE NOCASE ${direction}`,
    project: `p.name COLLATE NOCASE ${direction}`,
    updated: `CAST(t.date_updated AS INTEGER) ${direction}`
  };

  const rows = db
    .prepare(`
      SELECT t.*, c.name AS client_display_name, p.name AS project_display_name
      FROM ${TASK_SOURCE}
      ${where}
      ORDER BY ${orderBy[query.sort]}, t.name COLLATE NOCASE ASC, t.id ASC
      LIMIT ? OFFSET ?
    `)
    .all(...params, query.pageSize, (query.page - 1) * query.pageSize) as Row[];

  const totals = db
    .prepare(`
      SELECT
        COUNT(*) AS tasks,
        COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date <> '' AND CAST(t.due_date AS INTEGER) < ? THEN 1 ELSE 0 END), 0) AS overdue,
        COALESCE(SUM(CASE WHEN t.due_date IS NOT NULL AND t.due_date <> '' AND CAST(t.due_date AS INTEGER) BETWEEN ? AND ? THEN 1 ELSE 0 END), 0) AS due_soon,
        COALESCE(SUM(CASE WHEN t.client_id IS NULL AND t.project_id IS NULL THEN 1 ELSE 0 END), 0) AS unassigned
      FROM ${TASK_SOURCE}
      ${where}
    `)
    .get(nowMs, nowMs, nowMs + 7 * DAY_MS, ...params) as Row;

  return {
    items: rows.map(rowToTask),
    pageInfo: makePageInfo(query.page, query.pageSize, totalItems),
    filteredTotals: {
      tasks: Number(totals.tasks),
      overdue: Number(totals.overdue),
      dueSoon: Number(totals.due_soon),
      unassigned: Number(totals.unassigned)
    },
    availableFacets: {
      statuses: facetCounts(db, TASK_SOURCE, "t.status", where, params),
      priorities: facetCounts(db, TASK_SOURCE, "COALESCE(NULLIF(t.priority, ''), 'none')", where, params),
      taskTypes: facetCounts(db, TASK_SOURCE, "t.task_type", where, params),
      lists: groupFacet(db, "t.list_id", "t.list_name", where, params),
      spaces: groupFacet(db, "t.space_id", "t.space_name", where, params)
    }
  };
}

type ClickUpTasksResponse = { tasks: ClickUpTaskCacheInput[] };

/** All open tasks assigned to the configured user, paged out of ClickUp. */
export async function fetchAssignedClickUpTasks(): Promise<ClickUpTaskCacheInput[]> {
  const apiKey = await getClickUpApiKey();
  if (!apiKey) throw new Error("Missing ClickUp API key");
  const teamId = process.env.OWNER_DASHBOARD_CLICKUP_TEAM_ID?.trim() || "9011565647";
  const assigneeId = process.env.OWNER_DASHBOARD_CLICKUP_ASSIGNEE_ID?.trim() || "114143577";

  const params = new URLSearchParams();
  params.append("assignees[]", assigneeId);
  params.append("include_closed", "false");
  params.append("subtasks", "true");

  const tasks: ClickUpTaskCacheInput[] = [];
  for (let page = 0; page < 100; page += 1) {
    params.set("page", String(page));
    const response = await fetchClickUpJson<ClickUpTasksResponse>(`/team/${teamId}/task`, params, apiKey);
    const pageTasks = response.tasks || [];
    tasks.push(...pageTasks);
    if (pageTasks.length < 100) break;
  }
  return tasks;
}

/**
 * Refreshes the cache when it is stale, or unconditionally on request. A failed
 * refresh is reported, never thrown: a cached task list with a visible sync
 * error beats an empty screen.
 */
export async function syncClickUpTasks(
  db: DatabaseSync,
  options: { force?: boolean } = {}
): Promise<ClickUpTaskSyncResult> {
  return ensureClickUpTasksFresh(db, fetchAssignedClickUpTasks, new Date(), options);
}

/** Re-runs client/project matching so renamed entities re-associate on read. */
export function refreshTaskAssociations(db: DatabaseSync): void {
  reassociateCachedClickUpTasks(db);
}
