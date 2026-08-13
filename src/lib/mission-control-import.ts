/**
 * One-time (but re-runnable) import of Clients and Projects from the retired
 * mission-control database. Consolidation phase 2; time entries, expenses and
 * mileage follow in phases 3-4 using the same mc_id mapping.
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

type McRow = Record<string, unknown>;

export type ImportCounts = { inserted: number; updated: number; skipped: number };
export type ImportSummary = {
  clients: ImportCounts;
  projects: ImportCounts;
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

export function runMissionControlImport(mc: DatabaseSync, dash: DatabaseSync): ImportSummary {
  const warnings: string[] = [];
  const clients: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const projects: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };

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

  return { clients, projects, warnings };
}
