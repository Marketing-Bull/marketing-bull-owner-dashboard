import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createExpense, createRecurringExpense } from "@/lib/expenses";
import {
  countDropdownOptionUsage,
  createDropdownOption,
  deleteDropdownOption,
  getDefaultDropdownLabel,
  isDropdownListKey,
  listDropdownOptions,
  moveDropdownOption,
  pickerLabels,
  updateDropdownOption
} from "@/lib/dropdown-options";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-dropdowns-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}
afterEach(() => { for (const db of open) try { db.close(); } catch {} open = []; });

function labels(db: DatabaseSync): string[] {
  return listDropdownOptions(db, "expense.category", { includeInactive: true }).map((option) => option.label);
}

function mapCategory(db: DatabaseSync, category: string, accountCode: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO chart_accounts (account_code, category, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(accountCode, category, now, now);
  db.prepare(
    `INSERT OR REPLACE INTO expense_category_accounts (category, account_code, created_at, updated_at)
     VALUES (?, ?, ?, ?)`
  ).run(category, accountCode, now, now);
}

describe("dropdown options", () => {
  it("seeds a fresh database with usable expense categories", () => {
    const db = freshDb();
    expect(labels(db)).toContain("Software");
    expect(isDropdownListKey("expense.category")).toBe(true);
    expect(isDropdownListKey("expense.vendor")).toBe(false);
  });

  it("adds, rejects duplicates, and reorders", () => {
    const db = freshDb();
    const option = createDropdownOption(db, "expense.category", "  Legal   fees ");
    expect(option.label).toBe("Legal fees");
    expect(() => createDropdownOption(db, "expense.category", "legal FEES")).toThrow(/already exists/i);
    expect(() => createDropdownOption(db, "expense.vendor", "Nope")).toThrow(/unknown option list/i);

    const before = labels(db);
    moveDropdownOption(db, option.id, "up");
    const after = labels(db);
    expect(after.indexOf("Legal fees")).toBe(before.indexOf("Legal fees") - 1);
  });

  it("keeps one default and never defaults a deactivated option", () => {
    const db = freshDb();
    const [first, second] = listDropdownOptions(db, "expense.category");
    updateDropdownOption(db, first.id, { isDefault: true });
    updateDropdownOption(db, second.id, { isDefault: true });
    expect(getDefaultDropdownLabel(db, "expense.category")).toBe(second.label);
    updateDropdownOption(db, second.id, { isActive: false });
    expect(getDefaultDropdownLabel(db, "expense.category")).toBeNull();
  });

  it("renames the records that use an option so history stays readable", () => {
    const db = freshDb();
    mapCategory(db, "Software", "6100");
    createExpense(db, { date: "2026-08-13", amount: 20, category: "Software" });
    createRecurringExpense(db, { description: "Hosting", amount: 10, category: "Software", frequency: "monthly", startDate: "2026-08-01" });
    const software = listDropdownOptions(db, "expense.category").find((option) => option.label === "Software")!;
    expect(software.usageCount).toBe(2);

    const renamed = updateDropdownOption(db, software.id, { label: "SaaS" });
    expect(renamed.relabeledRecords).toBe(2);
    expect(countDropdownOptionUsage(db, "expense.category", "SaaS")).toBe(2);
    expect(countDropdownOptionUsage(db, "expense.category", "Software")).toBe(0);
    expect(db.prepare("SELECT account_code FROM expense_category_accounts WHERE category = ?").get("SaaS"))
      .toMatchObject({ account_code: "6100" });
  });

  it("keeps the target account mapping when categories merge", () => {
    const db = freshDb();
    mapCategory(db, "Software", "6100");
    mapCategory(db, "Tools", "6200");
    createDropdownOption(db, "expense.category", "Tools");
    const software = listDropdownOptions(db, "expense.category").find((option) => option.label === "Software")!;

    deleteDropdownOption(db, software.id, "Tools");

    expect(db.prepare("SELECT account_code FROM expense_category_accounts WHERE category = ?").get("Tools"))
      .toMatchObject({ account_code: "6200" });
    expect(db.prepare("SELECT category FROM expense_category_accounts WHERE category = ?").get("Software")).toBeUndefined();
  });

  it("keeps deactivated labels on existing records and offers them while editing", () => {
    const db = freshDb();
    createExpense(db, { date: "2026-08-13", amount: 20, category: "Travel" });
    const travel = listDropdownOptions(db, "expense.category").find((option) => option.label === "Travel")!;
    updateDropdownOption(db, travel.id, { isActive: false });

    expect(pickerLabels(db, "expense.category")).not.toContain("Travel");
    expect(pickerLabels(db, "expense.category", "Travel")).toContain("Travel");
    expect(countDropdownOptionUsage(db, "expense.category", "Travel")).toBe(1);
  });

  it("refuses to delete an option in use without a replacement", () => {
    const db = freshDb();
    createExpense(db, { date: "2026-08-13", amount: 20, category: "Meals" });
    const meals = listDropdownOptions(db, "expense.category").find((option) => option.label === "Meals")!;
    expect(() => deleteDropdownOption(db, meals.id)).toThrow(/replacement/i);
    expect(() => deleteDropdownOption(db, meals.id, "Nonexistent")).toThrow(/does not exist/i);

    const result = deleteDropdownOption(db, meals.id, "Other");
    expect(result.reassignedRecords).toBe(1);
    expect(labels(db)).not.toContain("Meals");
    expect(countDropdownOptionUsage(db, "expense.category", "Other")).toBe(1);
  });
});
