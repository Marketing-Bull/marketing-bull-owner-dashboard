import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createClient, createProject } from "@/lib/entities";
import {
  annualizeExpense,
  createExpense,
  createRecurringExpense,
  deleteRecurringExpense,
  deleteExpense,
  getExpense,
  getExpenseSummary,
  getRecentExpenseDefaults,
  listExpenses,
  setExpenseReceipt,
  updateExpense,
  upsertChartAccount,
  upsertExpenseCategoryAccount
} from "@/lib/expenses";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-expense-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS); open.push(db); return db;
}
afterEach(() => { for (const db of open) try { db.close(); } catch {} open = []; });

describe("expenses", () => {
  it("validates relations, accounting codes, and preserves expense versus income", () => {
    const db = freshDb();
    const client = createClient(db, { name: "Acme" });
    const other = createClient(db, { name: "Other" });
    const project = createProject(db, { name: "Site", clientId: client.id });
    upsertChartAccount(db, { accountCode: "6190", category: "Software", scheduleCLine: "Line 27a", description: "Tools", notes: "", isIncome: false, accountType: "expense" });
    upsertExpenseCategoryAccount(db, "Software", "6190");

    const expense = createExpense(db, { projectId: project.id, date: "2026-08-13", amount: 25, category: "Software", accountCode: "6190" });
    const income = createExpense(db, { date: "2026-08-13", amount: 100, category: "Revenue", kind: "income" });
    expect(expense.clientId).toBe(client.id);
    expect(income.kind).toBe("income");
    expect(getExpenseSummary(db)).toEqual({ expenses: 25, income: 100, reimbursable: 0 });
    expect(() => createExpense(db, { clientId: other.id, projectId: project.id, date: "2026-08-13", amount: 1, category: "Other" })).toThrow(/different client/i);
    expect(() => createExpense(db, { date: "2026-08-13", amount: 1, category: "Other", accountCode: "9999" })).toThrow(/does not exist/i);
  });

  it("annualizes recurring frequencies and carries definitions", () => {
    const db = freshDb();
    expect(annualizeExpense(10, "weekly")).toBe(520);
    expect(annualizeExpense(10, "monthly")).toBe(120);
    expect(annualizeExpense(10, "quarterly")).toBe(40);
    expect(annualizeExpense(10, "yearly")).toBe(10);
    expect(annualizeExpense(10, "none")).toBeNull();
    const recurring = createRecurringExpense(db, { description: "Hosting", amount: 20, category: "Software", frequency: "monthly", dayOfMonth: 15, startDate: "2026-01-15" });
    expect(recurring.annualizedAmount).toBe(240);
    const entry = createExpense(db, { recurringExpenseId: recurring.id, date: "2026-08-13", amount: 20, category: "Software", recurring: "monthly", recurringDay: 15 });
    expect(entry.annualizedAmount).toBe(240);
    deleteRecurringExpense(db, recurring.id);
    expect(getExpense(db, entry.id)?.recurringExpenseId).toBeNull();
  });

  it("supports recent defaults, receipts, filters, updates, zero-dollar imports, and deletion", () => {
    const db = freshDb();
    expect(() => createExpense(db, { date: "2026-08-13", amount: 0, category: "Software" })).toThrow(/greater than 0/i);
    const imported = createExpense(db, { date: "2026-08-12", amount: 0, category: "Software", company: "Marketing Bull", paymentMethod: "Card", allowZero: true, mcId: 7 });
    const current = createExpense(db, { date: "2026-08-13", amount: 15, category: "Meals", company: "Marketing Bull", reimbursable: true });
    expect(getRecentExpenseDefaults(db)?.category).toBe("Meals");
    expect(listExpenses(db, { from: "2026-08-13", kind: "expense" })).toHaveLength(1);
    expect(updateExpense(db, current.id, { amount: 16 }).amount).toBe(16);
    expect(setExpenseReceipt(db, current.id, "receipt.pdf", "abc.pdf").receiptName).toBe("receipt.pdf");
    expect(imported.amount).toBe(0);
    deleteExpense(db, current.id);
    expect(getExpense(db, current.id)).toBeNull();
  });
});
