/** Mileage CRUD, round-trip totals, recent routes, and reimbursement settings. */

import type { DatabaseSync } from "node:sqlite";
import { getClient, getProject, newEntityId } from "@/lib/entities";
import { isDateKey } from "@/lib/time-entries";
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
import type { MileageEntry, MileageRecentTrip } from "@/lib/types";

type Row = Record<string, unknown>;
const MILEAGE_RATE_KEY = "mileage.rate";
export const DEFAULT_MILEAGE_RATE = 0.67;

export class MileageValidationError extends Error {}

export const MILEAGE_SORTS = [
  "date",
  "tripName",
  "startAddress",
  "endAddress",
  "purpose",
  "miles",
  "roundTrip",
  "totalMiles",
  "billable",
  "reimbursement",
  "createdAt",
  "updatedAt"
] as const;

export type MileageSort = (typeof MILEAGE_SORTS)[number];

export type MileageQuery = {
  page: number;
  pageSize: number;
  sort: MileageSort;
  direction: SortDirection;
  id?: string;
  mcId?: number;
  search?: string;
  from?: string;
  to?: string;
  clientIds?: string[];
  projectIds?: string[];
  tripName?: string;
  startAddress?: string;
  endAddress?: string;
  purpose?: string;
  milesMin?: number;
  milesMax?: number;
  roundTrip?: boolean;
  totalMilesMin?: number;
  totalMilesMax?: number;
  billable?: boolean;
  notes?: string;
  reimbursementMin?: number;
  reimbursementMax?: number;
  createdFrom?: string;
  createdTo?: string;
  updatedFrom?: string;
  updatedTo?: string;
};

export type MileageQueryTotals = {
  entries: number;
  totalMiles: number;
  reimbursement: number;
};

export type MileageQueryFacets = {
  clients: FacetCount[];
  projects: FacetCount[];
  purposes: FacetCount[];
  roundTrip: FacetCount[];
  billable: FacetCount[];
};

export type MileageInput = {
  clientId?: string | null;
  projectId?: string | null;
  tripName?: string;
  date: string;
  startAddress?: string;
  endAddress?: string;
  purpose?: string;
  miles: number;
  roundTrip?: boolean;
  billable?: boolean;
  notes?: string;
  calculationSource?: "manual" | "provider";
  calculationProvider?: string | null;
  calculatedMiles?: number | null;
  routeMetadataJson?: string | null;
  calculatedAt?: string | null;
  startPlaceId?: string | null;
  endPlaceId?: string | null;
  mcId?: number;
  createdAt?: string;
};

function nowIso(): string { return new Date().toISOString(); }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new MileageValidationError(`${label} must be a number.`);
  return parsed;
}

function relationId(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new MileageValidationError(`${label} id must be a string or null.`);
  return value.trim() || null;
}

function resolveRelations(db: DatabaseSync, clientValue: unknown, projectValue: unknown) {
  const requestedClientId = relationId(clientValue, "Client");
  const projectId = relationId(projectValue, "Project");
  const project = projectId ? getProject(db, projectId) : null;
  if (projectId && !project) throw new MileageValidationError("That project does not exist.");
  const clientId = requestedClientId ?? project?.clientId ?? null;
  const client = clientId ? getClient(db, clientId) : null;
  if (clientId && !client) throw new MileageValidationError("That client does not exist.");
  if (project?.clientId && clientId && project.clientId !== clientId) {
    throw new MileageValidationError("That project belongs to a different client.");
  }
  return { clientId, projectId };
}

export function mileageTotal(milesValue: unknown, roundTripValue: unknown): number {
  const miles = finiteNumber(milesValue, "Miles");
  if (miles <= 0 || miles > 10000) throw new MileageValidationError("Miles must be greater than 0 and no more than 10,000.");
  if (typeof roundTripValue !== "boolean") throw new MileageValidationError("Round trip must be true or false.");
  return Number((roundTripValue ? miles * 2 : miles).toFixed(2));
}

function rowToMileage(row: Row): MileageEntry {
  return {
    id: String(row.id), mcId: row.mc_id == null ? null : Number(row.mc_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    tripName: text(row.trip_name), date: String(row.date), startAddress: text(row.start_address),
    endAddress: text(row.end_address), purpose: text(row.purpose), miles: Number(row.miles),
    roundTrip: Boolean(row.round_trip), totalMiles: Number(row.total_miles), billable: Boolean(row.billable),
    notes: typeof row.notes === "string" ? row.notes : "",
    calculationSource: row.calculation_source === "provider" ? "provider" : "manual",
    calculationProvider: row.calculation_provider == null ? null : String(row.calculation_provider),
    calculatedMiles: row.calculated_miles == null ? null : Number(row.calculated_miles),
    routeMetadataJson: row.route_metadata_json == null ? null : String(row.route_metadata_json),
    calculatedAt: row.calculated_at == null ? null : String(row.calculated_at),
    startPlaceId: row.start_place_id == null ? null : String(row.start_place_id),
    endPlaceId: row.end_place_id == null ? null : String(row.end_place_id),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function validated(db: DatabaseSync, input: MileageInput) {
  const date = text(input.date);
  if (!isDateKey(date)) throw new MileageValidationError("Date must be a real calendar day in YYYY-MM-DD format.");
  const roundTrip = input.roundTrip ?? false;
  const totalMiles = mileageTotal(input.miles, roundTrip);
  if (input.billable !== undefined && typeof input.billable !== "boolean") {
    throw new MileageValidationError("Billable must be true or false.");
  }
  return { date, miles: finiteNumber(input.miles, "Miles"), roundTrip, totalMiles,
    ...resolveRelations(db, input.clientId, input.projectId) };
}

export function getMileageEntry(db: DatabaseSync, id: string): MileageEntry | null {
  const row = db.prepare("SELECT * FROM mileage_entries WHERE id=?").get(id) as Row | undefined;
  return row ? rowToMileage(row) : null;
}

export function getMileageEntryByMcId(db: DatabaseSync, mcId: number): MileageEntry | null {
  const row = db.prepare("SELECT * FROM mileage_entries WHERE mc_id=?").get(mcId) as Row | undefined;
  return row ? rowToMileage(row) : null;
}

export function listMileageEntries(db: DatabaseSync, options: { from?: string; to?: string; limit?: number } = {}): MileageEntry[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  for (const [column, value] of [["date >= ?", options.from], ["date <= ?", options.to]] as const) {
    if (!value) continue;
    if (!isDateKey(value)) throw new MileageValidationError("Mileage date filter is invalid.");
    clauses.push(column); params.push(value);
  }
  const requested = Number(options.limit ?? 300);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 1000) : 300;
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (db.prepare(`SELECT * FROM mileage_entries ${where} ORDER BY date DESC, created_at DESC LIMIT ?`).all(...params) as Row[]).map(rowToMileage);
}

export function parseMileageQuery(params: URLSearchParams): MileageQuery {
  const query: MileageQuery = {
    ...pageParams(params),
    ...sortParams(params, MILEAGE_SORTS, "date"),
    id: textParam(params, "id", { maxLength: 80 }),
    mcId: numberParam(params, "mcId", { min: 0, integer: true }),
    search: textParam(params, "search"),
    from: dateParam(params, "from"),
    to: dateParam(params, "to"),
    clientIds: listParam(params, "clientId"),
    projectIds: listParam(params, "projectId"),
    tripName: textParam(params, "tripName"),
    startAddress: textParam(params, "startAddress"),
    endAddress: textParam(params, "endAddress"),
    purpose: textParam(params, "purpose"),
    milesMin: numberParam(params, "milesMin", { min: 0 }),
    milesMax: numberParam(params, "milesMax", { min: 0 }),
    roundTrip: booleanParam(params, "roundTrip"),
    totalMilesMin: numberParam(params, "totalMilesMin", { min: 0 }),
    totalMilesMax: numberParam(params, "totalMilesMax", { min: 0 }),
    billable: booleanParam(params, "billable"),
    notes: textParam(params, "notes"),
    reimbursementMin: numberParam(params, "reimbursementMin", { min: 0 }),
    reimbursementMax: numberParam(params, "reimbursementMax", { min: 0 }),
    createdFrom: dateParam(params, "createdFrom"),
    createdTo: dateParam(params, "createdTo"),
    updatedFrom: dateParam(params, "updatedFrom"),
    updatedTo: dateParam(params, "updatedTo")
  };
  assertRange(query.from, query.to, "Date");
  assertRange(query.milesMin, query.milesMax, "One-way miles");
  assertRange(query.totalMilesMin, query.totalMilesMax, "Total miles");
  assertRange(query.reimbursementMin, query.reimbursementMax, "Reimbursement");
  assertRange(query.createdFrom, query.createdTo, "Created date");
  assertRange(query.updatedFrom, query.updatedTo, "Updated date");
  return query;
}

function mileageWhere(query: MileageQuery, rate: number): { where: string; params: QueryScalar[] } {
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
  const reimbursementSql = `(total_miles * ${rate})`;

  exact("id", query.id);
  exact("mc_id", query.mcId);
  minimum("date", query.from);
  maximum("date", query.to);
  addInFilter(clauses, params, "client_id", query.clientIds);
  addInFilter(clauses, params, "project_id", query.projectIds);
  addLikeFilter(clauses, params, "trip_name", query.tripName);
  addLikeFilter(clauses, params, "start_address", query.startAddress);
  addLikeFilter(clauses, params, "end_address", query.endAddress);
  addLikeFilter(clauses, params, "purpose", query.purpose);
  minimum("miles", query.milesMin);
  maximum("miles", query.milesMax);
  exact("round_trip", query.roundTrip === undefined ? undefined : query.roundTrip ? 1 : 0);
  minimum("total_miles", query.totalMilesMin);
  maximum("total_miles", query.totalMilesMax);
  exact("billable", query.billable === undefined ? undefined : query.billable ? 1 : 0);
  addLikeFilter(clauses, params, "notes", query.notes);
  minimum(reimbursementSql, query.reimbursementMin);
  maximum(reimbursementSql, query.reimbursementMax);
  addLikeFilter(
    clauses,
    params,
    "trip_name || ' ' || start_address || ' ' || end_address || ' ' || purpose || ' ' || notes",
    query.search
  );
  minimum("SUBSTR(created_at, 1, 10)", query.createdFrom);
  maximum("SUBSTR(created_at, 1, 10)", query.createdTo);
  minimum("SUBSTR(updated_at, 1, 10)", query.updatedFrom);
  maximum("SUBSTR(updated_at, 1, 10)", query.updatedTo);
  return { where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
}

export function queryMileageEntries(
  db: DatabaseSync,
  query: MileageQuery
): TransactionQueryResult<MileageEntry, MileageQueryTotals, MileageQueryFacets> {
  const rate = getMileageRate(db);
  const { where, params } = mileageWhere(query, rate);
  const totalItems = countRows(db, "mileage_entries", where, params);
  const sortColumns: Record<MileageSort, string> = {
    date: "date",
    tripName: "trip_name COLLATE NOCASE",
    startAddress: "start_address COLLATE NOCASE",
    endAddress: "end_address COLLATE NOCASE",
    purpose: "purpose COLLATE NOCASE",
    miles: "miles",
    roundTrip: "round_trip",
    totalMiles: "total_miles",
    billable: "billable",
    reimbursement: `(total_miles * ${rate})`,
    createdAt: "created_at",
    updatedAt: "updated_at"
  };
  const direction = query.direction.toUpperCase();
  const offset = (query.page - 1) * query.pageSize;
  const rows = db.prepare(`SELECT * FROM mileage_entries ${where}
      ORDER BY ${sortColumns[query.sort]} ${direction}, created_at ${direction}, id ${direction}
      LIMIT ? OFFSET ?`).all(...params, query.pageSize, offset) as Row[];
  const totals = db.prepare(`SELECT COUNT(*) AS entries, COALESCE(SUM(total_miles), 0) AS total_miles
    FROM mileage_entries ${where}`).get(...params) as { entries: number; total_miles: number };
  const totalMiles = Number(totals.total_miles);
  return {
    items: rows.map(rowToMileage),
    pageInfo: makePageInfo(query.page, query.pageSize, totalItems),
    filteredTotals: {
      entries: Number(totals.entries),
      totalMiles,
      reimbursement: Number((totalMiles * rate).toFixed(2))
    },
    availableFacets: {
      clients: facetCounts(db, "mileage_entries", "COALESCE(client_id, '__unassigned__')", where, params),
      projects: facetCounts(db, "mileage_entries", "COALESCE(project_id, '__unassigned__')", where, params),
      purposes: facetCounts(db, "mileage_entries", "purpose", where, params),
      roundTrip: facetCounts(db, "mileage_entries", "round_trip", where, params, { includeEmpty: true }),
      billable: facetCounts(db, "mileage_entries", "billable", where, params, { includeEmpty: true })
    }
  };
}

export function createMileageEntry(db: DatabaseSync, input: MileageInput): MileageEntry {
  const value = validated(db, input);
  const id = newEntityId();
  const now = nowIso();
  const calculationSource = input.calculationSource === "provider" ? "provider" : "manual";
  db.prepare(`INSERT INTO mileage_entries (id,mc_id,client_id,project_id,trip_name,date,start_address,
    end_address,purpose,miles,round_trip,total_miles,billable,notes,calculation_source,calculation_provider,
    calculated_miles,route_metadata_json,calculated_at,start_place_id,end_place_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id,input.mcId ?? null,value.clientId,value.projectId,text(input.tripName),value.date,
    text(input.startAddress),text(input.endAddress),text(input.purpose),value.miles,value.roundTrip ? 1 : 0,
    value.totalMiles,input.billable ? 1 : 0,text(input.notes),calculationSource,
    calculationSource === "provider" ? text(input.calculationProvider) || null : null,
    calculationSource === "provider" && input.calculatedMiles != null ? finiteNumber(input.calculatedMiles, "Calculated miles") : null,
    calculationSource === "provider" ? input.routeMetadataJson ?? null : null,
    calculationSource === "provider" ? input.calculatedAt ?? now : null,
    calculationSource === "provider" ? input.startPlaceId ?? null : null,
    calculationSource === "provider" ? input.endPlaceId ?? null : null,input.createdAt ?? now,now);
  return getMileageEntry(db, id)!;
}

export function updateMileageEntry(db: DatabaseSync, id: string, patch: Partial<MileageInput>): MileageEntry {
  const existing = getMileageEntry(db, id);
  if (!existing) throw new MileageValidationError("No such mileage entry.");
  const input: MileageInput = {
    clientId: patch.clientId === undefined ? existing.clientId : patch.clientId,
    projectId: patch.projectId === undefined ? existing.projectId : patch.projectId,
    tripName: patch.tripName ?? existing.tripName, date: patch.date ?? existing.date,
    startAddress: patch.startAddress ?? existing.startAddress, endAddress: patch.endAddress ?? existing.endAddress,
    purpose: patch.purpose ?? existing.purpose, miles: patch.miles ?? existing.miles,
    roundTrip: patch.roundTrip ?? existing.roundTrip, billable: patch.billable ?? existing.billable,
    notes: patch.notes ?? existing.notes,
    calculationSource: patch.calculationSource ?? existing.calculationSource,
    calculationProvider: patch.calculationProvider === undefined ? existing.calculationProvider : patch.calculationProvider,
    calculatedMiles: patch.calculatedMiles === undefined ? existing.calculatedMiles : patch.calculatedMiles,
    routeMetadataJson: patch.routeMetadataJson === undefined ? existing.routeMetadataJson : patch.routeMetadataJson,
    calculatedAt: patch.calculatedAt === undefined ? existing.calculatedAt : patch.calculatedAt,
    startPlaceId: patch.startPlaceId === undefined ? existing.startPlaceId : patch.startPlaceId,
    endPlaceId: patch.endPlaceId === undefined ? existing.endPlaceId : patch.endPlaceId
  };
  const value = validated(db, input);
  const calculationSource = input.calculationSource === "provider" ? "provider" : "manual";
  db.prepare(`UPDATE mileage_entries SET client_id=?,project_id=?,trip_name=?,date=?,start_address=?,
    end_address=?,purpose=?,miles=?,round_trip=?,total_miles=?,billable=?,notes=?,calculation_source=?,
    calculation_provider=?,calculated_miles=?,route_metadata_json=?,calculated_at=?,start_place_id=?,end_place_id=?,updated_at=? WHERE id=?`
  ).run(value.clientId,value.projectId,text(input.tripName),value.date,text(input.startAddress),
    text(input.endAddress),text(input.purpose),value.miles,value.roundTrip ? 1 : 0,value.totalMiles,
    input.billable ? 1 : 0,text(input.notes),calculationSource,
    calculationSource === "provider" ? text(input.calculationProvider) || null : null,
    calculationSource === "provider" ? input.calculatedMiles ?? null : null,
    calculationSource === "provider" ? input.routeMetadataJson ?? null : null,
    calculationSource === "provider" ? input.calculatedAt ?? nowIso() : null,
    calculationSource === "provider" ? input.startPlaceId ?? null : null,
    calculationSource === "provider" ? input.endPlaceId ?? null : null,nowIso(),id);
  return getMileageEntry(db, id)!;
}

export function deleteMileageEntry(db: DatabaseSync, id: string): void {
  const result = db.prepare("DELETE FROM mileage_entries WHERE id=?").run(id);
  if (result.changes === 0) throw new MileageValidationError("No such mileage entry.");
}

export function listRecentTrips(db: DatabaseSync, limit = 6): MileageRecentTrip[] {
  const rows = db.prepare(`SELECT trip_name,start_address,end_address,miles,round_trip,purpose
    FROM mileage_entries WHERE start_address<>'' OR end_address<>''
    GROUP BY start_address,end_address,round_trip,miles
    ORDER BY MAX(date) DESC, MAX(created_at) DESC LIMIT ?`).all(Math.min(Math.max(limit, 1), 20)) as Row[];
  return rows.map((row) => ({ tripName: text(row.trip_name), startAddress: text(row.start_address),
    endAddress: text(row.end_address), miles: Number(row.miles), roundTrip: Boolean(row.round_trip), purpose: text(row.purpose) }));
}

export function getMileageRate(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM app_settings WHERE key=?").get(MILEAGE_RATE_KEY) as { value?: unknown } | undefined;
  const rate = Number(row?.value);
  return Number.isFinite(rate) && rate >= 0 ? rate : DEFAULT_MILEAGE_RATE;
}

export function setMileageRate(db: DatabaseSync, value: unknown): number {
  const rate = finiteNumber(value, "Mileage rate");
  if (rate < 0 || rate > 10) throw new MileageValidationError("Mileage rate must be between 0 and 10 dollars per mile.");
  db.prepare(`INSERT INTO app_settings (key,value,updated_at) VALUES (?,?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`
  ).run(MILEAGE_RATE_KEY,String(rate),nowIso());
  return getMileageRate(db);
}

export function getMileageSummary(db: DatabaseSync): { totalMiles: number; reimbursement: number; entries: number } {
  const row = db.prepare("SELECT COALESCE(SUM(total_miles),0) AS miles, COUNT(*) AS entries FROM mileage_entries").get() as { miles: number; entries: number };
  const miles = Number(row.miles);
  return { totalMiles: miles, reimbursement: Number((miles * getMileageRate(db)).toFixed(2)), entries: Number(row.entries) };
}
