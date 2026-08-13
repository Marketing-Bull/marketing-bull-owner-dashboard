/** Mileage CRUD, round-trip totals, recent routes, and reimbursement settings. */

import type { DatabaseSync } from "node:sqlite";
import { getClient, getProject, newEntityId } from "@/lib/entities";
import { isDateKey } from "@/lib/time-entries";
import type { MileageEntry, MileageRecentTrip } from "@/lib/types";

type Row = Record<string, unknown>;
const MILEAGE_RATE_KEY = "mileage.rate";
export const DEFAULT_MILEAGE_RATE = 0.67;

export class MileageValidationError extends Error {}

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
    notes: typeof row.notes === "string" ? row.notes : "", createdAt: String(row.created_at), updatedAt: String(row.updated_at)
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

export function createMileageEntry(db: DatabaseSync, input: MileageInput): MileageEntry {
  const value = validated(db, input);
  const id = newEntityId();
  const now = nowIso();
  db.prepare(`INSERT INTO mileage_entries (id,mc_id,client_id,project_id,trip_name,date,start_address,
    end_address,purpose,miles,round_trip,total_miles,billable,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id,input.mcId ?? null,value.clientId,value.projectId,text(input.tripName),value.date,
    text(input.startAddress),text(input.endAddress),text(input.purpose),value.miles,value.roundTrip ? 1 : 0,
    value.totalMiles,input.billable ? 1 : 0,text(input.notes),input.createdAt ?? now,now);
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
    notes: patch.notes ?? existing.notes
  };
  const value = validated(db, input);
  db.prepare(`UPDATE mileage_entries SET client_id=?,project_id=?,trip_name=?,date=?,start_address=?,
    end_address=?,purpose=?,miles=?,round_trip=?,total_miles=?,billable=?,notes=?,updated_at=? WHERE id=?`
  ).run(value.clientId,value.projectId,text(input.tripName),value.date,text(input.startAddress),
    text(input.endAddress),text(input.purpose),value.miles,value.roundTrip ? 1 : 0,value.totalMiles,
    input.billable ? 1 : 0,text(input.notes),nowIso(),id);
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
