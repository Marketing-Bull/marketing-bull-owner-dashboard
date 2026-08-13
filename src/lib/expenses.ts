/** Expense, recurring-definition, and accounting-reference rules for Phase 04. */

import type { DatabaseSync } from "node:sqlite";
import { getClient, getProject, newEntityId } from "@/lib/entities";
import { isDateKey } from "@/lib/time-entries";
import {
  EXPENSE_FREQUENCIES,
  EXPENSE_KINDS,
  RECURRING_EXPENSE_STATUSES,
  type ChartAccount,
  type Expense,
  type ExpenseFrequency,
  type ExpenseKind,
  type ExpenseRecentDefaults,
  type RecurringExpense,
  type RecurringExpenseStatus
} from "@/lib/types";

type Row = Record<string, unknown>;

export class ExpenseValidationError extends Error {}

export const SUGGESTED_EXPENSE_CATEGORIES = [
  "Software",
  "Meals",
  "Travel",
  "Advertising",
  "Office",
  "Contract Labor",
  "Other"
] as const;

export type ExpenseInput = {
  clientId?: string | null;
  projectId?: string | null;
  recurringExpenseId?: string | null;
  date: string;
  amount: number;
  kind?: ExpenseKind;
  category: string;
  company?: string;
  vendor?: string;
  details?: string;
  accountCode?: string | null;
  billable?: boolean;
  reimbursable?: boolean;
  recurring?: ExpenseFrequency;
  recurringDay?: number | null;
  paymentMethod?: string;
  status?: string;
  tags?: string;
  mcId?: number;
  createdAt?: string;
  /** The live source contains five zero-dollar generated subscription rows. */
  allowZero?: boolean;
};

export type RecurringExpenseInput = {
  clientId?: string | null;
  projectId?: string | null;
  description: string;
  vendor?: string;
  amount: number;
  category: string;
  company?: string;
  frequency: Exclude<ExpenseFrequency, "none">;
  dayOfMonth?: number | null;
  startDate: string;
  endDate?: string | null;
  status?: RecurringExpenseStatus;
  notes?: string;
  paymentMethod?: string;
  accountCode?: string | null;
  mcId?: number;
  createdAt?: string;
  allowZero?: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableText(value: unknown): string | null {
  const clean = text(value);
  return clean || null;
}

function finiteNumber(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new ExpenseValidationError(`${label} must be a number.`);
  return parsed;
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new ExpenseValidationError(`${label} must be true or false.`);
  return value;
}

function relationId(value: unknown, label: string): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new ExpenseValidationError(`${label} id must be a string or null.`);
  return value.trim() || null;
}

function resolveRelations(db: DatabaseSync, clientValue: unknown, projectValue: unknown) {
  const requestedClientId = relationId(clientValue, "Client");
  const projectId = relationId(projectValue, "Project");
  const project = projectId ? getProject(db, projectId) : null;
  if (projectId && !project) throw new ExpenseValidationError("That project does not exist.");
  const clientId = requestedClientId ?? project?.clientId ?? null;
  const client = clientId ? getClient(db, clientId) : null;
  if (clientId && !client) throw new ExpenseValidationError("That client does not exist.");
  if (project?.clientId && clientId && project.clientId !== clientId) {
    throw new ExpenseValidationError("That project belongs to a different client.");
  }
  return { clientId, projectId };
}

export function isExpenseKind(value: unknown): value is ExpenseKind {
  return typeof value === "string" && (EXPENSE_KINDS as readonly string[]).includes(value);
}

export function isExpenseFrequency(value: unknown): value is ExpenseFrequency {
  return typeof value === "string" && (EXPENSE_FREQUENCIES as readonly string[]).includes(value);
}

export function isRecurringExpenseStatus(value: unknown): value is RecurringExpenseStatus {
  return typeof value === "string" && (RECURRING_EXPENSE_STATUSES as readonly string[]).includes(value);
}

export function annualizeExpense(amount: number, frequency: ExpenseFrequency): number | null {
  const factor = frequency === "weekly" ? 52 : frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : frequency === "yearly" ? 1 : null;
  return factor == null ? null : Number((amount * factor).toFixed(2));
}

function validateAmount(value: unknown, allowZero = false): number {
  const amount = finiteNumber(value, "Amount");
  if (amount < 0 || (!allowZero && amount === 0)) {
    throw new ExpenseValidationError(allowZero ? "Amount cannot be negative." : "Amount must be greater than 0.");
  }
  return amount;
}

function validateDay(value: unknown): number | null {
  if (value == null || value === "") return null;
  const day = finiteNumber(value, "Recurring day");
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new ExpenseValidationError("Recurring day must be a whole number from 1 through 31.");
  }
  return day;
}

function validateDate(value: unknown, label = "Date"): string {
  const date = text(value);
  if (!isDateKey(date)) throw new ExpenseValidationError(`${label} must be a real calendar day in YYYY-MM-DD format.`);
  return date;
}

function validateAccount(db: DatabaseSync, value: unknown): string | null {
  const code = nullableText(value);
  if (!code) return null;
  const exists = db.prepare("SELECT 1 FROM chart_accounts WHERE account_code = ?").get(code);
  if (!exists) throw new ExpenseValidationError(`Account ${code} does not exist.`);
  return code;
}

function rowToChartAccount(row: Row): ChartAccount {
  return {
    accountCode: String(row.account_code),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    category: String(row.category),
    scheduleCLine: text(row.schedule_c_line),
    description: text(row.description),
    notes: typeof row.notes === "string" ? row.notes : "",
    isIncome: Boolean(row.is_income),
    accountType: text(row.account_type)
  };
}

function rowToExpense(row: Row): Expense {
  const recurring = isExpenseFrequency(row.recurring) ? row.recurring : "none";
  return {
    id: String(row.id),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    recurringExpenseId: row.recurring_expense_id == null ? null : String(row.recurring_expense_id),
    date: String(row.date),
    amount: Number(row.amount),
    kind: isExpenseKind(row.kind) ? row.kind : "expense",
    category: String(row.category),
    company: text(row.company),
    vendor: text(row.vendor),
    details: typeof row.details === "string" ? row.details : "",
    accountCode: row.account_code == null ? null : String(row.account_code),
    billable: Boolean(row.billable),
    reimbursable: Boolean(row.reimbursable),
    recurring,
    recurringDay: row.recurring_day == null ? null : Number(row.recurring_day),
    paymentMethod: text(row.payment_method),
    status: text(row.status),
    tags: text(row.tags),
    receiptName: row.receipt_name == null ? null : String(row.receipt_name),
    receiptPath: row.receipt_path == null ? null : String(row.receipt_path),
    annualizedAmount: annualizeExpense(Number(row.amount), recurring),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function rowToRecurringExpense(row: Row): RecurringExpense {
  const frequency = isExpenseFrequency(row.frequency) && row.frequency !== "none" ? row.frequency : "monthly";
  return {
    id: String(row.id),
    mcId: row.mc_id == null ? null : Number(row.mc_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    projectId: row.project_id == null ? null : String(row.project_id),
    description: String(row.description),
    vendor: text(row.vendor),
    amount: Number(row.amount),
    category: String(row.category),
    company: text(row.company),
    frequency,
    dayOfMonth: row.day_of_month == null ? null : Number(row.day_of_month),
    startDate: String(row.start_date),
    endDate: row.end_date == null ? null : String(row.end_date),
    status: isRecurringExpenseStatus(row.status) ? row.status : "active",
    notes: typeof row.notes === "string" ? row.notes : "",
    paymentMethod: text(row.payment_method),
    accountCode: row.account_code == null ? null : String(row.account_code),
    annualizedAmount: annualizeExpense(Number(row.amount), frequency) ?? 0,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function listChartAccounts(db: DatabaseSync): ChartAccount[] {
  return (db.prepare("SELECT * FROM chart_accounts ORDER BY account_code").all() as Row[]).map(rowToChartAccount);
}

export function upsertChartAccount(db: DatabaseSync, input: Omit<ChartAccount, "mcId"> & { mcId?: number; createdAt?: string }): void {
  const now = nowIso();
  db.prepare(`
    INSERT INTO chart_accounts (account_code, mc_id, category, schedule_c_line, description, notes, is_income, account_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_code) DO UPDATE SET mc_id=excluded.mc_id, category=excluded.category,
      schedule_c_line=excluded.schedule_c_line, description=excluded.description, notes=excluded.notes,
      is_income=excluded.is_income, account_type=excluded.account_type, updated_at=excluded.updated_at
  `).run(input.accountCode, input.mcId ?? null, input.category, input.scheduleCLine, input.description,
    input.notes, input.isIncome ? 1 : 0, input.accountType, input.createdAt ?? now, now);
}

export function listExpenseCategoryAccounts(db: DatabaseSync): Record<string, string> {
  const rows = db.prepare("SELECT category, account_code FROM expense_category_accounts ORDER BY category COLLATE NOCASE").all() as Array<{ category: string; account_code: string }>;
  return Object.fromEntries(rows.map((row) => [row.category, row.account_code]));
}

export function upsertExpenseCategoryAccount(db: DatabaseSync, category: string, accountCode: string): void {
  const now = nowIso();
  validateAccount(db, accountCode);
  db.prepare(`INSERT INTO expense_category_accounts (category, account_code, created_at, updated_at)
    VALUES (?, ?, ?, ?) ON CONFLICT(category) DO UPDATE SET account_code=excluded.account_code, updated_at=excluded.updated_at`
  ).run(text(category), accountCode, now, now);
}

export function getExpense(db: DatabaseSync, id: string): Expense | null {
  const row = db.prepare("SELECT * FROM expenses WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToExpense(row) : null;
}

export function getExpenseByMcId(db: DatabaseSync, mcId: number): Expense | null {
  const row = db.prepare("SELECT * FROM expenses WHERE mc_id = ?").get(mcId) as Row | undefined;
  return row ? rowToExpense(row) : null;
}

export function listExpenses(db: DatabaseSync, options: { from?: string; to?: string; kind?: ExpenseKind; limit?: number } = {}): Expense[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (options.from) { clauses.push("date >= ?"); params.push(validateDate(options.from, "From date")); }
  if (options.to) { clauses.push("date <= ?"); params.push(validateDate(options.to, "To date")); }
  if (options.kind) {
    if (!isExpenseKind(options.kind)) throw new ExpenseValidationError("Invalid expense kind.");
    clauses.push("kind = ?"); params.push(options.kind);
  }
  const requested = Number(options.limit ?? 300);
  const limit = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 1000) : 300;
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (db.prepare(`SELECT * FROM expenses ${where} ORDER BY date DESC, created_at DESC LIMIT ?`).all(...params) as Row[]).map(rowToExpense);
}

function validatedExpense(db: DatabaseSync, input: ExpenseInput) {
  const date = validateDate(input.date);
  const amount = validateAmount(input.amount, input.allowZero);
  const category = text(input.category);
  if (!category) throw new ExpenseValidationError("Category is required.");
  const kind = input.kind ?? "expense";
  if (!isExpenseKind(kind)) throw new ExpenseValidationError("Kind must be expense or income.");
  const recurring = input.recurring ?? "none";
  if (!isExpenseFrequency(recurring)) throw new ExpenseValidationError("Unknown recurring frequency.");
  const relations = resolveRelations(db, input.clientId, input.projectId);
  const recurringExpenseId = relationId(input.recurringExpenseId, "Recurring expense");
  if (recurringExpenseId && !getRecurringExpense(db, recurringExpenseId)) {
    throw new ExpenseValidationError("That recurring expense does not exist.");
  }
  if (input.billable !== undefined) bool(input.billable, "Billable");
  if (input.reimbursable !== undefined) bool(input.reimbursable, "Reimbursable");
  return { date, amount, category, kind, recurring, recurringDay: validateDay(input.recurringDay),
    accountCode: validateAccount(db, input.accountCode), recurringExpenseId, ...relations };
}

export function createExpense(db: DatabaseSync, input: ExpenseInput): Expense {
  const value = validatedExpense(db, input);
  const id = newEntityId();
  const now = nowIso();
  db.prepare(`INSERT INTO expenses (
    id, mc_id, client_id, project_id, recurring_expense_id, date, amount, kind, category,
    company, vendor, details, account_code, billable, reimbursable, recurring, recurring_day,
    payment_method, status, tags, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, input.mcId ?? null, value.clientId, value.projectId, value.recurringExpenseId,
    value.date, value.amount, value.kind, value.category, text(input.company), text(input.vendor),
    typeof input.details === "string" ? input.details.trim() : "", value.accountCode,
    input.billable ? 1 : 0, input.reimbursable ? 1 : 0, value.recurring, value.recurringDay,
    text(input.paymentMethod), text(input.status), text(input.tags), input.createdAt ?? now, now);
  return getExpense(db, id)!;
}

export function updateExpense(db: DatabaseSync, id: string, patch: Partial<ExpenseInput>): Expense {
  const existing = getExpense(db, id);
  if (!existing) throw new ExpenseValidationError("No such expense.");
  const input: ExpenseInput = {
    clientId: patch.clientId === undefined ? existing.clientId : patch.clientId,
    projectId: patch.projectId === undefined ? existing.projectId : patch.projectId,
    recurringExpenseId: patch.recurringExpenseId === undefined ? existing.recurringExpenseId : patch.recurringExpenseId,
    date: patch.date ?? existing.date,
    amount: patch.amount ?? existing.amount,
    kind: patch.kind ?? existing.kind,
    category: patch.category ?? existing.category,
    company: patch.company ?? existing.company,
    vendor: patch.vendor ?? existing.vendor,
    details: patch.details ?? existing.details,
    accountCode: patch.accountCode === undefined ? existing.accountCode : patch.accountCode,
    billable: patch.billable ?? existing.billable,
    reimbursable: patch.reimbursable ?? existing.reimbursable,
    recurring: patch.recurring ?? existing.recurring,
    recurringDay: patch.recurringDay === undefined ? existing.recurringDay : patch.recurringDay,
    paymentMethod: patch.paymentMethod ?? existing.paymentMethod,
    status: patch.status ?? existing.status,
    tags: patch.tags ?? existing.tags,
    allowZero: existing.amount === 0 || patch.allowZero
  };
  const value = validatedExpense(db, input);
  db.prepare(`UPDATE expenses SET client_id=?, project_id=?, recurring_expense_id=?, date=?, amount=?,
    kind=?, category=?, company=?, vendor=?, details=?, account_code=?, billable=?, reimbursable=?,
    recurring=?, recurring_day=?, payment_method=?, status=?, tags=?, updated_at=? WHERE id=?`
  ).run(value.clientId, value.projectId, value.recurringExpenseId, value.date, value.amount, value.kind,
    value.category, text(input.company), text(input.vendor), text(input.details), value.accountCode,
    input.billable ? 1 : 0, input.reimbursable ? 1 : 0, value.recurring, value.recurringDay,
    text(input.paymentMethod), text(input.status), text(input.tags), nowIso(), id);
  return getExpense(db, id)!;
}

export function setExpenseReceipt(db: DatabaseSync, id: string, name: string | null, path: string | null): Expense {
  if (!getExpense(db, id)) throw new ExpenseValidationError("No such expense.");
  db.prepare("UPDATE expenses SET receipt_name=?, receipt_path=?, updated_at=? WHERE id=?")
    .run(nullableText(name), nullableText(path), nowIso(), id);
  return getExpense(db, id)!;
}

export function deleteExpense(db: DatabaseSync, id: string): void {
  const result = db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  if (result.changes === 0) throw new ExpenseValidationError("No such expense.");
}

export function getRecentExpenseDefaults(db: DatabaseSync): ExpenseRecentDefaults | null {
  const row = db.prepare(`SELECT category, company, account_code, payment_method FROM expenses
    WHERE kind='expense' ORDER BY created_at DESC, date DESC LIMIT 1`).get() as Row | undefined;
  return row ? { category: String(row.category), company: text(row.company),
    accountCode: row.account_code == null ? null : String(row.account_code), paymentMethod: text(row.payment_method) } : null;
}

export function getExpenseSummary(db: DatabaseSync): { expenses: number; income: number; reimbursable: number } {
  const row = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS expenses,
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN kind='expense' AND reimbursable=1 THEN amount ELSE 0 END),0) AS reimbursable
    FROM expenses`).get() as { expenses: number; income: number; reimbursable: number };
  return { expenses: Number(row.expenses), income: Number(row.income), reimbursable: Number(row.reimbursable) };
}

export function getRecurringExpense(db: DatabaseSync, id: string): RecurringExpense | null {
  const row = db.prepare("SELECT * FROM recurring_expenses WHERE id = ?").get(id) as Row | undefined;
  return row ? rowToRecurringExpense(row) : null;
}

export function getRecurringExpenseByMcId(db: DatabaseSync, mcId: number): RecurringExpense | null {
  const row = db.prepare("SELECT * FROM recurring_expenses WHERE mc_id = ?").get(mcId) as Row | undefined;
  return row ? rowToRecurringExpense(row) : null;
}

export function listRecurringExpenses(db: DatabaseSync): RecurringExpense[] {
  return (db.prepare("SELECT * FROM recurring_expenses ORDER BY status, description COLLATE NOCASE").all() as Row[]).map(rowToRecurringExpense);
}

function validatedRecurring(db: DatabaseSync, input: RecurringExpenseInput) {
  const description = text(input.description);
  if (!description) throw new ExpenseValidationError("A recurring expense needs a description.");
  const category = text(input.category);
  if (!category) throw new ExpenseValidationError("Category is required.");
  const frequency: unknown = input.frequency;
  if (!isExpenseFrequency(frequency) || frequency === "none") {
    throw new ExpenseValidationError("Recurring frequency must be weekly, monthly, quarterly, or yearly.");
  }
  const status = input.status ?? "active";
  if (!isRecurringExpenseStatus(status)) throw new ExpenseValidationError("Unknown recurring status.");
  const startDate = validateDate(input.startDate, "Start date");
  const endDate = nullableText(input.endDate);
  if (endDate && !isDateKey(endDate)) throw new ExpenseValidationError("End date must be a real calendar day.");
  if (endDate && endDate < startDate) throw new ExpenseValidationError("End date cannot be before start date.");
  return { description, category, frequency, status, startDate, endDate, amount: validateAmount(input.amount, input.allowZero),
    dayOfMonth: validateDay(input.dayOfMonth), accountCode: validateAccount(db, input.accountCode),
    ...resolveRelations(db, input.clientId, input.projectId) };
}

export function createRecurringExpense(db: DatabaseSync, input: RecurringExpenseInput): RecurringExpense {
  const value = validatedRecurring(db, input);
  const id = newEntityId();
  const now = nowIso();
  db.prepare(`INSERT INTO recurring_expenses (id,mc_id,client_id,project_id,description,vendor,amount,
    category,company,frequency,day_of_month,start_date,end_date,status,notes,payment_method,account_code,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(id,input.mcId ?? null,value.clientId,value.projectId,value.description,text(input.vendor),value.amount,
    value.category,text(input.company),value.frequency,value.dayOfMonth,value.startDate,value.endDate,value.status,
    text(input.notes),text(input.paymentMethod),value.accountCode,input.createdAt ?? now,now);
  return getRecurringExpense(db, id)!;
}

export function updateRecurringExpense(db: DatabaseSync, id: string, patch: Partial<RecurringExpenseInput>): RecurringExpense {
  const existing = getRecurringExpense(db, id);
  if (!existing) throw new ExpenseValidationError("No such recurring expense.");
  const input: RecurringExpenseInput = {
    clientId: patch.clientId === undefined ? existing.clientId : patch.clientId,
    projectId: patch.projectId === undefined ? existing.projectId : patch.projectId,
    description: patch.description ?? existing.description, vendor: patch.vendor ?? existing.vendor,
    amount: patch.amount ?? existing.amount, category: patch.category ?? existing.category,
    company: patch.company ?? existing.company, frequency: patch.frequency ?? existing.frequency,
    dayOfMonth: patch.dayOfMonth === undefined ? existing.dayOfMonth : patch.dayOfMonth,
    startDate: patch.startDate ?? existing.startDate,
    endDate: patch.endDate === undefined ? existing.endDate : patch.endDate,
    status: patch.status ?? existing.status, notes: patch.notes ?? existing.notes,
    paymentMethod: patch.paymentMethod ?? existing.paymentMethod,
    accountCode: patch.accountCode === undefined ? existing.accountCode : patch.accountCode,
    allowZero: existing.amount === 0 || patch.allowZero
  };
  const value = validatedRecurring(db, input);
  db.prepare(`UPDATE recurring_expenses SET client_id=?,project_id=?,description=?,vendor=?,amount=?,category=?,
    company=?,frequency=?,day_of_month=?,start_date=?,end_date=?,status=?,notes=?,payment_method=?,account_code=?,updated_at=? WHERE id=?`
  ).run(value.clientId,value.projectId,value.description,text(input.vendor),value.amount,value.category,text(input.company),
    value.frequency,value.dayOfMonth,value.startDate,value.endDate,value.status,text(input.notes),text(input.paymentMethod),
    value.accountCode,nowIso(),id);
  return getRecurringExpense(db, id)!;
}

export function deleteRecurringExpense(db: DatabaseSync, id: string): void {
  if (!getRecurringExpense(db, id)) throw new ExpenseValidationError("No such recurring expense.");
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE expenses SET recurring_expense_id = NULL, updated_at = ? WHERE recurring_expense_id = ?")
      .run(nowIso(), id);
    db.prepare("DELETE FROM recurring_expenses WHERE id = ?").run(id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
