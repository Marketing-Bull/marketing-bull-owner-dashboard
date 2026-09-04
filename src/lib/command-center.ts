/**
 * The Command Center model: one derived read of everything the dashboard owns.
 *
 * The original dashboard is a scratchpad — MRR, goals, and the daily win are
 * strings somebody types in, and the numbers are only as true as the last time
 * they were retyped. Since phases 2-4 the app owns clients, projects, time,
 * expenses, recurring costs, accounting references, and mileage, so the money
 * and the workload can be *computed* instead. Every figure below traces back
 * to a row in a ledger, with one deliberate exception: the typed `mrr.current`
 * is read from `dashboard_state` — never shown as a figure of its own, only
 * held up against the derived MRR so a disagreement is visible.
 *
 * Everything is assembled server-side in one pass. The alternative — five
 * fetches and a pile of client-side reducers, which is how the old screen grew
 * to 1,800 lines — puts the arithmetic somewhere it cannot be tested. Here the
 * aggregation is a function of (database, day) and the exception rules are a
 * pure function of the aggregates, so both are covered in
 * `command-center.test.ts`.
 */

import type { DatabaseSync } from "node:sqlite";
import { dayKey } from "@/lib/calendar-days";
import { getClickUpTaskSyncInfo } from "@/lib/clickup-task-cache";
import { queryClickUpTasks } from "@/lib/clickup-tasks";
import { todayKey } from "@/lib/history";
import { getMileageRate } from "@/lib/mileage";
import type { ClickUpTaskRecord } from "@/lib/types";

export const COMMAND_PERIODS = ["mtd", "last-month", "qtd", "ytd"] as const;
export type CommandPeriodKey = (typeof COMMAND_PERIODS)[number];

export const DEFAULT_COMMAND_PERIOD: CommandPeriodKey = "mtd";

export function isCommandPeriod(value: unknown): value is CommandPeriodKey {
  return COMMAND_PERIODS.includes(value as CommandPeriodKey);
}

/**
 * A window and the window it is compared against, both inclusive `YYYY-MM-DD`.
 *
 * The comparison window is always the same *elapsed* length as the current one,
 * clamped to its own calendar boundary: on the 8th of the month, month-to-date
 * is measured against the 1st-8th of last month, not against a full month that
 * would always look bigger. A comparison that flatters or scares by construction
 * is worse than no comparison.
 */
export type CommandPeriod = {
  key: CommandPeriodKey;
  label: string;
  comparisonLabel: string;
  from: string;
  to: string;
  days: number;
  previousFrom: string;
  previousTo: string;
};

export type MoneyBand = {
  income: number;
  expenses: number;
  net: number;
  /** Net as a share of income; null when nothing came in, since 0/0 is not 0%. */
  margin: number | null;
  previousIncome: number;
  previousExpenses: number;
  previousNet: number;
  /** Sum of `mrr` across active clients — the retainer book, not a typed-in guess. */
  committedMrr: number;
  mrrClients: number;
  /** Active recurring definitions normalized to a monthly figure. */
  fixedMonthlyCost: number;
  recurringCount: number;
  /** What the retainer book has to cover before an hour is worked. */
  fixedCoverage: number | null;
  /** The classic dashboard's hand-typed `mrr.current`; null when blank. */
  typedMrr: number | null;
  /**
   * How far the client rows and the typed figure disagree, or null when they
   * agree within tolerance or there is nothing to compare. The scope doc's
   * warning made concrete: the derived figure must not quietly replace the
   * typed one while the client records are stale.
   */
  mrrGap: number | null;
};

export type WorkBand = {
  hours: number;
  billableHours: number;
  /** Hours x the rate frozen on each row, billable rows only. */
  billableValue: number;
  entries: number;
  daysWorked: number;
  /** Billable value over *all* hours worked: what an hour really earned. */
  blendedRate: number | null;
  previousHours: number;
  previousBillableValue: number;
  /** Billable hours saved against a $0 rate — work that cannot be invoiced. */
  unratedBillableHours: number;
  unratedBillableEntries: number;
};

export type ReimbursableBand = {
  expenses: number;
  mileageMiles: number;
  mileageAmount: number;
  mileageRate: number;
  total: number;
};

export type TrendPoint = {
  /** `YYYY-MM`. */
  month: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  hours: number;
};

export type ClientRollup = {
  id: string;
  name: string;
  status: string;
  paymentType: string;
  mrr: number | null;
  hourlyRate: number | null;
  paidThroughDate: string;
  invoiceStatus: string;
  hours: number;
  billableValue: number;
  income: number;
  lastActivity: string | null;
  /**
   * Billable value delivered against the retainer, as a ratio. Above 1 means
   * the month's work is worth more than the retainer collects for it. Only
   * meaningful for a monthly window, so it is null on quarter/year views.
   */
  retainerCoverage: number | null;
};

export type ProjectRollup = {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  urgent: boolean;
  important: boolean;
  hours: number;
  billableValue: number;
  lastActivity: string | null;
};

/** Fixed status roles; each ships with its own label, never colour alone. */
export type AttentionSeverity = "critical" | "serious" | "warning";

export type AttentionItem = {
  id: string;
  severity: AttentionSeverity;
  title: string;
  detail: string;
  href: string;
  actionLabel: string;
  count?: number;
  amount?: number;
};

export type TaxSnapshot = {
  year: number;
  income: number;
  deductible: number;
  net: number;
  uncategorizedCount: number;
  uncategorizedAmount: number;
  missingReceiptCount: number;
  missingReceiptAmount: number;
  mileageMiles: number;
  mileageRate: number;
  mileageDeduction: number;
  lines: Array<{ line: string; category: string; amount: number }>;
};

/** A row written to any ledger, normalized enough to list them together. */
export type ActivityItem = {
  id: string;
  kind: "time" | "expense" | "income" | "mileage";
  date: string;
  title: string;
  subtitle: string;
  /** Money value: billable amount, expense/income amount, or reimbursement. */
  amount: number;
  /** Hours for time, miles for mileage, null for money rows. */
  quantity: number | null;
  href: string;
};

/** The fields the screen needs from a cached task; the Tasks ledger keeps the rest. */
export type TaskBrief = {
  id: string;
  name: string;
  url: string | null;
  /** Epoch ms as ClickUp reports it; null when undated. */
  dueDate: number | null;
  priority: string | null;
  clientName: string | null;
  projectName: string | null;
  listName: string | null;
};

export type TaskBand = {
  open: number;
  /** Due before now — the Tasks screen's definition, kept identical here. */
  overdue: number;
  dueToday: number;
  /** Due within the next seven days, counted from now. */
  dueSoon: number;
  /** Soonest due first, undated last. */
  next: TaskBrief[];
  /** Longest overdue first — what the attention rule names. */
  mostOverdue: TaskBrief[];
  lastSyncedAt: string | null;
  stale: boolean;
  syncError: string | null;
};

export type CadenceSnapshot = {
  hoursToday: number;
  hoursThisWeek: number;
  lastEntryDate: string | null;
  daysSinceLastEntry: number | null;
  loggedDaysLast14: number;
  /** Consecutive days ending today (or yesterday) with time logged. */
  streakDays: number;
};

export type CommandCenterPayload = {
  generatedAt: string;
  today: string;
  period: CommandPeriod;
  money: MoneyBand;
  work: WorkBand;
  reimbursable: ReimbursableBand;
  trend: TrendPoint[];
  clients: ClientRollup[];
  projects: ProjectRollup[];
  activity: ActivityItem[];
  tasks: TaskBand;
  attention: AttentionItem[];
  tax: TaxSnapshot;
  cadence: CadenceSnapshot;
  totals: {
    activeClients: number;
    prospects: number;
    activeProjects: number;
    timeEntries: number;
    expenseRecords: number;
    mileageEntries: number;
  };
};

/** Receipts stop being optional here (IRS substantiation threshold). */
export const RECEIPT_THRESHOLD = 75;

/** A client with no time, money, or trip against it for this long is drifting. */
export const SILENT_CLIENT_DAYS = 30;

/** Client-row MRR and the typed figure may differ by this share before it is a finding… */
export const MRR_MISMATCH_TOLERANCE = 0.1;
/** …and by at least this much in dollars, so a $40 rounding gap stays quiet. */
export const MRR_MISMATCH_FLOOR = 100;

/**
 * The classic dashboard stores money as whatever was typed — "42500",
 * "$42,500", "42,500/mo". Anything that is not a positive number is treated as
 * blank rather than as zero, since a blank field is not a claim.
 */
export function parseTypedMoney(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * The gap between derived and typed MRR when it is worth raising, else null.
 *
 * Null when either side is missing or when no client rows exist at all — on
 * an empty database the typed figure is the sample default and there is
 * nothing to reconcile it against.
 */
export function mrrGapAmount(committedMrr: number, typedMrr: number | null, clientCount: number): number | null {
  if (typedMrr === null || clientCount <= 0) return null;
  const gap = Math.abs(committedMrr - typedMrr);
  const scale = Math.max(committedMrr, typedMrr);
  if (scale <= 0 || gap < MRR_MISMATCH_FLOOR || gap / scale < MRR_MISMATCH_TOLERANCE) return null;
  return money(gap);
}

const MONTHS_OF_TREND = 12;

/** Number-ish DB values arrive as number | bigint | string depending on the sum. */
function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): number {
  return Math.round(value * 100) / 100;
}

function hours(value: number): number {
  return Math.round(value * 100) / 100;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseDayKey(day: string): { year: number; month: number; date: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), date: Number(match[3]) };
}

function formatDayKey(year: number, month: number, date: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
}

/** Days in `month` (1-12) of `year`; day 0 of the next month is the last of this one. */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function startOfMonth(day: string): string {
  const parts = parseDayKey(day);
  if (!parts) return day;
  return formatDayKey(parts.year, parts.month, 1);
}

/** Moves whole months without ever landing on a day that month does not have. */
function shiftMonth(day: string, deltaMonths: number): string {
  const parts = parseDayKey(day);
  if (!parts) return day;
  const anchor = new Date(parts.year, parts.month - 1 + deltaMonths, 1, 12);
  const year = anchor.getFullYear();
  const month = anchor.getMonth() + 1;
  return formatDayKey(year, month, Math.min(parts.date, daysInMonth(year, month)));
}

function endOfMonth(day: string): string {
  const parts = parseDayKey(day);
  if (!parts) return day;
  return formatDayKey(parts.year, parts.month, daysInMonth(parts.year, parts.month));
}

/**
 * Inclusive day count between two keys.
 *
 * Anchored at noon for the same reason `shiftDayKey` is: in zones where DST
 * skips midnight, a midnight anchor silently loses a day.
 */
export function daysBetween(from: string, to: string): number {
  const start = parseDayKey(from);
  const end = parseDayKey(to);
  if (!start || !end) return 0;
  const startMs = new Date(start.year, start.month - 1, start.date, 12).getTime();
  const endMs = new Date(end.year, end.month - 1, end.date, 12).getTime();
  return Math.round((endMs - startMs) / 86_400_000) + 1;
}

function addDays(day: string, delta: number): string {
  const parts = parseDayKey(day);
  if (!parts) return day;
  const anchor = new Date(parts.year, parts.month - 1, parts.date, 12);
  anchor.setDate(anchor.getDate() + delta);
  return formatDayKey(anchor.getFullYear(), anchor.getMonth() + 1, anchor.getDate());
}

function minDay(a: string, b: string): string {
  return a <= b ? a : b;
}

function quarterStart(day: string): string {
  const parts = parseDayKey(day);
  if (!parts) return day;
  return formatDayKey(parts.year, Math.floor((parts.month - 1) / 3) * 3 + 1, 1);
}

const PERIOD_LABELS: Record<CommandPeriodKey, string> = {
  mtd: "Month to date",
  "last-month": "Last month",
  qtd: "Quarter to date",
  ytd: "Year to date"
};

/**
 * Resolves a period key into its window and its like-for-like comparison.
 *
 * The comparison always starts at the previous window's own beginning and runs
 * the same number of elapsed days, never past that window's end.
 */
export function resolvePeriod(key: CommandPeriodKey, today: string = todayKey()): CommandPeriod {
  const label = PERIOD_LABELS[key];

  if (key === "last-month") {
    const from = startOfMonth(shiftMonth(startOfMonth(today), -1));
    const to = endOfMonth(from);
    const previousFrom = shiftMonth(from, -1);
    return {
      key,
      label,
      comparisonLabel: "vs the month before",
      from,
      to,
      days: daysBetween(from, to),
      previousFrom,
      previousTo: endOfMonth(previousFrom)
    };
  }

  const from =
    key === "mtd" ? startOfMonth(today) : key === "qtd" ? quarterStart(today) : `${today.slice(0, 4)}-01-01`;
  const to = today;
  const days = daysBetween(from, to);

  const previousFrom =
    key === "mtd"
      ? startOfMonth(shiftMonth(from, -1))
      : key === "qtd"
        ? shiftMonth(from, -3)
        : `${Number(today.slice(0, 4)) - 1}-01-01`;

  const previousWindowEnd =
    key === "mtd"
      ? endOfMonth(previousFrom)
      : key === "qtd"
        ? endOfMonth(shiftMonth(previousFrom, 2))
        : `${previousFrom.slice(0, 4)}-12-31`;

  return {
    key,
    label,
    comparisonLabel:
      key === "mtd" ? "vs same days last month" : key === "qtd" ? "vs same days last quarter" : "vs same days last year",
    from,
    to,
    days,
    previousFrom,
    previousTo: minDay(addDays(previousFrom, days - 1), previousWindowEnd)
  };
}

type Row = Record<string, unknown>;

function moneyTotals(db: DatabaseSync, from: string, to: string): { income: number; expenses: number } {
  const rows = db
    .prepare(
      `SELECT kind, COALESCE(SUM(amount), 0) AS total
       FROM expenses WHERE date >= ? AND date <= ? GROUP BY kind`
    )
    .all(from, to) as Row[];

  let income = 0;
  let expenses = 0;
  for (const row of rows) {
    if (text(row.kind) === "income") income += num(row.total);
    else expenses += num(row.total);
  }
  return { income: money(income), expenses: money(expenses) };
}

function workTotals(
  db: DatabaseSync,
  from: string,
  to: string
): Omit<WorkBand, "previousHours" | "previousBillableValue" | "blendedRate"> {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(hours), 0) AS hours,
         COALESCE(SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END), 0) AS billable_hours,
         COALESCE(SUM(CASE WHEN billable = 1 THEN hours * rate ELSE 0 END), 0) AS billable_value,
         COUNT(*) AS entries,
         COUNT(DISTINCT date) AS days_worked,
         COALESCE(SUM(CASE WHEN billable = 1 AND rate <= 0 THEN hours ELSE 0 END), 0) AS unrated_hours,
         COALESCE(SUM(CASE WHEN billable = 1 AND rate <= 0 THEN 1 ELSE 0 END), 0) AS unrated_entries
       FROM time_entries WHERE date >= ? AND date <= ?`
    )
    .get(from, to) as Row;

  return {
    hours: hours(num(row.hours)),
    billableHours: hours(num(row.billable_hours)),
    billableValue: money(num(row.billable_value)),
    entries: num(row.entries),
    daysWorked: num(row.days_worked),
    unratedBillableHours: hours(num(row.unrated_hours)),
    unratedBillableEntries: num(row.unrated_entries)
  };
}

function reimbursableBand(db: DatabaseSync, from: string, to: string): ReimbursableBand {
  const expenseRow = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE kind = 'expense' AND (reimbursable = 1 OR billable = 1) AND date >= ? AND date <= ?`
    )
    .get(from, to) as Row;

  const mileageRow = db
    .prepare(
      `SELECT COALESCE(SUM(total_miles), 0) AS miles FROM mileage_entries
       WHERE billable = 1 AND date >= ? AND date <= ?`
    )
    .get(from, to) as Row;

  const rate = getMileageRate(db);
  const miles = Math.round(num(mileageRow.miles) * 10) / 10;
  const mileageAmount = money(miles * rate);
  const expenses = money(num(expenseRow.total));

  return {
    expenses,
    mileageMiles: miles,
    mileageAmount,
    mileageRate: rate,
    total: money(expenses + mileageAmount)
  };
}

/**
 * Recurring definitions as one monthly number.
 *
 * Weekly is annualized then divided rather than multiplied by 4: a month holds
 * 4.33 weeks, and rounding that down understates fixed costs by nearly a month
 * a year — exactly the kind of quiet optimism this screen exists to remove.
 */
export function monthlyRecurringCost(
  rows: Array<{ amount: number; frequency: string }>
): number {
  let total = 0;
  for (const row of rows) {
    const amount = Number(row.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    switch (row.frequency) {
      case "weekly":
        total += (amount * 52) / 12;
        break;
      case "monthly":
        total += amount;
        break;
      case "quarterly":
        total += amount / 3;
        break;
      case "yearly":
        total += amount / 12;
        break;
      default:
        break;
    }
  }
  return money(total);
}

function moneyBand(db: DatabaseSync, period: CommandPeriod): MoneyBand {
  const current = moneyTotals(db, period.from, period.to);
  const previous = moneyTotals(db, period.previousFrom, period.previousTo);

  const clientRow = db
    .prepare(
      `SELECT COALESCE(SUM(mrr), 0) AS mrr, COUNT(*) AS clients FROM clients
       WHERE is_archived = 0 AND status = 'active' AND mrr IS NOT NULL AND mrr > 0`
    )
    .get() as Row;

  const recurringRows = db
    .prepare("SELECT amount, frequency FROM recurring_expenses WHERE status = 'active'")
    .all() as Row[];

  const typedRow = db
    .prepare("SELECT mrr_current FROM dashboard_state WHERE id = 1")
    .get() as Row | undefined;
  const clientCount = num(
    (db.prepare("SELECT COUNT(*) AS count FROM clients WHERE is_archived = 0").get() as Row).count
  );

  const committedMrr = money(num(clientRow.mrr));
  const typedMrr = parseTypedMoney(typedRow?.mrr_current);
  const fixedMonthlyCost = monthlyRecurringCost(
    recurringRows.map((row) => ({ amount: num(row.amount), frequency: text(row.frequency) }))
  );
  const net = money(current.income - current.expenses);

  return {
    income: current.income,
    expenses: current.expenses,
    net,
    margin: current.income > 0 ? net / current.income : null,
    previousIncome: previous.income,
    previousExpenses: previous.expenses,
    previousNet: money(previous.income - previous.expenses),
    committedMrr,
    mrrClients: num(clientRow.clients),
    fixedMonthlyCost,
    recurringCount: recurringRows.length,
    fixedCoverage: fixedMonthlyCost > 0 ? committedMrr / fixedMonthlyCost : null,
    typedMrr,
    mrrGap: mrrGapAmount(committedMrr, typedMrr, clientCount)
  };
}

function monthlyTrend(db: DatabaseSync, today: string): TrendPoint[] {
  const firstMonth = startOfMonth(shiftMonth(startOfMonth(today), -(MONTHS_OF_TREND - 1)));

  const moneyRows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, kind, COALESCE(SUM(amount), 0) AS total
       FROM expenses WHERE date >= ? AND date <= ? GROUP BY month, kind`
    )
    .all(firstMonth, endOfMonth(today)) as Row[];

  const hoursRows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, COALESCE(SUM(hours), 0) AS total
       FROM time_entries WHERE date >= ? AND date <= ? GROUP BY month`
    )
    .all(firstMonth, endOfMonth(today)) as Row[];

  const byMonth = new Map<string, { income: number; expenses: number; hours: number }>();
  for (let index = 0; index < MONTHS_OF_TREND; index += 1) {
    byMonth.set(shiftMonth(firstMonth, index).slice(0, 7), { income: 0, expenses: 0, hours: 0 });
  }

  for (const row of moneyRows) {
    const bucket = byMonth.get(text(row.month));
    if (!bucket) continue;
    if (text(row.kind) === "income") bucket.income += num(row.total);
    else bucket.expenses += num(row.total);
  }
  for (const row of hoursRows) {
    const bucket = byMonth.get(text(row.month));
    if (bucket) bucket.hours += num(row.total);
  }

  return [...byMonth.entries()].map(([month, bucket]) => ({
    month,
    label: monthLabel(month),
    income: money(bucket.income),
    expenses: money(bucket.expenses),
    net: money(bucket.income - bucket.expenses),
    hours: hours(bucket.hours)
  }));
}

function monthLabel(month: string): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(index)) return month;
  return new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(year, index, 1));
}

function clientRollups(db: DatabaseSync, period: CommandPeriod): ClientRollup[] {
  const clients = db
    .prepare(
      `SELECT id, name, status, payment_type, mrr, hourly_rate, paid_through_date, invoice_status
       FROM clients WHERE is_archived = 0 ORDER BY name COLLATE NOCASE`
    )
    .all() as Row[];

  const timeRows = db
    .prepare(
      `SELECT client_id,
              COALESCE(SUM(hours), 0) AS hours,
              COALESCE(SUM(CASE WHEN billable = 1 THEN hours * rate ELSE 0 END), 0) AS value
       FROM time_entries WHERE date >= ? AND date <= ? AND client_id IS NOT NULL GROUP BY client_id`
    )
    .all(period.from, period.to) as Row[];

  const incomeRows = db
    .prepare(
      `SELECT client_id, COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE kind = 'income' AND date >= ? AND date <= ? AND client_id IS NOT NULL GROUP BY client_id`
    )
    .all(period.from, period.to) as Row[];

  // Last activity spans every ledger: a client can be quiet in time but active
  // in money, and calling that dormant would be wrong.
  const activityRows = db
    .prepare(
      `SELECT client_id, MAX(day) AS day FROM (
         SELECT client_id, MAX(date) AS day FROM time_entries WHERE client_id IS NOT NULL GROUP BY client_id
         UNION ALL
         SELECT client_id, MAX(date) AS day FROM expenses WHERE client_id IS NOT NULL GROUP BY client_id
         UNION ALL
         SELECT client_id, MAX(date) AS day FROM mileage_entries WHERE client_id IS NOT NULL GROUP BY client_id
       ) GROUP BY client_id`
    )
    .all() as Row[];

  const timeByClient = new Map(timeRows.map((row) => [text(row.client_id), row]));
  const incomeByClient = new Map(incomeRows.map((row) => [text(row.client_id), num(row.total)]));
  const activityByClient = new Map(activityRows.map((row) => [text(row.client_id), text(row.day)]));

  // A retainer covers a month. Comparing a quarter of delivery against one
  // month of MRR would manufacture an alarm, so the ratio is monthly-only.
  const monthlyWindow = period.key === "mtd" || period.key === "last-month";

  return clients.map((client) => {
    const id = text(client.id);
    const time = timeByClient.get(id);
    const value = money(num(time?.value));
    const mrr = client.mrr === null || client.mrr === undefined ? null : num(client.mrr);
    const lastActivity = activityByClient.get(id) || null;

    return {
      id,
      name: text(client.name) || "Unnamed client",
      status: text(client.status) || "active",
      paymentType: text(client.payment_type) || "mrr",
      mrr,
      hourlyRate: client.hourly_rate === null || client.hourly_rate === undefined ? null : num(client.hourly_rate),
      paidThroughDate: text(client.paid_through_date),
      invoiceStatus: text(client.invoice_status),
      hours: hours(num(time?.hours)),
      billableValue: value,
      income: money(incomeByClient.get(id) ?? 0),
      lastActivity,
      retainerCoverage: monthlyWindow && mrr && mrr > 0 && value > 0 ? value / mrr : null
    };
  });
}

function projectRollups(db: DatabaseSync, period: CommandPeriod): ProjectRollup[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, p.status, p.urgent, p.important, c.name AS client_name,
              COALESCE(t.hours, 0) AS hours, COALESCE(t.value, 0) AS value, t.last_activity
       FROM projects p
       LEFT JOIN clients c ON c.id = p.client_id
       LEFT JOIN (
         SELECT project_id,
                SUM(hours) AS hours,
                SUM(CASE WHEN billable = 1 THEN hours * rate ELSE 0 END) AS value,
                MAX(date) AS last_activity
         FROM time_entries WHERE date >= ? AND date <= ? AND project_id IS NOT NULL GROUP BY project_id
       ) t ON t.project_id = p.id
       WHERE p.is_archived = 0 AND p.status = 'active'
       ORDER BY hours DESC, p.name COLLATE NOCASE`
    )
    .all(period.from, period.to) as Row[];

  return rows.map((row) => ({
    id: text(row.id),
    name: text(row.name) || "Unnamed project",
    clientName: text(row.client_name) || null,
    status: text(row.status) || "active",
    urgent: Boolean(num(row.urgent)),
    important: Boolean(num(row.important)),
    hours: hours(num(row.hours)),
    billableValue: money(num(row.value)),
    lastActivity: text(row.last_activity) || null
  }));
}

/**
 * The last rows written to any ledger, newest first.
 *
 * Three tables with different shapes, listed together because the question is
 * one question: what has actually been recorded lately? Ordered by the row's
 * own date and then by when it was written, so a backdated entry appears where
 * it belongs in the record rather than at the top of the feed.
 */
function recentActivity(db: DatabaseSync, limit = 8): ActivityItem[] {
  const rate = getMileageRate(db);

  const rows = db
    .prepare(
      `SELECT kind, id, date, title, subtitle, amount, quantity FROM (
         SELECT 'time' AS kind, t.id AS id, t.date AS date,
                COALESCE(NULLIF(t.details, ''), 'Time entry') AS title,
                COALESCE(p.name, c.name, 'Unassigned') AS subtitle,
                t.hours * t.rate AS amount, t.hours AS quantity, t.created_at AS created_at
         FROM time_entries t
         LEFT JOIN projects p ON p.id = t.project_id
         LEFT JOIN clients c ON c.id = t.client_id
         UNION ALL
         SELECT CASE WHEN e.kind = 'income' THEN 'income' ELSE 'expense' END, e.id, e.date,
                COALESCE(NULLIF(e.vendor, ''), NULLIF(e.details, ''), NULLIF(e.category, ''), 'Record'),
                COALESCE(NULLIF(e.category, ''), 'Uncategorized'),
                e.amount, NULL, e.created_at
         FROM expenses e
         UNION ALL
         SELECT 'mileage', m.id, m.date,
                COALESCE(NULLIF(m.trip_name, ''), NULLIF(m.purpose, ''), 'Trip'),
                COALESCE(c.name, NULLIF(m.end_address, ''), 'Unassigned'),
                m.total_miles * ?, m.total_miles, m.created_at
         FROM mileage_entries m
         LEFT JOIN clients c ON c.id = m.client_id
       )
       ORDER BY date DESC, created_at DESC
       LIMIT ?`
    )
    .all(rate, Math.max(1, Math.min(limit, 25))) as Row[];

  const hrefs: Record<string, string> = {
    time: "/time",
    expense: "/expenses",
    income: "/expenses",
    mileage: "/mileage"
  };

  return rows.map((row) => {
    const kind = text(row.kind) as ActivityItem["kind"];
    return {
      id: `${kind}-${text(row.id)}`,
      kind,
      date: text(row.date),
      title: text(row.title) || "Record",
      subtitle: text(row.subtitle),
      amount: money(num(row.amount)),
      quantity: row.quantity === null || row.quantity === undefined ? null : num(row.quantity),
      href: hrefs[kind] ?? "/"
    };
  });
}

/** "[P1] Renew the domain" — the classic widget's convention for a typed priority. */
const PRIORITY_TAG = /^\[(P[0-3])\]\s*/i;
const TAG_PRIORITY: Record<string, string> = { P0: "urgent", P1: "high", P2: "normal", P3: "low" };

function toTaskBrief(task: ClickUpTaskRecord): TaskBrief {
  // A tag typed into the name wins over ClickUp's own field, as it always did
  // on the classic widget: it is the one somebody set on purpose.
  const tag = PRIORITY_TAG.exec(task.name);
  return {
    id: task.id,
    name: tag ? task.name.slice(tag[0].length) : task.name,
    url: task.url,
    dueDate: task.dueDate,
    priority: tag ? TAG_PRIORITY[tag[1].toUpperCase()] : task.priority,
    clientName: task.clientName,
    projectName: task.projectName,
    listName: task.listName
  };
}

/**
 * Open ClickUp work, read from the local cache and never from ClickUp.
 *
 * The cache is what the Tasks screen refreshes. Reading it here instead of
 * calling ClickUp keeps a slow or failing upstream from delaying the money
 * figures; the price is freshness, so the band carries the sync time and the
 * screen pokes `/api/tasks` on load so a stale cache refreshes in the
 * background. The queries are the Tasks ledger's own, so "overdue" means the
 * same thing on both screens — with one narrowing the classic widget also
 * made: Contact records are people, not work, and are left out.
 *
 * `mostOverdue` is not a query. The page is ordered due-ascending with
 * undated rows last, and every overdue row is due before every row that is
 * not, so the overdue tasks are exactly the first `overdue` entries of `next`.
 */
function taskBand(db: DatabaseSync, now: Date, today: string): TaskBand {
  const base = { page: 1, sort: "due" as const, direction: "asc" as const, excludeTaskTypes: ["contact"] };
  const upcoming = queryClickUpTasks(db, { ...base, pageSize: 6 }, now);
  const dueToday = queryClickUpTasks(db, { ...base, pageSize: 1, dueFrom: today, dueTo: today }, now);
  const sync = getClickUpTaskSyncInfo(db, now);
  const next = upcoming.items.map(toTaskBrief);
  const overdue = upcoming.filteredTotals.overdue;

  return {
    open: upcoming.filteredTotals.tasks,
    overdue,
    dueToday: dueToday.filteredTotals.tasks,
    dueSoon: upcoming.filteredTotals.dueSoon,
    next,
    mostOverdue: next.slice(0, Math.min(3, overdue)),
    lastSyncedAt: sync.lastSyncedAt,
    stale: sync.stale,
    syncError: sync.error ?? null
  };
}

function taxSnapshot(db: DatabaseSync, today: string): TaxSnapshot {
  const year = Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const totals = moneyTotals(db, from, to);

  const uncategorized = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE kind = 'expense' AND date >= ? AND date <= ? AND (account_code IS NULL OR account_code = '')`
    )
    .get(from, to) as Row;

  const receipts = db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM expenses
       WHERE kind = 'expense' AND date >= ? AND date <= ? AND amount >= ?
         AND (receipt_path IS NULL OR receipt_path = '')`
    )
    .get(from, to, RECEIPT_THRESHOLD) as Row;

  const mileageRow = db
    .prepare("SELECT COALESCE(SUM(total_miles), 0) AS miles FROM mileage_entries WHERE date >= ? AND date <= ?")
    .get(from, to) as Row;

  const lineRows = db
    .prepare(
      `SELECT COALESCE(NULLIF(a.schedule_c_line, ''), 'Unassigned line') AS sc_line,
              COALESCE(NULLIF(e.category, ''), 'Uncategorized') AS expense_category,
              COALESCE(SUM(e.amount), 0) AS total
       FROM expenses e
       LEFT JOIN chart_accounts a ON a.account_code = e.account_code
       WHERE e.kind = 'expense' AND e.date >= ? AND e.date <= ?
       GROUP BY sc_line, expense_category
       ORDER BY total DESC
       LIMIT 6`
    )
    .all(from, to) as Row[];

  const rate = getMileageRate(db);
  const miles = Math.round(num(mileageRow.miles) * 10) / 10;

  return {
    year,
    income: totals.income,
    deductible: totals.expenses,
    net: money(totals.income - totals.expenses),
    uncategorizedCount: num(uncategorized.count),
    uncategorizedAmount: money(num(uncategorized.total)),
    missingReceiptCount: num(receipts.count),
    missingReceiptAmount: money(num(receipts.total)),
    mileageMiles: miles,
    mileageRate: rate,
    mileageDeduction: money(miles * rate),
    lines: lineRows.map((row) => ({
      line: text(row.sc_line),
      category: text(row.expense_category),
      amount: money(num(row.total))
    }))
  };
}

function cadenceSnapshot(db: DatabaseSync, today: string): CadenceSnapshot {
  const weekStart = weekStartKey(today);

  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN date = ? THEN hours ELSE 0 END), 0) AS today_hours,
         COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN hours ELSE 0 END), 0) AS week_hours,
         MAX(date) AS last_entry
       FROM time_entries`
    )
    .get(today, weekStart, today) as Row;

  const recentDays = db
    .prepare("SELECT DISTINCT date FROM time_entries WHERE date >= ? AND date <= ? ORDER BY date DESC")
    .all(addDays(today, -30), today) as Row[];

  const logged = new Set(recentDays.map((entry) => text(entry.date)));
  let loggedDaysLast14 = 0;
  for (let index = 0; index < 14; index += 1) {
    if (logged.has(addDays(today, -index))) loggedDaysLast14 += 1;
  }

  // Today being empty at 9am is not a broken streak, so counting starts
  // yesterday when nothing is logged yet — the same rule the daily-win streak
  // uses, for the same reason.
  let cursor = logged.has(today) ? today : addDays(today, -1);
  let streakDays = 0;
  while (logged.has(cursor)) {
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }

  const lastEntryDate = text(row.last_entry) || null;

  return {
    hoursToday: hours(num(row.today_hours)),
    hoursThisWeek: hours(num(row.week_hours)),
    lastEntryDate,
    daysSinceLastEntry: lastEntryDate ? Math.max(daysBetween(lastEntryDate, today) - 1, 0) : null,
    loggedDaysLast14,
    streakDays
  };
}

/** Monday-anchored week start, in local time. */
function weekStartKey(today: string): string {
  const parts = parseDayKey(today);
  if (!parts) return today;
  const anchor = new Date(parts.year, parts.month - 1, parts.date, 12);
  const weekday = anchor.getDay();
  return addDays(today, weekday === 0 ? -6 : 1 - weekday);
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function nameList(names: string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} +${names.length - limit} more`;
}

/**
 * The exception list: what is wrong right now, in the order it costs money.
 *
 * Pure on purpose — this is the part of the screen most likely to be argued
 * with, so every rule is a function of numbers the caller can produce in a
 * test. Rules that find nothing produce nothing: an empty list is the goal
 * state, not a rendering bug.
 */
export function buildAttention(input: {
  today: string;
  period: CommandPeriod;
  work: WorkBand;
  clients: ClientRollup[];
  projects: ProjectRollup[];
  tax: TaxSnapshot;
  cadence: CadenceSnapshot;
  tasks: TaskBand;
  money: Pick<MoneyBand, "committedMrr" | "typedMrr" | "mrrClients" | "mrrGap">;
}): AttentionItem[] {
  const { today, period, work, clients, projects, tax, cadence, tasks, money: cash } = input;
  const items: AttentionItem[] = [];

  const overdue = clients.filter(
    (client) =>
      client.status === "active" &&
      /^\d{4}-\d{2}-\d{2}$/.test(client.paidThroughDate) &&
      client.paidThroughDate < today
  );
  if (overdue.length > 0) {
    items.push({
      id: "paid-through",
      severity: "critical",
      title: `${overdue.length} ${plural(overdue.length, "client is", "clients are")} past paid-through`,
      detail: nameList(overdue.map((client) => `${client.name} (${client.paidThroughDate})`)),
      href: "/clients",
      actionLabel: "Open Clients",
      count: overdue.length
    });
  }

  if (work.unratedBillableHours > 0) {
    items.push({
      id: "unrated-billable",
      severity: "critical",
      title: `${work.unratedBillableHours.toFixed(1)} billable ${plural(work.unratedBillableHours, "hour")} saved at $0`,
      detail:
        "Marked billable with no rate resolved, so the amount is zero. Set the client or project rate, then re-save the entries.",
      href: `/time?billable=true&rateMax=0&from=${period.from}&to=${period.to}`,
      actionLabel: "Review those entries",
      count: work.unratedBillableEntries
    });
  }

  if (cash.mrrGap !== null && cash.typedMrr !== null) {
    items.push({
      id: "mrr-mismatch",
      severity: "serious",
      title: "Client MRR records disagree with the typed figure",
      detail: `${formatMoney(cash.committedMrr)} across ${cash.mrrClients} active client ${plural(
        cash.mrrClients,
        "row"
      )} against ${formatMoney(cash.typedMrr)} typed on the classic dashboard. Until each client's status and MRR is current, the Committed MRR tile is the sum of stale rows.`,
      href: "/clients",
      actionLabel: "Fix client records",
      amount: cash.mrrGap
    });
  }

  const overServed = clients.filter(
    (client) => client.retainerCoverage !== null && client.retainerCoverage > 1.25
  );
  if (overServed.length > 0) {
    const worst = [...overServed].sort((a, b) => (b.retainerCoverage ?? 0) - (a.retainerCoverage ?? 0));
    items.push({
      id: "retainer-overrun",
      severity: "serious",
      title: `${overServed.length} retainer ${plural(overServed.length, "client is", "clients are")} over-serviced`,
      detail: nameList(
        worst.map(
          (client) =>
            `${client.name} ${Math.round((client.retainerCoverage ?? 0) * 100)}% of ${formatMoney(client.mrr ?? 0)}`
        )
      ),
      href: "/clients",
      actionLabel: "Review retainers",
      count: overServed.length
    });
  }

  const staleFocus = projects.filter((project) => project.urgent && project.important && project.hours === 0);
  if (staleFocus.length > 0) {
    items.push({
      id: "focus-untouched",
      severity: "serious",
      title: `${staleFocus.length} urgent + important ${plural(staleFocus.length, "project")} untouched`,
      detail: `No hours logged this period against ${nameList(staleFocus.map((project) => project.name))}.`,
      href: "/projects",
      actionLabel: "Open Projects",
      count: staleFocus.length
    });
  }

  if (tasks.overdue > 0) {
    const named = tasks.mostOverdue.map((task) => {
      const days = task.dueDate === null ? 0 : daysBetween(dayKey(new Date(task.dueDate)), today) - 1;
      return `${task.name} (${days <= 0 ? "earlier today" : `${days} ${plural(days, "day")}`})`;
    });
    // No clock string here: the payload is rendered in the reader's timezone,
    // and the Today panel formats the sync time there. This only says whether.
    const freshness = tasks.stale ? " The task cache is stale." : "";
    items.push({
      id: "overdue-tasks",
      severity: "serious",
      title: `${tasks.overdue} ClickUp ${plural(tasks.overdue, "task")} overdue`,
      detail: `${nameList(named)}.${freshness}`,
      href: "/tasks?overdue=true&sort=due&direction=asc",
      actionLabel: "Open Tasks",
      count: tasks.overdue
    });
  }

  const silent = clients.filter(
    (client) =>
      client.status === "active" &&
      (!client.lastActivity || daysBetween(client.lastActivity, today) - 1 >= SILENT_CLIENT_DAYS)
  );
  if (silent.length > 0) {
    items.push({
      id: "silent-clients",
      severity: "warning",
      title: `${silent.length} active ${plural(silent.length, "client has", "clients have")} gone quiet`,
      detail: `No time, spend, or trips in ${SILENT_CLIENT_DAYS}+ days: ${nameList(silent.map((client) => client.name))}.`,
      href: "/clients",
      actionLabel: "Open Clients",
      count: silent.length
    });
  }

  if (tax.uncategorizedCount > 0) {
    items.push({
      id: "uncategorized-expenses",
      severity: "warning",
      title: `${tax.uncategorizedCount} ${tax.year} ${plural(tax.uncategorizedCount, "expense")} without an account code`,
      detail: `${formatMoney(tax.uncategorizedAmount)} cannot be placed on a Schedule C line until these are categorized.`,
      href: `/expenses?kind=expense&from=${tax.year}-01-01&to=${tax.year}-12-31`,
      actionLabel: "Open Expenses",
      count: tax.uncategorizedCount,
      amount: tax.uncategorizedAmount
    });
  }

  if (tax.missingReceiptCount > 0) {
    items.push({
      id: "missing-receipts",
      severity: "warning",
      title: `${tax.missingReceiptCount} ${plural(tax.missingReceiptCount, "expense")} over $${RECEIPT_THRESHOLD} with no receipt`,
      detail: `${formatMoney(tax.missingReceiptAmount)} of ${tax.year} spend is unsubstantiated.`,
      href: `/expenses?kind=expense&receiptAttached=false&amountMin=${RECEIPT_THRESHOLD}&from=${tax.year}-01-01&to=${tax.year}-12-31`,
      actionLabel: "Attach receipts",
      count: tax.missingReceiptCount,
      amount: tax.missingReceiptAmount
    });
  }

  if (cadence.daysSinceLastEntry !== null && cadence.daysSinceLastEntry >= 2) {
    items.push({
      id: "time-gap",
      severity: "warning",
      title: `No time logged for ${cadence.daysSinceLastEntry} days`,
      detail: `The last entry is dated ${cadence.lastEntryDate}. Reconstructed hours are the ones that get rounded down.`,
      href: "/time",
      actionLabel: "Log time",
      count: cadence.daysSinceLastEntry
    });
  }

  const order: Record<AttentionSeverity, number> = { critical: 0, serious: 1, warning: 2 };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

/** Everything the Command Center screen renders, in one read. */
export function buildCommandCenter(
  db: DatabaseSync,
  options: { period?: CommandPeriodKey; today?: string; now?: Date } = {}
): CommandCenterPayload {
  const now = options.now ?? new Date();
  const today = options.today ?? todayKey(now);
  const period = resolvePeriod(options.period ?? DEFAULT_COMMAND_PERIOD, today);

  const money = moneyBand(db, period);
  const current = workTotals(db, period.from, period.to);
  const previous = workTotals(db, period.previousFrom, period.previousTo);
  const work: WorkBand = {
    ...current,
    previousHours: previous.hours,
    previousBillableValue: previous.billableValue,
    blendedRate: current.hours > 0 ? current.billableValue / current.hours : null
  };

  const clients = clientRollups(db, period);
  const projects = projectRollups(db, period);
  const tax = taxSnapshot(db, today);
  const cadence = cadenceSnapshot(db, today);
  const tasks = taskBand(db, now, today);

  const counts = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM clients WHERE is_archived = 0 AND status = 'active') AS active_clients,
         (SELECT COUNT(*) FROM clients WHERE is_archived = 0 AND status = 'prospect') AS prospects,
         (SELECT COUNT(*) FROM projects WHERE is_archived = 0 AND status = 'active') AS active_projects,
         (SELECT COUNT(*) FROM time_entries) AS time_entries,
         (SELECT COUNT(*) FROM expenses) AS expense_records,
         (SELECT COUNT(*) FROM mileage_entries) AS mileage_entries`
    )
    .get() as Row;

  return {
    // The same instant the task counts were measured against, so the browser
    // draws the overdue line exactly where the server did.
    generatedAt: now.toISOString(),
    today,
    period,
    money,
    work,
    reimbursable: reimbursableBand(db, period.from, period.to),
    trend: monthlyTrend(db, today),
    clients,
    projects,
    activity: recentActivity(db),
    tasks,
    attention: buildAttention({ today, period, work, clients, projects, tax, cadence, tasks, money }),
    tax,
    cadence,
    totals: {
      activeClients: num(counts.active_clients),
      prospects: num(counts.prospects),
      activeProjects: num(counts.active_projects),
      timeEntries: num(counts.time_entries),
      expenseRecords: num(counts.expense_records),
      mileageEntries: num(counts.mileage_entries)
    }
  };
}
