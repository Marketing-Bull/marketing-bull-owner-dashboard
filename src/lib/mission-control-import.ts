/**
 * One-time (but re-runnable) import of Clients, Projects, Time, Expenses,
 * recurring definitions, accounting references, and Mileage from the retired
 * mission-control database. Consolidation phases 2–4.
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
import {
  createExpense,
  createRecurringExpense,
  getExpenseByMcId,
  getRecurringExpenseByMcId,
  isExpenseFrequency,
  isRecurringExpenseStatus,
  listExpenseCategoryAccounts,
  updateExpense,
  updateRecurringExpense,
  upsertChartAccount,
  upsertExpenseCategoryAccount,
  type ExpenseInput,
  type RecurringExpenseInput
} from "@/lib/expenses";
import {
  createMileageEntry,
  getMileageEntryByMcId,
  mileageTotal,
  setMileageRate,
  updateMileageEntry,
  type MileageInput
} from "@/lib/mileage";
import { CLIENT_STATUSES, PAYMENT_TYPES, type ExpenseFrequency, type PaymentType } from "@/lib/types";
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
  chartAccounts: ImportCounts;
  categoryAccounts: ImportCounts;
  recurringExpenses: ImportCounts;
  expenses: ImportCounts;
  mileageEntries: ImportCounts;
  settings: ImportCounts;
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

function mcDate(row: McRow, column: string, label: string, warnings: string[]): string | null {
  const raw = str(row[column]).trim().slice(0, 10);
  if (isDateKey(raw)) return raw;
  warnings.push(`${label} mc_id=${Number(row.id)}: invalid date "${str(row[column])}"; skipped`);
  return null;
}

function mcFrequency(value: unknown, fallback: ExpenseFrequency, label: string, warnings: string[]): ExpenseFrequency {
  const raw = str(value).trim().toLowerCase();
  if (isExpenseFrequency(raw)) return raw;
  if (raw) warnings.push(`${label}: unknown frequency "${raw}" imported as "${fallback}"`);
  return fallback;
}

function resolveMcRelations(
  dash: DatabaseSync,
  label: string,
  mcClientId: number | null,
  mcProjectId: number | null,
  warnings: string[]
): { clientId: string | null; projectId: string | null } {
  let clientId: string | null = null;
  if (mcClientId != null) {
    const client = getClientByMcId(dash, mcClientId);
    if (client) clientId = client.id;
    else warnings.push(`${label}: client mc_id=${mcClientId} not found; imported unassigned`);
  }
  let projectId: string | null = null;
  if (mcProjectId != null) {
    const project = getProjectByMcId(dash, mcProjectId);
    if (project) {
      projectId = project.id;
      if (clientId && project.clientId && clientId !== project.clientId) {
        warnings.push(`${label}: client disagreed with project owner; project client used`);
        clientId = project.clientId;
      } else {
        clientId ??= project.clientId;
      }
    } else {
      warnings.push(`${label}: project mc_id=${mcProjectId} not found; imported without project`);
    }
  }
  return { clientId, projectId };
}

function mapMcRecurringExpense(
  row: McRow,
  accountCode: string | null,
  warnings: string[]
): (RecurringExpenseInput & { mcId: number; mcClientId: number | null; mcProjectId: number | null }) | null {
  const mcId = Number(row.id);
  const startDate = mcDate(row, "start_date", "recurring expense", warnings);
  const amount = num(row.amount);
  if (!startDate || amount == null || amount < 0) {
    if (amount == null || amount < 0) warnings.push(`recurring expense mc_id=${mcId}: invalid amount; skipped`);
    return null;
  }
  const frequency = mcFrequency(row.frequency, "monthly", `recurring expense mc_id=${mcId}`, warnings);
  const statusRaw = str(row.status).trim().toLowerCase();
  const status = isRecurringExpenseStatus(statusRaw) ? statusRaw : "active";
  if (statusRaw && !isRecurringExpenseStatus(statusRaw)) {
    warnings.push(`recurring expense mc_id=${mcId}: unknown status "${statusRaw}" imported as active`);
  }
  return {
    mcId,
    mcClientId: num(row.client_id),
    mcProjectId: num(row.project_id),
    description: str(row.description).trim() || `Recurring expense ${mcId}`,
    vendor: str(row.vendor),
    amount,
    category: str(row.category).trim() || "Other",
    company: str(row.company),
    frequency: frequency === "none" ? "monthly" : frequency,
    dayOfMonth: num(row.day_of_month),
    startDate,
    endDate: isDateKey(str(row.end_date).slice(0, 10)) ? str(row.end_date).slice(0, 10) : null,
    status,
    notes: str(row.notes),
    paymentMethod: str(row.payment_method),
    accountCode,
    createdAt: str(row.created_at) || undefined,
    allowZero: amount === 0
  };
}

function mapMcExpense(
  row: McRow,
  accountCode: string | null,
  recurringFrequency: ExpenseFrequency | null,
  warnings: string[]
): (ExpenseInput & { mcId: number; mcClientId: number | null; mcProjectId: number | null; mcRecurringId: number | null }) | null {
  const mcId = Number(row.id);
  const date = mcDate(row, "date", "expense", warnings);
  const amount = num(row.amount);
  if (!date || amount == null || amount < 0) {
    if (amount == null || amount < 0) warnings.push(`expense mc_id=${mcId}: invalid amount; skipped`);
    return null;
  }
  const category = str(row.category).trim() || "Other";
  const rawRecurring = mcFrequency(row.recurring_type, "none", `expense mc_id=${mcId}`, warnings);
  return {
    mcId,
    mcClientId: num(row.client_id),
    mcProjectId: num(row.project_id),
    mcRecurringId: num(row.recurring_expense_id),
    date,
    amount,
    kind: category.toLowerCase() === "revenue" || accountCode === "4000" ? "income" : "expense",
    category,
    company: str(row.company),
    vendor: str(row.vendor),
    details: str(row.description),
    accountCode,
    billable: Boolean(row.is_billable),
    reimbursable: Boolean(row.is_reimbursable),
    recurring: rawRecurring === "none" && recurringFrequency ? recurringFrequency : rawRecurring,
    recurringDay: num(row.recurring_day),
    paymentMethod: str(row.payment_method),
    status: str(row.expense_status),
    tags: str(row.tags),
    createdAt: str(row.created_at) || undefined,
    allowZero: amount === 0
  };
}

function mapMcMileage(row: McRow, warnings: string[]): (MileageInput & { mcId: number; mcClientId: number | null; mcProjectId: number | null }) | null {
  const mcId = Number(row.id);
  const date = mcDate(row, "entry_date", "mileage entry", warnings);
  const miles = num(row.miles);
  if (!date || miles == null || miles <= 0 || miles > 10000) {
    if (miles == null || miles <= 0 || miles > 10000) warnings.push(`mileage entry mc_id=${mcId}: invalid miles; skipped`);
    return null;
  }
  const roundTrip = Boolean(row.is_round_trip);
  const computed = mileageTotal(miles, roundTrip);
  const stored = num(row.total_miles);
  if (stored == null || Math.abs(stored - computed) > 0.01) {
    warnings.push(`mileage entry mc_id=${mcId}: stored total ${stored ?? "unset"} replaced with computed ${computed}`);
  }
  return { mcId, mcClientId: num(row.client_id), mcProjectId: num(row.project_id),
    tripName: str(row.trip_name), date, startAddress: str(row.start_address), endAddress: str(row.end_address),
    purpose: str(row.purpose), miles, roundTrip, billable: Boolean(row.is_billable), notes: str(row.notes),
    createdAt: str(row.created_at) || undefined };
}

function importMissionControlRows(mc: DatabaseSync, dash: DatabaseSync): ImportSummary {
  const warnings: string[] = [];
  const clients: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const projects: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const timeEntries: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const chartAccounts: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const categoryAccounts: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const recurringExpenses: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const expenses: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const mileageEntries: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };
  const settings: ImportCounts = { inserted: 0, updated: 0, skipped: 0 };

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

  const existingAccountCodes = new Set(
    (dash.prepare("SELECT account_code FROM chart_accounts").all() as Array<{ account_code: string }>).map((row) => row.account_code)
  );
  const mcAccounts = mc.prepare("SELECT * FROM chart_of_accounts ORDER BY id").all() as McRow[];
  const accountCodeByMcId = new Map<number, string>();
  for (const row of mcAccounts) {
    const accountCode = str(row.account_number).trim();
    if (!accountCode) {
      chartAccounts.skipped += 1;
      warnings.push(`chart account mc_id=${Number(row.id)} has no account number; skipped`);
      continue;
    }
    upsertChartAccount(dash, {
      mcId: Number(row.id), accountCode, category: str(row.category).trim() || accountCode,
      scheduleCLine: str(row.schedule_c_line), description: str(row.irs_description), notes: str(row.notes),
      isIncome: Boolean(row.is_income), accountType: str(row.account_type) || (Boolean(row.is_income) ? "revenue" : "expense"),
      createdAt: str(row.created_at) || undefined
    });
    accountCodeByMcId.set(Number(row.id), accountCode);
    if (existingAccountCodes.has(accountCode)) chartAccounts.updated += 1;
    else { chartAccounts.inserted += 1; existingAccountCodes.add(accountCode); }
  }

  const existingCategoryAccounts = listExpenseCategoryAccounts(dash);
  const mcCategoryAccounts = mc.prepare("SELECT * FROM category_account_map ORDER BY id").all() as McRow[];
  const accountCodeByCategory = new Map<string, string>();
  for (const row of mcCategoryAccounts) {
    const category = str(row.expense_category).trim();
    const accountCode = str(row.account_code).trim();
    if (!category || !existingAccountCodes.has(accountCode)) {
      categoryAccounts.skipped += 1;
      warnings.push(`category/account mapping mc_id=${Number(row.id)} is incomplete; skipped`);
      continue;
    }
    upsertExpenseCategoryAccount(dash, category, accountCode);
    accountCodeByCategory.set(category, accountCode);
    if (existingCategoryAccounts[category]) categoryAccounts.updated += 1;
    else categoryAccounts.inserted += 1;
  }

  const accountFor = (row: McRow): string | null => {
    const direct = str(row.account_code).trim();
    if (direct && existingAccountCodes.has(direct)) return direct;
    const chartId = num(row.chart_account_id);
    if (chartId != null && accountCodeByMcId.has(chartId)) return accountCodeByMcId.get(chartId)!;
    const category = str(row.category).trim();
    if (category.toLowerCase() === "revenue" && existingAccountCodes.has("4000")) return "4000";
    return accountCodeByCategory.get(category) ?? null;
  };

  const mcRecurringExpenses = mc.prepare("SELECT * FROM recurring_expenses ORDER BY id").all() as McRow[];
  for (const row of mcRecurringExpenses) {
    const input = mapMcRecurringExpense(row, accountFor(row), warnings);
    if (!input) { recurringExpenses.skipped += 1; continue; }
    const relations = resolveMcRelations(dash, `recurring expense mc_id=${input.mcId}`, input.mcClientId, input.mcProjectId, warnings);
    const existing = getRecurringExpenseByMcId(dash, input.mcId);
    if (existing) {
      updateRecurringExpense(dash, existing.id, { ...input, ...relations });
      recurringExpenses.updated += 1;
    } else {
      createRecurringExpense(dash, { ...input, ...relations });
      recurringExpenses.inserted += 1;
    }
  }

  let zeroExpenseRows = 0;
  let incomeRows = 0;
  let unmappedExpenseRows = 0;
  let omittedReceiptPaths = 0;
  const mcExpenses = mc.prepare("SELECT * FROM expenses ORDER BY id").all() as McRow[];
  for (const row of mcExpenses) {
    const mcRecurringId = num(row.recurring_expense_id);
    const recurringDefinition = mcRecurringId == null ? null : getRecurringExpenseByMcId(dash, mcRecurringId);
    const accountCode = accountFor(row);
    const input = mapMcExpense(row, accountCode, recurringDefinition?.frequency ?? null, warnings);
    if (!input) { expenses.skipped += 1; continue; }
    if (input.amount === 0) zeroExpenseRows += 1;
    if (input.kind === "income") incomeRows += 1;
    if (!accountCode) unmappedExpenseRows += 1;
    if (str(row.receipt_path).trim()) omittedReceiptPaths += 1;
    const relations = resolveMcRelations(dash, `expense mc_id=${input.mcId}`, input.mcClientId, input.mcProjectId, warnings);
    const recurringExpenseId = recurringDefinition?.id ?? null;
    if (mcRecurringId != null && !recurringDefinition) {
      warnings.push(`expense mc_id=${input.mcId}: recurring definition mc_id=${mcRecurringId} not found; link omitted`);
    }
    const existing = getExpenseByMcId(dash, input.mcId);
    if (existing) {
      updateExpense(dash, existing.id, { ...input, ...relations, recurringExpenseId });
      expenses.updated += 1;
    } else {
      createExpense(dash, { ...input, ...relations, recurringExpenseId });
      expenses.inserted += 1;
    }
  }
  if (zeroExpenseRows) warnings.push(`${zeroExpenseRows} zero-dollar source expense rows were preserved`);
  if (incomeRows) warnings.push(`${incomeRows} source rows categorized Revenue were preserved as income, not expenses`);
  if (unmappedExpenseRows) warnings.push(`${unmappedExpenseRows} source rows had no category/account mapping; account code left unset`);
  if (omittedReceiptPaths) warnings.push(`${omittedReceiptPaths} source receipt paths were not copied; attach the files again in this app`);

  const mcMileage = mc.prepare("SELECT * FROM mileage_entries ORDER BY id").all() as McRow[];
  for (const row of mcMileage) {
    const input = mapMcMileage(row, warnings);
    if (!input) { mileageEntries.skipped += 1; continue; }
    const relations = resolveMcRelations(dash, `mileage entry mc_id=${input.mcId}`, input.mcClientId, input.mcProjectId, warnings);
    const existing = getMileageEntryByMcId(dash, input.mcId);
    if (existing) {
      updateMileageEntry(dash, existing.id, { ...input, ...relations });
      mileageEntries.updated += 1;
    } else {
      createMileageEntry(dash, { ...input, ...relations });
      mileageEntries.inserted += 1;
    }
  }

  const mileageSetting = mc.prepare("SELECT value FROM settings WHERE key='mileage_rate'").get() as { value?: unknown } | undefined;
  const mileageRate = num(mileageSetting?.value);
  if (mileageRate != null && mileageRate >= 0 && mileageRate <= 10) {
    setMileageRate(dash, mileageRate);
    settings.updated += 1;
  } else {
    settings.skipped += 1;
    warnings.push("mileage_rate setting missing or invalid; dashboard default kept");
  }

  return { clients, projects, timeEntries, chartAccounts, categoryAccounts, recurringExpenses, expenses, mileageEntries, settings, warnings };
}

export function runMissionControlImport(mc: DatabaseSync, dash: DatabaseSync): ImportSummary {
  // Every imported layer moves together. A malformed late-stage row must not
  // leave clients updated but expenses or mileage only half imported.
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
