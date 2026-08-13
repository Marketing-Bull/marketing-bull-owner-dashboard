/**
 * One-time (but re-runnable) import of Clients, Projects, and Time Entries
 * from the retired mission-control database. Consolidation phases 2–3;
 * expenses and mileage follow in phase 4 using the same mc_id mapping.
 *
 * Idempotent by design: every mission-control row keeps its original id in
 * `mc_id`, and the import upserts on it. Running the import twice, or running
 * it again after a newer copy of the MC database arrives, converges instead of
 * duplicating.
 *
 * Cleaning rules come from profiling the live file (scope §09):
 * - client statuses arrive as "active" / "On Hold" / "on hold" / "prospect"
 *   and are normalized; anything unrecognized becomes "active" WITH a warning,
 *   because silently guessing a status is how imports lie.
 * - mission-control's agent-workspace fields (path, session_key,
 *   rag_last_indexed, next_action, pipeline_position, status_changed_at) are
 *   deliberately not carried; they describe MC's own machinery, not the domain.
 * - soft-deleted MC projects are skipped and counted, not resurrected.
 * - original created_at survives; updated_at is stamped at import time.
 */

import type { DatabaseSync } from "node:sqlite";
import {
  createClient,
  createProject,
  getClientByMcId,
  getProjectByMcId,
  isProjectStatus,
  normalizeClientStatus,
  updateClient,
  updateProject,
  type ClientInput,
  type ProjectInput
} from "@/lib/entities";
import { CLIENT_STATUSES, PAYMENT_TYPES, type PaymentType } from "@/lib/types";
import {
  createTimeEntry,
  getTimeEntryByMcId,
  isDateKey,
  updateTimeEntry,
  type TimeEntryInput
} from "@/lib/time-entries";

type McRow = Record<string, unknown>;

export type ImportCounts = { inserted: number; updated: number; skipped: number };
export type ImportSummary = {
  clients: ImportCounts;
  projects: ImportCounts;
  timeEntries: ImportCounts;
  warnings: string[];
};

function str(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Money fields where mission-control's schema default was 0: there, 0 means
 * "never filled in", not "costs nothing", so it imports as null. A client
 * whose MRR is genuinely zero is not a thing MC could express.
 */
function moneyOrNull(value: unknown): number | null {
  const parsed = num(value);
  return parsed === 0 ? null : parsed;
}

/** MC's live data holds "mrr" and "one-time"; map anything else with a warning. */
function mapPaymentType(raw: string, warnings: string[], clientName: string): PaymentType {
  const canonical = raw.trim().toLowerCase();
  if ((PAYMENT_TYPES as readonly string[]).includes(canonical)) return canonical as PaymentType;
  if (canonical) {
    warnings.push(`client "${clientName}": unknown payment_type "${raw}" imported as "mrr"`);
  }
  return "mrr";
}

export function mapMcClient(row: McRow, warnings: string[]): ClientInput & { mcId: number } {
  const name = str(row.name).trim();
  const rawStatus = str(row.status);
  const status = normalizeClientStatus(rawStatus);
  const canonical = rawStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (rawStatus && !(CLIENT_STATUSES as readonly string[]).includes(canonical)) {
    warnings.push(`client "${name}": unknown status "${rawStatus}" imported as "active"`);
  }

  return {
    mcId: Number(row.id),
    name,
    status,
    paymentType: mapPaymentType(str(row.payment_type), warnings, name),
    mrr: moneyOrNull(row.mrr),
    hourlyRate: moneyOrNull(row.hourly_rate),
    projectEstCost: moneyOrNull(row.project_est_cost),
    paidThroughDate: str(row.paid_through_date),
    invoiceStatus: str(row.invoice_status),
    contactName: str(row.primary_contact),
    contactEmail: str(row.email),
    contactPhone: str(row.phone),
    notes: str(row.notes),
    createdAt: str(row.created_at) || undefined
  };
}

export function mapMcProject(row: McRow, warnings: string[]): ProjectInput & { mcId: number } {
  const name = str(row.name).trim();
  const rawStatus = str(row.status).trim().toLowerCase().replace(/[\s-]+/g, "_");
  let status: ProjectInput["status"];
  if (isProjectStatus(rawStatus)) {
    status = rawStatus;
  } else {
    if (rawStatus) {
      warnings.push(`project "${name}": unknown status "${str(row.status)}" imported as "active"`);
    }
    status = "active";
  }

  return {
    mcId: Number(row.id),
    name,
    // MC has a single hourly_rate on the project with NULL meaning "use the
    // client rate" -- exactly the override semantics of the target schema.
    hourlyRateOverride: num(row.hourly_rate),
    description: str(row.description),
    status,
    createdAt: str(row.created_at) || undefined
  };
}

function timeEntryDate(row: McRow, warnings: string[]): string | null {
  const mcId = Number(row.id);
  const rawDate = str(row.entry_date).trim();
  const datePrefix = rawDate.slice(0, 10);
  if (isDateKey(datePrefix)) return datePrefix;

  // The profiled live file has one `10:30` in entry_date. The original day is
  // gone, but created_at still gives a defensible day; make the repair loud.
  const createdDate = str(row.created_at).trim().slice(0, 10);
  if (isDateKey(createdDate)) {
    warnings.push(
      `time entry mc_id=${mcId}: invalid entry_date "${rawDate}" replaced with created_at day ${createdDate}`
    );
    return createdDate;
  }

  warnings.push(`time entry mc_id=${mcId}: no valid entry_date or created_at day; skipped`);
  return null;
}

function timeEntryHours(row: McRow, warnings: string[]): number | null {
  const mcId = Number(row.id);
  const direct = num(row.duration_hours);
  if (direct != null && direct > 0 && direct <= 24) return direct;

  const minutes = num(row.duration_minutes);
  if (minutes != null && minutes > 0 && minutes <= 24 * 60) return minutes / 60;

  warnings.push(`time entry mc_id=${mcId}: invalid duration; skipped`);
  return null;
}

function timeEntryDetails(row: McRow): string {
  const parts: string[] = [];
  const description = str(row.description).trim();
  const notes = str(row.notes).trim();
  const taskTitle = str(row.task_title).trim();
  if (description) parts.push(description);
  if (notes && notes !== description) parts.push(notes);
  if (taskTitle) parts.push(`Task: ${taskTitle}`);
  return parts.join("\n\n");
}

export function mapMcTimeEntry(
  row: McRow,
  warnings: string[]
): (TimeEntryInput & { mcId: number; mcClientId: number | null; mcProjectId: number | null }) | null {
  const date = timeEntryDate(row, warnings);
  const hours = timeEntryHours(row, warnings);
  if (!date || hours == null) return null;

  const legacyRate = num(row.hourly_rate);
  return {
    mcId: Number(row.id),
    mcClientId: num(row.client_id),
    mcProjectId: num(row.project_id),
    date,
    hours,
    billable: Boolean(row.is_billable),
    details: timeEntryDetails(row),
    startTime: str(row.start_time).trim() || null,
    endTime: str(row.end_time).trim() || null,
    frozenRate: legacyRate != null && legacyRate >= 0 ? legacyRate : undefined,
    createdAt: str(row.created_at) || undefined
  };
}

function importMissionControlRows(mc: DatabaseSync, dash: DatabaseSync): ImportSummary {
  const warnings: string[] = [];
  const clients: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const projects: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const timeEntries: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };

  const mcClients = mc.prepare("SELECT * FROM clients ORDER BY id").all() as McRow[];
  for (const row of mcClients) {
    const input = mapMcClient(row, warnings);
    if (!input.name) {
      warnings.push(`client mc_id=${input.mcId} has no name; skipped`);
      clients.skipped += 1;
      continue;
    }

    const existing = getClientByMcId(dash, input.mcId);
    if (existing) {
      updateClient(dash, existing.id, input);
      clients.updated += 1;
    } else {
      createClient(dash, input);
      clients.inserted += 1;
    }
  }

  const mcProjects = mc
    .prepare("SELECT * FROM projects WHERE COALESCE(is_deleted, 0) = 0 ORDER BY id")
    .all() as McRow[];
  const deletedCount = (
    mc.prepare("SELECT COUNT(*) AS n FROM projects WHERE COALESCE(is_deleted, 0) = 1").get() as {
      n: number;
    }
  ).n;
  projects.skipped += deletedCount;

  for (const row of mcProjects) {
    const input = mapMcProject(row, warnings);
    if (!input.name) {
      warnings.push(`project mc_id=${input.mcId} has no name; skipped`);
      projects.skipped += 1;
      continue;
    }

    // Resolve the MC client id to the imported client's UUID. A dangling
    // reference imports as unassigned rather than failing the row.
    const mcClientId = num(row.client_id);
    let clientId: string | null = null;
    if (mcClientId != null) {
      const owner = getClientByMcId(dash, mcClientId);
      if (owner) {
        clientId = owner.id;
      } else {
        warnings.push(`project "${input.name}": client mc_id=${mcClientId} not found; imported unassigned`);
      }
    }

    const existing = getProjectByMcId(dash, input.mcId);
    if (existing) {
      updateProject(dash, existing.id, { ...input, clientId });
      projects.updated += 1;
    } else {
      createProject(dash, { ...input, clientId });
      projects.inserted += 1;
    }
  }

  const mcTimeEntries = mc.prepare(`
    SELECT te.*, t.title AS task_title
    FROM time_entries te
    LEFT JOIN tasks t ON t.id = te.task_id
    ORDER BY te.id
  `).all() as McRow[];

  for (const row of mcTimeEntries) {
    const input = mapMcTimeEntry(row, warnings);
    if (!input) {
      timeEntries.skipped += 1;
      continue;
    }

    let clientId: string | null = null;
    if (input.mcClientId != null) {
      const client = getClientByMcId(dash, input.mcClientId);
      if (client) {
        clientId = client.id;
      } else {
        warnings.push(
          `time entry mc_id=${input.mcId}: client mc_id=${input.mcClientId} not found; imported unassigned`
        );
      }
    }

    let projectId: string | null = null;
    if (input.mcProjectId != null) {
      const project = getProjectByMcId(dash, input.mcProjectId);
      if (project) {
        projectId = project.id;
        // The project's imported client is authoritative when the legacy time
        // row omitted or contradicted its own client_id.
        if (clientId && project.clientId && clientId !== project.clientId) {
          warnings.push(
            `time entry mc_id=${input.mcId}: client disagreed with project owner; project client used`
          );
          clientId = project.clientId;
        } else {
          clientId ??= project.clientId;
        }
      } else {
        warnings.push(
          `time entry mc_id=${input.mcId}: project mc_id=${input.mcProjectId} not found; imported without project`
        );
      }
    }

    const existing = getTimeEntryByMcId(dash, input.mcId);
    const entryInput: TimeEntryInput = {
      mcId: input.mcId,
      date: input.date,
      hours: input.hours,
      billable: input.billable,
      details: input.details,
      frozenRate: input.frozenRate,
      startTime: input.startTime,
      endTime: input.endTime,
      createdAt: input.createdAt
    };
    if (existing) {
      updateTimeEntry(dash, existing.id, { ...entryInput, clientId, projectId });
      timeEntries.updated += 1;
    } else {
      createTimeEntry(dash, { ...entryInput, clientId, projectId });
      timeEntries.inserted += 1;
    }
  }

  return { clients, projects, timeEntries, warnings };
}

export function runMissionControlImport(mc: DatabaseSync, dash: DatabaseSync): ImportSummary {
  // All three entity layers move together. A malformed legacy row must not
  // leave clients updated but time only half imported.
  dash.exec("BEGIN");
  try {
    const summary = importMissionControlRows(mc, dash);
    dash.exec("COMMIT");
    return summary;
  } catch (error) {
    dash.exec("ROLLBACK");
    throw error;
  }
}
