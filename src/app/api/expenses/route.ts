import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createExpense, ExpenseValidationError, getExpenseSummary, getRecentExpenseDefaults, listChartAccounts, listExpenseCategoryAccounts, listExpenses, listRecurringExpenses } from "@/lib/expenses";
import type { ExpenseKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDatabase();
    return NextResponse.json({
      expenses: listExpenses(db, { from: params.get("from") || undefined, to: params.get("to") || undefined,
        kind: (params.get("kind") || undefined) as ExpenseKind | undefined, limit: Number(params.get("limit") || 300) }),
      recurringExpenses: listRecurringExpenses(db), recentDefaults: getRecentExpenseDefaults(db),
      accounts: listChartAccounts(db), categoryAccounts: listExpenseCategoryAccounts(db), summary: getExpenseSummary(db)
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const expense = createExpense(getDatabase(), {
      clientId: input.clientId as string | null | undefined, projectId: input.projectId as string | null | undefined,
      recurringExpenseId: input.recurringExpenseId as string | null | undefined, date: input.date as string,
      amount: input.amount as number, kind: input.kind as never, category: input.category as string,
      company: input.company as string | undefined, vendor: input.vendor as string | undefined,
      details: input.details as string | undefined, accountCode: input.accountCode as string | null | undefined,
      billable: input.billable as boolean | undefined, reimbursable: input.reimbursable as boolean | undefined,
      recurring: input.recurring as never, recurringDay: input.recurringDay as number | null | undefined,
      paymentMethod: input.paymentMethod as string | undefined, status: input.status as string | undefined,
      tags: input.tags as string | undefined
    });
    return NextResponse.json({ expense }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
