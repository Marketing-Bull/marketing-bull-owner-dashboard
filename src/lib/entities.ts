/**
 * CRUD and rules for the entities the dashboard owns: Clients and Projects.
 *
 * Every function takes the database as a parameter rather than opening one, so
 * the same code serves the route handlers (via `getDatabase()`), the
 * mission-control importer, and the tests — and none of them can accidentally
 * disagree about validation.
 *
 * Deletion is archival. These rows anchor time entries and expenses in later
 * phases; a hard delete would orphan financial records, so it does not exist.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  CLIENT_STATUSES,
  PAYMENT_TYPES,
  PROJECT_STATUSES,
  type Client,
  type ClientStatus,
  type PaymentType,
  type Project,
  type ProjectStatus
} from "@/lib/types";

export function newEntityId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Maps free-text status values onto the known set. Mission-control's live data
 * holds "On Hold", "on hold" and "prospect" side by side; anything genuinely
 * unknown lands on "active" and the caller decides whether that deserves a
 * warning (the importer does; the API rejects instead).
 */
export function normalizeClientStatus(raw: string): ClientStatus {
  const canonical = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (CLIENT_STATUSES as readonly string[]).includes(canonical)
    ? (canonical as ClientStatus)
    : "active";
}

export function isClientStatus(value: unknown): value is ClientStatus {
  return typeof value === "string" && (CLIENT_STATUSES as readonly string[]).includes(value);
}

export function isPaymentType(value: unknown): value is PaymentType {
  return typeof value === "string" && (PAYMENT_TYPES as readonly string[]).includes(value);
}

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === "string" && (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * Rate resolution, copied from Recoup verbatim (scope §04):
 * project override → client rate → 0. Phase 3 freezes the result onto each
 * time entry at save; nothing ever recomputes a saved entry.
 */
export function resolveHourlyRate(
  project: { hourlyRateOverride: number | null } | null,
  client: { hourlyRate: number | null } | null
): number {
  if (project?.hourlyRateOverride != null && project.hourlyRateOverride > 0) {
    return project.hourlyRateOverride;
  }
  if (client?.hourlyRate != null && client.hourlyRate > 0) {
    return client.hourlyRate;
  }
  return 0;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

type Row = Record<string, unknown>;

function rowToClient(row: Row): Client {
  return {
    id: String(row.id),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    name: String(row.name),
    status: isClientStatus(row.status) ? row.status : "active",
    paymentType: isPaymentType(row.payment_type) ? row.payment_type : "mrr",
    mrr: numberOrNull(row.mrr),
    hourlyRate: numberOrNull(row.hourly_rate),
    projectEstCost: numberOrNull(row.project_est_cost),
    paidThroughDate: text(row.paid_through_date),
    invoiceStatus: text(row.invoice_status),
    contactName: text(row.contact_name),
    contactEmail: text(row.contact_email),
    contactPhone: text(row.contact_phone),
    notes: typeof row.notes === "string" ? row.notes : "",
    isArchived: Boolean(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToProject(row: Row): Project {
  return {
    id: String(row.id),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    name: String(row.name),
    description: typeof row.description === "string" ? row.description : "",
    hourlyRateOverride: numberOrNull(row.hourly_rate_override),
    status: isProjectStatus(row.status) ? row.status : "active",
    notes: typeof row.notes === "string" ? row.notes : "",
    urgent: Boolean(row.urgent),
    important: Boolean(row.important),
    isArchived: Boolean(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

/** Thrown for caller mistakes; routes map it to a 400. */
export class EntityValidationError extends Error {}

export type ClientInput = {
  name: string;
  status?: ClientStatus;
  paymentType?: PaymentType;
  mrr?: number | null;
  hourlyRate?: number | null;
  projectEstCost?: number | null;
  paidThroughDate?: string;
  invoiceStatus?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  notes?: string;
  /** Importer-only extras; the API never passes these. */
  mcId?: number;
  createdAt?: string;
};

export function listClients(db: DatabaseSync, options: { includeArchived?: boolean } = {}): Client[] {
  const where = options.includeArchived ? "" : "WHERE is_archived = 0";
  const rows = db
    .prepare(`SELECT * FROM clients ${where} ORDER BY is_archived, name COLLATE NOCASE`)
    .all() as Row[];
  return rows.map(rowToClient);
}

export function getClient(db: DatabaseSync, id: string): Client | null {
  const row = db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToClient(row) : null;
}

export function getClientByMcId(db: DatabaseSync, mcId: number): Client | null {
  const row = db.prepare("SELECT * FROM clients WHERE mc_id = ?").get(mcId) as Row | undefined;
  return row ? rowToClient(row) : null;
}

export function createClient(db: DatabaseSync, input: ClientInput): Client {
  const name = text(input.name);
  if (!name) throw new EntityValidationError("A client needs a name.");
  if (input.status !== undefined && !isClientStatus(input.status)) {
    throw new EntityValidationError(`Unknown client status "${String(input.status)}".`);
  }
  if (input.paymentType !== undefined && !isPaymentType(input.paymentType)) {
    throw new EntityValidationError(`Unknown payment type "${String(input.paymentType)}".`);
  }

  const id = newEntityId();
  const now = nowIso();
  db.prepare(`
    INSERT INTO clients (
      id, mc_id, name, status, payment_type, mrr, hourly_rate, project_est_cost,
      paid_through_date, invoice_status, contact_name, contact_email, contact_phone,
      notes, is_archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    input.mcId ?? null,
    name,
    input.status ?? "active",
    input.paymentType ?? "mrr",
    numberOrNull(input.mrr),
    numberOrNull(input.hourlyRate),
    numberOrNull(input.projectEstCost),
    text(input.paidThroughDate),
    text(input.invoiceStatus),
    text(input.contactName),
    text(input.contactEmail),
    text(input.contactPhone),
    typeof input.notes === "string" ? input.notes : "",
    input.createdAt ?? now,
    now
  );

  return getClient(db, id)!;
}

export function updateClient(db: DatabaseSync, id: string, patch: Partial<ClientInput> & { isArchived?: boolean }): Client {
  const existing = getClient(db, id);
  if (!existing) throw new EntityValidationError("No such client.");

  const name = patch.name === undefined ? existing.name : text(patch.name);
  if (!name) throw new EntityValidationError("A client needs a name.");
  if (patch.status !== undefined && !isClientStatus(patch.status)) {
    throw new EntityValidationError(`Unknown client status "${String(patch.status)}".`);
  }
  if (patch.paymentType !== undefined && !isPaymentType(patch.paymentType)) {
    throw new EntityValidationError(`Unknown payment type "${String(patch.paymentType)}".`);
  }

  db.prepare(`
    UPDATE clients SET
      name = ?, status = ?, payment_type = ?, mrr = ?, hourly_rate = ?, project_est_cost = ?,
      paid_through_date = ?, invoice_status = ?, contact_name = ?, contact_email = ?,
      contact_phone = ?, notes = ?, is_archived = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    patch.status ?? existing.status,
    patch.paymentType ?? existing.paymentType,
    patch.mrr === undefined ? existing.mrr : numberOrNull(patch.mrr),
    patch.hourlyRate === undefined ? existing.hourlyRate : numberOrNull(patch.hourlyRate),
    patch.projectEstCost === undefined ? existing.projectEstCost : numberOrNull(patch.projectEstCost),
    patch.paidThroughDate === undefined ? existing.paidThroughDate : text(patch.paidThroughDate),
    patch.invoiceStatus === undefined ? existing.invoiceStatus : text(patch.invoiceStatus),
    patch.contactName === undefined ? existing.contactName : text(patch.contactName),
    patch.contactEmail === undefined ? existing.contactEmail : text(patch.contactEmail),
    patch.contactPhone === undefined ? existing.contactPhone : text(patch.contactPhone),
    patch.notes === undefined ? existing.notes : (typeof patch.notes === "string" ? patch.notes : ""),
    (patch.isArchived === undefined ? existing.isArchived : patch.isArchived) ? 1 : 0,
    nowIso(),
    id
  );

  return getClient(db, id)!;
}

export type ProjectInput = {
  name: string;
  clientId?: string | null;
  description?: string;
  hourlyRateOverride?: number | null;
  status?: ProjectStatus;
  notes?: string;
  urgent?: boolean;
  important?: boolean;
  mcId?: number;
  createdAt?: string;
};

export function listProjects(db: DatabaseSync, options: { includeArchived?: boolean } = {}): Project[] {
  const where = options.includeArchived ? "" : "WHERE is_archived = 0";
  const rows = db
    .prepare(`SELECT * FROM projects ${where} ORDER BY is_archived, name COLLATE NOCASE`)
    .all() as Row[];
  return rows.map(rowToProject);
}

export function getProject(db: DatabaseSync, id: string): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToProject(row) : null;
}

export function getProjectByMcId(db: DatabaseSync, mcId: number): Project | null {
  const row = db.prepare("SELECT * FROM projects WHERE mc_id = ?").get(mcId) as Row | undefined;
  return row ? rowToProject(row) : null;
}

function assertClientExists(db: DatabaseSync, clientId: string | null | undefined): void {
  if (clientId == null) return;
  if (!getClient(db, clientId)) {
    throw new EntityValidationError("That client does not exist.");
  }
}

export function createProject(db: DatabaseSync, input: ProjectInput): Project {
  const name = text(input.name);
  if (!name) throw new EntityValidationError("A project needs a name.");
  if (input.status !== undefined && !isProjectStatus(input.status)) {
    throw new EntityValidationError(`Unknown project status "${String(input.status)}".`);
  }
  assertClientExists(db, input.clientId);

  const id = newEntityId();
  const now = nowIso();
  db.prepare(`
    INSERT INTO projects (
      id, mc_id, client_id, name, description, hourly_rate_override, status, notes,
      urgent, important, is_archived, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(
    id,
    input.mcId ?? null,
    input.clientId ?? null,
    name,
    typeof input.description === "string" ? input.description : "",
    numberOrNull(input.hourlyRateOverride),
    input.status ?? "active",
    typeof input.notes === "string" ? input.notes : "",
    input.urgent ? 1 : 0,
    input.important ? 1 : 0,
    input.createdAt ?? now,
    now
  );

  return getProject(db, id)!;
}

export function updateProject(
  db: DatabaseSync,
  id: string,
  patch: Partial<ProjectInput> & { isArchived?: boolean }
): Project {
  const existing = getProject(db, id);
  if (!existing) throw new EntityValidationError("No such project.");

  const name = patch.name === undefined ? existing.name : text(patch.name);
  if (!name) throw new EntityValidationError("A project needs a name.");
  if (patch.status !== undefined && !isProjectStatus(patch.status)) {
    throw new EntityValidationError(`Unknown project status "${String(patch.status)}".`);
  }
  if (patch.clientId !== undefined) assertClientExists(db, patch.clientId);

  db.prepare(`
    UPDATE projects SET
      name = ?, client_id = ?, description = ?, hourly_rate_override = ?, status = ?,
      notes = ?, urgent = ?, important = ?, is_archived = ?, updated_at = ?
    WHERE id = ?
  `).run(
    name,
    patch.clientId === undefined ? existing.clientId : patch.clientId,
    patch.description === undefined ? existing.description : (typeof patch.description === "string" ? patch.description : ""),
    patch.hourlyRateOverride === undefined ? existing.hourlyRateOverride : numberOrNull(patch.hourlyRateOverride),
    patch.status ?? existing.status,
    patch.notes === undefined ? existing.notes : (typeof patch.notes === "string" ? patch.notes : ""),
    (patch.urgent === undefined ? existing.urgent : patch.urgent) ? 1 : 0,
    (patch.important === undefined ? existing.important : patch.important) ? 1 : 0,
    (patch.isArchived === undefined ? existing.isArchived : patch.isArchived) ? 1 : 0,
    nowIso(),
    id
  );

  return getProject(db, id)!;
}
