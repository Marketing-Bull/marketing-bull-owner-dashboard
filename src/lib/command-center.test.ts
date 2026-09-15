/**
 * The Command Center's arithmetic, against real SQLite.
 *
 * This screen exists to be trusted without cross-checking, so the cases that
 * matter are the ones that would be wrong *plausibly*: a comparison window that
 * flatters the current one, a retainer ratio computed over a quarter, a rate
 * snapshot re-derived instead of read, an exception rule that fires on a healthy
 * database. Every rule below is one somebody would act on.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAttention,
  buildCommandCenter,
  daysBetween,
  monthlyRecurringCost,
  resolvePeriod,
  type ClientRollup,
  type ProjectRollup
} from "@/lib/command-center";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-cmd-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open) {
    try {
      db.close();
    } catch {
      // Already closed by the test.
    }
  }
  open = [];
});

const NOW = "2026-03-01T00:00:00.000Z";

function addClient(
  db: DatabaseSync,
  id: string,
  patch: Partial<{
    name: string;
    status: string;
    paymentType: string;
    mrr: number | null;
    hourlyRate: number | null;
    paidThroughDate: string;
  }> = {}
): void {
  db.prepare(
    `INSERT INTO clients (id, name, status, payment_type, mrr, hourly_rate, paid_through_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    patch.name ?? id,
    patch.status ?? "active",
    patch.paymentType ?? "mrr",
    patch.mrr ?? null,
    patch.hourlyRate ?? null,
    patch.paidThroughDate ?? "",
    NOW,
    NOW
  );
}

function addProject(
  db: DatabaseSync,
  id: string,
  patch: Partial<{ clientId: string; name: string; status: string; urgent: number; important: number }> = {}
): void {
  db.prepare(
    `INSERT INTO projects (id, client_id, name, status, urgent, important, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    patch.clientId ?? null,
    patch.name ?? id,
    patch.status ?? "active",
    patch.urgent ?? 0,
    patch.important ?? 0,
    NOW,
    NOW
  );
}

function addTime(
  db: DatabaseSync,
  patch: { date: string; hours: number; rate?: number; billable?: number; clientId?: string; projectId?: string }
): void {
  db.prepare(
    `INSERT INTO time_entries (id, client_id, project_id, date, hours, rate, billable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `t-${Math.random().toString(36).slice(2)}`,
    patch.clientId ?? null,
    patch.projectId ?? null,
    patch.date,
    patch.hours,
    patch.rate ?? 0,
    patch.billable ?? 1,
    NOW,
    NOW
  );
}

function addExpense(
  db: DatabaseSync,
  patch: {
    date: string;
    amount: number;
    kind?: string;
    category?: string;
    clientId?: string;
    accountCode?: string | null;
    receiptPath?: string | null;
    reimbursable?: number;
  }
): void {
  db.prepare(
    `INSERT INTO expenses (id, client_id, date, amount, kind, category, account_code, receipt_path, reimbursable, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `e-${Math.random().toString(36).slice(2)}`,
    patch.clientId ?? null,
    patch.date,
    patch.amount,
    patch.kind ?? "expense",
    patch.category ?? "Software",
    patch.accountCode ?? null,
    patch.receiptPath ?? null,
    patch.reimbursable ?? 0,
    NOW,
    NOW
  );
}

/** Expenses reference the chart of accounts, so a code has to exist first. */
function addAccount(db: DatabaseSync, accountCode: string, scheduleCLine = "Line 18 Office expense"): void {
  db.prepare(
    `INSERT INTO chart_accounts (account_code, category, schedule_c_line, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(accountCode, "Software", scheduleCLine, NOW, NOW);
}

function addTrip(db: DatabaseSync, patch: { date: string; miles: number; billable?: number; clientId?: string }): void {
  db.prepare(
    `INSERT INTO mileage_entries (id, client_id, date, miles, round_trip, total_miles, billable, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`
  ).run(
    `m-${Math.random().toString(36).slice(2)}`,
    patch.clientId ?? null,
    patch.date,
    patch.miles,
    patch.miles,
    patch.billable ?? 0,
    NOW,
    NOW
  );
}

describe("resolvePeriod", () => {
  it("compares month-to-date against the same elapsed days of last month", () => {
    const period = resolvePeriod("mtd", "2026-08-13");
    expect(period.from).toBe("2026-08-01");
    expect(period.to).toBe("2026-08-13");
    // Not the whole of July: a 13-day window measured against a 31-day one
    // would report a collapse in revenue every single month.
    expect(period.previousFrom).toBe("2026-07-01");
    expect(period.previousTo).toBe("2026-07-13");
    expect(daysBetween(period.from, period.to)).toBe(daysBetween(period.previousFrom, period.previousTo));
  });

  it("clamps the comparison window to the shorter month instead of spilling into the next", () => {
    const period = resolvePeriod("mtd", "2026-03-31");
    expect(period.previousFrom).toBe("2026-02-01");
    expect(period.previousTo).toBe("2026-02-28");
  });

  it("keeps last month whole and compares it with the whole month before", () => {
    const period = resolvePeriod("last-month", "2026-03-05");
    expect(period.from).toBe("2026-02-01");
    expect(period.to).toBe("2026-02-28");
    expect(period.previousFrom).toBe("2026-01-01");
    expect(period.previousTo).toBe("2026-01-31");
  });

  it("anchors quarter to date on the quarter, not on a rolling 90 days", () => {
    const period = resolvePeriod("qtd", "2026-08-13");
    expect(period.from).toBe("2026-07-01");
    expect(period.previousFrom).toBe("2026-04-01");
    // 44 days into Q3 compares with 44 days into Q2 — the same distance in,
    // not the same date, which would silently shorten the window.
    expect(period.previousTo).toBe("2026-05-14");
    expect(daysBetween(period.previousFrom, period.previousTo)).toBe(daysBetween(period.from, period.to));
  });

  it("compares year to date against the same days of last year", () => {
    const period = resolvePeriod("ytd", "2026-02-10");
    expect(period.from).toBe("2026-01-01");
    expect(period.previousFrom).toBe("2025-01-01");
    expect(period.previousTo).toBe("2025-02-10");
  });

  it("does not lose a day across a spring-forward boundary", () => {
    // America/New_York springs forward on 2026-03-08; a midnight-anchored
    // shift lands on the 7th and every window after it is off by one.
    expect(daysBetween("2026-03-01", "2026-03-31")).toBe(31);
    const period = resolvePeriod("mtd", "2026-03-09");
    expect(period.previousTo).toBe("2026-02-09");
  });
});

describe("monthlyRecurringCost", () => {
  it("annualizes weekly costs rather than calling a month four weeks", () => {
    // 52/12 = 4.33 weeks a month. Rounding to 4 hides ~$433/yr on a $100/wk line.
    expect(monthlyRecurringCost([{ amount: 100, frequency: "weekly" }])).toBeCloseTo(433.33, 2);
    expect(monthlyRecurringCost([{ amount: 90, frequency: "quarterly" }])).toBe(30);
    expect(monthlyRecurringCost([{ amount: 1200, frequency: "yearly" }])).toBe(100);
    expect(monthlyRecurringCost([{ amount: 50, frequency: "monthly" }])).toBe(50);
  });

  it("ignores rows it cannot price", () => {
    expect(monthlyRecurringCost([{ amount: 0, frequency: "monthly" }, { amount: 10, frequency: "once" }])).toBe(0);
  });
});

describe("buildCommandCenter", () => {
  it("computes money, work, and reimbursables from the ledgers", () => {
    const db = freshDb();
    addClient(db, "c1", { name: "Acme", mrr: 2000 });
    addExpense(db, { date: "2026-08-03", amount: 5000, kind: "income", clientId: "c1" });
    addExpense(db, { date: "2026-08-04", amount: 1200, kind: "expense" });
    addExpense(db, { date: "2026-08-05", amount: 300, kind: "expense", reimbursable: 1 });
    // Last month, same elapsed days — the comparison window.
    addExpense(db, { date: "2026-07-02", amount: 4000, kind: "income" });
    // Outside both windows; must not leak into either.
    addExpense(db, { date: "2026-07-28", amount: 9999, kind: "income" });

    addTime(db, { date: "2026-08-02", hours: 4, rate: 150, clientId: "c1" });
    addTime(db, { date: "2026-08-02", hours: 2, rate: 150, billable: 0, clientId: "c1" });
    addTrip(db, { date: "2026-08-06", miles: 100, billable: 1 });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });

    expect(payload.money.income).toBe(5000);
    expect(payload.money.expenses).toBe(1500);
    expect(payload.money.net).toBe(3500);
    expect(payload.money.margin).toBeCloseTo(0.7, 5);
    expect(payload.money.previousIncome).toBe(4000);
    expect(payload.money.committedMrr).toBe(2000);

    expect(payload.work.hours).toBe(6);
    expect(payload.work.billableHours).toBe(4);
    expect(payload.work.billableValue).toBe(600);
    // Blended over every hour worked, not just the billable ones: 600/6.
    expect(payload.work.blendedRate).toBe(100);
    expect(payload.work.daysWorked).toBe(1);

    expect(payload.reimbursable.expenses).toBe(300);
    expect(payload.reimbursable.mileageMiles).toBe(100);
    expect(payload.reimbursable.mileageAmount).toBe(67);
    expect(payload.reimbursable.total).toBe(367);
  });

  it("uses the rate frozen on the row, not the client's current rate", () => {
    const db = freshDb();
    addClient(db, "c1", { hourlyRate: 200, paymentType: "hourly" });
    addTime(db, { date: "2026-08-04", hours: 2, rate: 125, clientId: "c1" });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.work.billableValue).toBe(250);
    expect(payload.clients[0].billableValue).toBe(250);
  });

  it("returns twelve trend months ending in the current one, including empty ones", () => {
    const db = freshDb();
    addExpense(db, { date: "2026-08-01", amount: 100, kind: "income" });
    addExpense(db, { date: "2025-09-15", amount: 40, kind: "expense" });
    addTime(db, { date: "2026-08-01", hours: 3, rate: 100 });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.trend).toHaveLength(12);
    expect(payload.trend[0].month).toBe("2025-09");
    expect(payload.trend[11].month).toBe("2026-08");
    expect(payload.trend[0].expenses).toBe(40);
    expect(payload.trend[11]).toMatchObject({ income: 100, net: 100, hours: 3 });
  });

  it("scores retainer coverage on a monthly window only", () => {
    const db = freshDb();
    addClient(db, "c1", { name: "Acme", mrr: 1000 });
    addTime(db, { date: "2026-08-04", hours: 10, rate: 150, clientId: "c1" });

    const monthly = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(monthly.clients[0].retainerCoverage).toBeCloseTo(1.5, 5);

    // A quarter of delivery against one month of MRR would read as a 4x
    // overrun on every healthy account.
    const quarterly = buildCommandCenter(db, { period: "qtd", today: "2026-08-13" });
    expect(quarterly.clients[0].retainerCoverage).toBeNull();
  });

  it("rolls hours up to active projects and leaves archived work out", () => {
    const db = freshDb();
    addClient(db, "c1", { name: "Acme" });
    addProject(db, "p1", { clientId: "c1", name: "Website" });
    addProject(db, "p2", { clientId: "c1", name: "Finished", status: "completed" });
    addTime(db, { date: "2026-08-04", hours: 3, rate: 100, clientId: "c1", projectId: "p1" });
    addTime(db, { date: "2026-08-05", hours: 1.5, rate: 100, clientId: "c1", projectId: "p1" });
    addTime(db, { date: "2026-08-06", hours: 9, rate: 100, clientId: "c1", projectId: "p2" });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.projects).toHaveLength(1);
    expect(payload.projects[0]).toMatchObject({
      name: "Website",
      clientName: "Acme",
      hours: 4.5,
      billableValue: 450,
      lastActivity: "2026-08-05"
    });
    // The completed project's hours still count toward the totals — they were
    // worked. Only the per-project breakdown is scoped to active work.
    expect(payload.work.hours).toBe(13.5);
  });

  it("reads last activity across every ledger, not just time", () => {
    const db = freshDb();
    addClient(db, "quiet");
    addClient(db, "spending");
    addExpense(db, { date: "2026-08-10", amount: 20, clientId: "spending" });
    addTime(db, { date: "2026-01-02", hours: 1, clientId: "quiet" });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    const byId = new Map(payload.clients.map((client) => [client.id, client]));
    expect(byId.get("spending")?.lastActivity).toBe("2026-08-10");
    expect(byId.get("quiet")?.lastActivity).toBe("2026-01-02");
  });

  it("counts the logging streak from yesterday when today is still empty", () => {
    const db = freshDb();
    addTime(db, { date: "2026-08-12", hours: 2 });
    addTime(db, { date: "2026-08-11", hours: 2 });
    addTime(db, { date: "2026-08-10", hours: 2 });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.cadence.streakDays).toBe(3);
    expect(payload.cadence.hoursToday).toBe(0);
    expect(payload.cadence.loggedDaysLast14).toBe(3);
    expect(payload.cadence.daysSinceLastEntry).toBe(1);
  });

  it("keeps the tax snapshot on the calendar year regardless of the selected period", () => {
    const db = freshDb();
    addAccount(db, "6000");
    addExpense(db, { date: "2026-02-01", amount: 500, accountCode: null });
    addExpense(db, { date: "2026-08-01", amount: 100, accountCode: "6000", receiptPath: "receipts/a.pdf" });
    addExpense(db, { date: "2025-12-31", amount: 900, accountCode: null });
    addTrip(db, { date: "2026-04-01", miles: 200 });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.tax.year).toBe(2026);
    expect(payload.tax.deductible).toBe(600);
    expect(payload.tax.uncategorizedCount).toBe(1);
    expect(payload.tax.uncategorizedAmount).toBe(500);
    // $100 is under the substantiation threshold, so it is not chased.
    expect(payload.tax.missingReceiptCount).toBe(1);
    expect(payload.tax.mileageDeduction).toBe(134);
  });

  it("lists the newest rows from all three ledgers together", () => {
    const db = freshDb();
    addClient(db, "c1", { name: "Acme" });
    addTime(db, { date: "2026-08-12", hours: 2, rate: 150, clientId: "c1" });
    addExpense(db, { date: "2026-08-13", amount: 240, kind: "income", clientId: "c1" });
    addTrip(db, { date: "2026-08-11", miles: 20, clientId: "c1" });
    addExpense(db, { date: "2026-06-01", amount: 12 });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.activity.map((item) => [item.kind, item.date])).toEqual([
      ["income", "2026-08-13"],
      ["time", "2026-08-12"],
      ["mileage", "2026-08-11"],
      ["expense", "2026-06-01"]
    ]);
    // Money on a time row is the frozen rate; on a trip it is the reimbursement.
    expect(payload.activity[1].amount).toBe(300);
    expect(payload.activity[2].amount).toBe(13.4);
  });

  it("says nothing at all about a clean database", () => {
    const db = freshDb();
    addAccount(db, "6000");
    addClient(db, "c1", { name: "Acme", mrr: 1000, paidThroughDate: "2026-12-31" });
    addTime(db, { date: "2026-08-13", hours: 6, rate: 150, clientId: "c1" });
    addExpense(db, { date: "2026-08-01", amount: 50, accountCode: "6000", receiptPath: "r.pdf" });

    const payload = buildCommandCenter(db, { period: "mtd", today: "2026-08-13" });
    expect(payload.attention).toEqual([]);
  });
});

describe("buildAttention", () => {
  const period = resolvePeriod("mtd", "2026-08-13");

  const baseWork = {
    hours: 10,
    billableHours: 10,
    billableValue: 1500,
    entries: 4,
    daysWorked: 3,
    blendedRate: 150,
    previousHours: 8,
    previousBillableValue: 1200,
    unratedBillableHours: 0,
    unratedBillableEntries: 0
  };

  const baseTax = {
    year: 2026,
    income: 1000,
    deductible: 100,
    net: 900,
    uncategorizedCount: 0,
    uncategorizedAmount: 0,
    missingReceiptCount: 0,
    missingReceiptAmount: 0,
    mileageMiles: 0,
    mileageRate: 0.67,
    mileageDeduction: 0,
    lines: []
  };

  const baseCadence = {
    hoursToday: 4,
    hoursThisWeek: 12,
    lastEntryDate: "2026-08-13",
    daysSinceLastEntry: 0,
    loggedDaysLast14: 9,
    streakDays: 4
  };

  function client(patch: Partial<ClientRollup> = {}): ClientRollup {
    return {
      id: "c1",
      name: "Acme",
      status: "active",
      paymentType: "mrr",
      mrr: 1000,
      hourlyRate: null,
      paidThroughDate: "2026-12-31",
      invoiceStatus: "",
      hours: 5,
      billableValue: 750,
      income: 1000,
      lastActivity: "2026-08-12",
      retainerCoverage: 0.75,
      ...patch
    };
  }

  function project(patch: Partial<ProjectRollup> = {}): ProjectRollup {
    return {
      id: "p1",
      name: "Website",
      clientName: "Acme",
      status: "active",
      urgent: false,
      important: false,
      hours: 5,
      billableValue: 750,
      lastActivity: "2026-08-12",
      ...patch
    };
  }

  function run(patch: {
    work?: typeof baseWork;
    clients?: ClientRollup[];
    projects?: ProjectRollup[];
    tax?: typeof baseTax;
    cadence?: typeof baseCadence;
  }) {
    return buildAttention({
      today: "2026-08-13",
      period,
      work: patch.work ?? baseWork,
      clients: patch.clients ?? [client()],
      projects: patch.projects ?? [project()],
      tax: patch.tax ?? baseTax,
      cadence: patch.cadence ?? baseCadence
    });
  }

  it("stays silent when everything is healthy", () => {
    expect(run({})).toEqual([]);
  });

  it("raises billable hours saved at a zero rate as critical", () => {
    const items = run({ work: { ...baseWork, unratedBillableHours: 6.5, unratedBillableEntries: 3 } });
    const item = items.find((entry) => entry.id === "unrated-billable");
    expect(item?.severity).toBe("critical");
    // The link has to land on exactly the rows in question, or it is decoration.
    expect(item?.href).toBe("/time?billable=true&rateMax=0&from=2026-08-01&to=2026-08-13");
  });

  it("flags a client past its paid-through date and ignores blank ones", () => {
    const items = run({
      clients: [
        client({ id: "late", name: "Late Co", paidThroughDate: "2026-06-30" }),
        client({ id: "blank", name: "Blank Co", paidThroughDate: "" }),
        client({ id: "prospect", name: "Prospect Co", status: "prospect", paidThroughDate: "2020-01-01" })
      ]
    });
    const item = items.find((entry) => entry.id === "paid-through");
    expect(item?.count).toBe(1);
    expect(item?.detail).toContain("Late Co");
  });

  it("only calls a retainer over-serviced past the tolerance band", () => {
    expect(run({ clients: [client({ retainerCoverage: 1.2 })] })).toEqual([]);
    const items = run({ clients: [client({ retainerCoverage: 1.8 })] });
    expect(items.find((entry) => entry.id === "retainer-overrun")?.severity).toBe("serious");
  });

  it("treats a never-touched client as silent", () => {
    const items = run({ clients: [client({ lastActivity: null })] });
    expect(items.find((entry) => entry.id === "silent-clients")?.count).toBe(1);
  });

  it("does not call a client silent on the boundary day", () => {
    // 30 days of silence is the threshold; 29 is not yet a problem.
    expect(run({ clients: [client({ lastActivity: "2026-07-15" })] })).toEqual([]);
    const items = run({ clients: [client({ lastActivity: "2026-07-14" })] });
    expect(items.find((entry) => entry.id === "silent-clients")).toBeTruthy();
  });

  it("orders critical findings above serious and warning ones", () => {
    const items = run({
      work: { ...baseWork, unratedBillableHours: 2, unratedBillableEntries: 1 },
      clients: [client({ paidThroughDate: "2026-01-01", retainerCoverage: 2 })],
      tax: { ...baseTax, uncategorizedCount: 12, uncategorizedAmount: 4200 }
    });
    expect(items.map((entry) => entry.severity)).toEqual([...items.map((entry) => entry.severity)].sort());
    expect(items[0].severity).toBe("critical");
  });

  it("only chases untouched projects that are both urgent and important", () => {
    expect(run({ projects: [project({ urgent: true, hours: 0 })] })).toEqual([]);
    const items = run({ projects: [project({ urgent: true, important: true, hours: 0 })] });
    expect(items.find((entry) => entry.id === "focus-untouched")?.count).toBe(1);
  });
});
