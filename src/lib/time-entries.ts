/**
 * Time-entry CRUD, validation, frozen-rate rules, recent defaults, and the
 * local dashboard rollups introduced in consolidation phase 3.
 */

import type { DatabaseSync } from "node:sqlite";
import { getClient, getProject, newEntityId, resolveHourlyRate } from "@/lib/entities";
import {
  addInFilter,
  addLikeFilter,
  assertRange,
  booleanParam,
  countRows,
  dateParam,
  facetCounts,
  listParam,
  makePageInfo,
  numberParam,
  pageParams,
  sortParams,
  textParam,
  type FacetCount,
  type QueryScalar,
  type SortDirection,
  type TransactionQueryResult
} from "@/lib/transaction-query";
import type { HoursEntry, TimeEntry, TimeEntryRecentDefaults } from "@/lib/types";

type Row = Record<string, unknown>;

export class TimeEntryValidationError extends Error {}

export const TIME_ENTRY_SORTS = [
  "date",
  "hours",
  "rate",
  "amount",
  "details",
  "billable",
  "startTime",
  "endTime",
  "createdAt",
  "updatedAt"
] as const;

export type TimeEntrySort = (typeof TIME_ENTRY_SORTS)[number];

export type TimeEntryQuery = {
  page: number;
  pageSize: number;
  sort: TimeEntrySort;
  direction: SortDirection;
  id?: string;
  mcId?: number;
  search?: string;
  from?: string;
  to?: string;
  clientIds?: string[];
  projectIds?: string[];
  billable?: boolean;
  hoursMin?: number;
  hoursMax?: number;
  rateMin?: number;
  rateMax?: number;
  amountMin?: number;
  amountMax?: number;
  details?: string;
  startTime?: string;
  endTime?: string;
  hasStartTime?: boolean;
  hasEndTime?: boolean;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type TimeEntryQueryTotals = {
  hours: number;
  billableHours: number;
  amount: number;
  billableAmount: number;
};

export type TimeEntryQueryFacets = {
  clients: FacetCount[];
  projects: FacetCount[];
  billable: FacetCount[];
};

export type TimeEntryInput = {
  clientId?: string | null;
  projectId?: string | null;
  date: string;
  hours: number;
  billable?: boolean;
  details?: string;
  /** Importer-only fields. Native API callers never need to supply these. */
  frozenRate?: number;
  mcId?: number;
  startTime?: string | null;
  endTime?: string | null;
  createdAt?: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const valueText = text(value);
  return valueText || null;
}

function relationId(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new TimeEntryValidationError(`${label} id must be a string or null.`);
  }
  return value.trim() || null;
}

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TimeEntryValidationError(`${label} must be a number.`);
  }
  return parsed;
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function rowToTimeEntry(row: Row): TimeEntry {
  return {
    id: String(row.id),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    date: String(row.date),
    hours: Number(row.hours),
    rate: Number(row.rate),
    billable: Boolean(row.billable),
    details: typeof row.details === "string" ? row.details : "",
    startTime: row.start_time == null ? null : String(row.start_time),
    endTime: row.end_time == null ? null : String(row.end_time),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function resolveRelations(
  db: DatabaseSync,
  clientIdValue: unknown,
  projectIdValue: unknown
): {
  clientId: string | null;
  projectId: string | null;
  client: ReturnType<typeof getClient>;
  project: ReturnType<typeof getProject>;
} {
  const requestedClientId = relationId(clientIdValue, "Client");
  const projectId = relationId(projectIdValue, "Project");
  const project = projectId ? getProject(db, projectId) : null;
  if (projectId && !project) throw new TimeEntryValidationError("That project does not exist.");

  const clientId = requestedClientId ?? project?.clientId ?? null;
  const client = clientId ? getClient(db, clientId) : null;
  if (clientId && !client) throw new TimeEntryValidationError("That client does not exist.");
  if (project?.clientId && clientId && project.clientId !== clientId) {
    throw new TimeEntryValidationError("That project belongs to a different client.");
  }

  return { clientId, projectId, client, project };
}

function validatedCore(input: Pick<TimeEntryInput, "date" | "hours">): { date: string; hours: number } {
  const date = text(input.date);
  if (!isDateKey(date)) {
    throw new TimeEntryValidationError("Date must be a real calendar day in YYYY-MM-DD format.");
  }
  const hours = finiteNumber(input.hours, "Hours");
  if (hours <= 0 || hours > 24) {
    throw new TimeEntryValidationError("Hours must be greater than 0 and no more than 24.");
  }
  return { date, hours };
}

function validatedRate(value: unknown): number {
  const rate = finiteNumber(value, "Rate");
  if (rate < 0) throw new TimeEntryValidationError("Rate cannot be negative.");
  return rate;
}

export function listTimeEntries(
  db: DatabaseSync,
  options: { from?: string; to?: string; limit?: number } = {}
): TimeEntry[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.from) {
    if (!isDateKey(options.from)) throw new TimeEntryValidationError("Invalid `from` date.");
    clauses.push("date >= ?");
    params.push(options.from);
  }
  if (options.to) {
    if (!isDateKey(options.to)) throw new TimeEntryValidationError("Invalid `to` date.");
    clauses.push("date <= ?");
    params.push(options.to);
  }
  const requestedLimit = Number(options.limit ?? 200);
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 500) : 200;
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT * FROM time_entries ${where} ORDER BY date DESC, created_at DESC LIMIT ?`)
    .all(...params) as Row[];
  return rows.map(rowToTimeEntry);
}

export function parseTimeEntryQuery(params: URLSearchParams): TimeEntryQuery {
  const pagination = pageParams(params);
  const sorting = sortParams(params, TIME_ENTRY_SORTS, "date");
  const query: TimeEntryQuery = {
    ...pagination,
    ...sorting,
    id: textParam(params, "id", { maxLength: 80 }),
    mcId: numberParam(params, "mcId", { min: 0, integer: true }),
    search: textParam(params, "search"),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
    clientIds: listParam(params, "clientId"),
    projectIds: listParam(params, "projectId"),
    billable: booleanParam(params, "billable"),
    hoursMin: numberParam(params, "hoursMin", { min: 0 }),
    hoursMax: numberParam(params, "hoursMax", { min: 0 }),
    rateMin: numberParam(params, "rateMin", { min: 0 }),
    rateMax: numberParam(params, "rateMax", { min: 0 }),
    amountMin: numberParam(params, "amountMin", { min: 0 }),
    amountMax: numberParam(params, "amountMax", { min: 0 }),
    details: textParam(params, "details"),
    startTime: textParam(params, "startTime", { maxLength: 80 }),
    endTime: textParam(params, "endTime", { maxLength: 80 }),
    hasStartTime: booleanParam(params, "hasStartTime"),
    hasEndTime: booleanParam(params, "hasEndTime"),
    createdFrom: dateParam(params, "createdFrom"),
    createdTo: dateParam(params, "createdTo"),
    updatedFrom: dateParam(params, "updatedFrom"),
    updatedTo: dateParam(params, "updatedTo")
  };
  assertRange(query.from, query.to, "Date");
  assertRange(query.hoursMin, query.hoursMax, "Hours");
  assertRange(query.rateMin, query.rateMax, "Rate");
  assertRange(query.amountMin, query.amountMax, "Amount");
  assertRange(query.createdFrom, query.createdTo, "Created date");
  assertRange(query.updatedFrom, query.updatedTo, "Updated date");
  return query;
}

function timeEntryWhere(query: TimeEntryQuery): { where: string; params: QueryScalar[] } {
  const clauses: string[] = [];
  const params: QueryScalar[] = [];
  const exact = (column: string, value: QueryScalar | undefined) => {
    if (value === undefined) return;
    clauses.push(`${column} = ?`);
    params.push(value);
  };
  const minimum = (column: string, value: QueryScalar | undefined) => {
    if (value === undefined) return;
    clauses.push(`${column} >= ?`);
    params.push(value);
  };
  const maximum = (column: string, value: QueryScalar | undefined) => {
    if (value === undefined) return;
    clauses.push(`${column} <= ?`);
    params.push(value);
  };

  exact("id", query.id);
  exact("mc_id", query.mcId);
  minimum("date", query.from);
  maximum("date", query.to);
  addInFilter(clauses, params, "client_id", query.clientIds);
  addInFilter(clauses, params, "project_id", query.projectIds);
  exact("billable", query.billable === undefined ? undefined : query.billable ? 1 : 0);
  minimum("hours", query.hoursMin);
  maximum("hours", query.hoursMax);
  minimum("rate", query.rateMin);
  maximum("rate", query.rateMax);
  minimum("(hours * rate)", query.amountMin);
  maximum("(hours * rate)", query.amountMax);
  addLikeFilter(clauses, params, "details", query.details);
  addLikeFilter(
    clauses,
    params,
    "COALESCE(details, '') || ' ' || date || ' ' || COALESCE(start_time, '') || ' ' || COALESCE(end_time, '')",
    query.search
  );
  exact("start_time", query.startTime);
  exact("end_time", query.endTime);
  if (query.hasStartTime !== undefined) {
    clauses.push(query.hasStartTime ? "start_time IS NOT NULL AND start_time <> ''" : "(start_time IS NULL OR start_time = '')");
  }
  if (query.hasEndTime !== undefined) {
    clauses.push(query.hasEndTime ? "end_time IS NOT NULL AND end_time <> ''" : "(end_time IS NULL OR end_time = '')");
  }
  minimum("SUBSTR(created_at, 1, 10)", query.createdFrom);
  maximum("SUBSTR(created_at, 1, 10)", query.createdTo);
  minimum("SUBSTR(updated_at, 1, 10)", query.updatedFrom);
  maximum("SUBSTR(updated_at, 1, 10)", query.updatedTo);
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function queryTimeEntries(
  db: DatabaseSync,
  query: TimeEntryQuery
): TransactionQueryResult<TimeEntry, TimeEntryQueryTotals, TimeEntryQueryFacets> {
  const { where, params } = timeEntryWhere(query);
  const totalItems = countRows(db, "time_entries", where, params);
  const sortColumns: Record<TimeEntrySort, string> = {
    date: "date",
    hours: "hours",
    rate: "rate",
    amount: "(hours * rate)",
    details: "details COLLATE NOCASE",
    billable: "billable",
    startTime: "start_time",
    endTime: "end_time",
    createdAt: "created_at",
    updatedAt: "updated_at"
  };
  const direction = query.direction.toUpperCase();
  const offset = (query.page - 1) * query.pageSize;
  const rows = db
    .prepare(`
      SELECT * FROM time_entries ${where}
      ORDER BY ${sortColumns[query.sort]} ${direction}, created_at ${direction}, id ${direction}
      LIMIT ? OFFSET ?
    `)
    .all(...params, query.pageSize, offset) as Row[];
  const totals = db
    .prepare(`
      SELECT
        COALESCE(SUM(hours), 0) AS hours,
        COALESCE(SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END), 0) AS billable_hours,
        COALESCE(SUM(hours * rate), 0) AS amount,
        COALESCE(SUM(CASE WHEN billable = 1 THEN hours * rate ELSE 0 END), 0) AS billable_amount
      FROM time_entries ${where}
    `)
    .get(...params) as Record<string, number>;
  return {
    items: rows.map(rowToTimeEntry),
    pageInfo: makePageInfo(query.page, query.pageSize, totalItems),
    filteredTotals: {
      hours: Number(totals.hours),
      billableHours: Number(totals.billable_hours),
      amount: Number(totals.amount),
      billableAmount: Number(totals.billable_amount)
    },
    availableFacets: {
      clients: facetCounts(db, "time_entries", "COALESCE(client_id, '__unassigned__')", where, params),
      projects: facetCounts(db, "time_entries", "COALESCE(project_id, '__unassigned__')", where, params),
      billable: facetCounts(db, "time_entries", "billable", where, params, { includeEmpty: true })
    }
  };
}

export function getTimeEntry(db: DatabaseSync, id: string): TimeEntry | null {
  const row = db.prepare("SELECT * FROM time_entries WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToTimeEntry(row) : null;
}

export function getTimeEntryByMcId(db: DatabaseSync, mcId: number): TimeEntry | null {
  const row = db.prepare("SELECT * FROM time_entries WHERE mc_id = ?").get(mcId) as Row | undefined;
  return row ? rowToTimeEntry(row) : null;
}

export function createTimeEntry(db: DatabaseSync, input: TimeEntryInput): TimeEntry {
  const { date, hours } = validatedCore(input);
  if (input.billable !== undefined && typeof input.billable !== "boolean") {
    throw new TimeEntryValidationError("Billable must be true or false.");
  }
  const relations = resolveRelations(db, input.clientId, input.projectId);
  const rate =
    input.frozenRate === undefined
      ? resolveHourlyRate(relations.project, relations.client)
      : validatedRate(input.frozenRate);
  const id = newEntityId();
  const now = nowIso();

  db.prepare(`
    INSERT INTO time_entries (
      id, mc_id, client_id, project_id, date, hours, rate, billable, details,
      start_time, end_time, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.mcId ?? null,
    relations.clientId,
    relations.projectId,
    date,
    hours,
    rate,
    input.billable === false ? 0 : 1,
    typeof input.details === "string" ? input.details.trim() : "",
    nullableText(input.startTime),
    nullableText(input.endTime),
    input.createdAt ?? now,
    now
  );

  return getTimeEntry(db, id)!;
}

export function updateTimeEntry(
  db: DatabaseSync,
  id: string,
  patch: Partial<TimeEntryInput>
): TimeEntry {
  const existing = getTimeEntry(db, id);
  if (!existing) throw new TimeEntryValidationError("No such time entry.");
  if (patch.billable !== undefined && typeof patch.billable !== "boolean") {
    throw new TimeEntryValidationError("Billable must be true or false.");
  }

  const core = validatedCore({
    date: patch.date ?? existing.date,
    hours: patch.hours ?? existing.hours
  });
  const relations = resolveRelations(
    db,
    patch.clientId === undefined ? existing.clientId : patch.clientId,
    patch.projectId === undefined ? existing.projectId : patch.projectId
  );
  const relationChanged =
    relations.clientId !== existing.clientId || relations.projectId !== existing.projectId;
  const rate =
    patch.frozenRate !== undefined
      ? validatedRate(patch.frozenRate)
      : relationChanged
        ? resolveHourlyRate(relations.project, relations.client)
        : existing.rate;

  db.prepare(`
    UPDATE time_entries SET
      client_id = ?, project_id = ?, date = ?, hours = ?, rate = ?, billable = ?,
      details = ?, start_time = ?, end_time = ?, updated_at = ?
    WHERE id = ?
  `).run(
    relations.clientId,
    relations.projectId,
    core.date,
    core.hours,
    rate,
    patch.billable === undefined ? (existing.billable ? 1 : 0) : (patch.billable ? 1 : 0),
    patch.details === undefined ? existing.details : text(patch.details),
    patch.startTime === undefined ? existing.startTime : nullableText(patch.startTime),
    patch.endTime === undefined ? existing.endTime : nullableText(patch.endTime),
    nowIso(),
    id
  );

  return getTimeEntry(db, id)!;
}

export function deleteTimeEntry(db: DatabaseSync, id: string): void {
  const result = db.prepare("DELETE FROM time_entries WHERE id = ?").run(id);
  if (result.changes === 0) throw new TimeEntryValidationError("No such time entry.");
}

export function getRecentTimeEntryDefaults(db: DatabaseSync): TimeEntryRecentDefaults | null {
  const row = db
    .prepare("SELECT client_id, project_id, billable FROM time_entries ORDER BY created_at DESC, date DESC LIMIT 1")
    .get() as Row | undefined;
  if (!row) return null;
  return {
    clientId: row.client_id == null ? null : String(row.client_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    billable: Boolean(row.billable)
  };
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hoursByProject(db: DatabaseSync, from: string, to: string): HoursEntry[] {
  const rows = db.prepare(`
    SELECT
      COALESCE(p.name, c.name, 'Unassigned') AS label,
      SUM(te.hours) AS hours
    FROM time_entries te
    LEFT JOIN projects p ON p.id = te.project_id
    LEFT JOIN clients c ON c.id = te.client_id
    WHERE te.date >= ? AND te.date <= ?
    GROUP BY COALESCE(p.name, c.name, 'Unassigned')
    ORDER BY hours DESC, label COLLATE NOCASE
    LIMIT 6
  `).all(from, to) as Array<{ label: string; hours: number }>;
  return rows.map((row) => ({ label: row.label, hours: Number(Number(row.hours).toFixed(1)) }));
}

export function buildLocalHoursWindows(
  db: DatabaseSync,
  now: Date = new Date()
): { day: HoursEntry[]; week: HoursEntry[]; month: HoursEntry[] } {
  const today = localDateKey(now);
  const weekStart = new Date(now);
  const weekday = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    day: hoursByProject(db, today, today),
    week: hoursByProject(db, localDateKey(weekStart), today),
    month: hoursByProject(db, localDateKey(monthStart), today)
  };
}
