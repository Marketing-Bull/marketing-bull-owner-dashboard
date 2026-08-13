import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createRecurringExpense, ExpenseValidationError, listRecurringExpenses } from "@/lib/expenses";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ recurringExpenses: listRecurringExpenses(getDatabase()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const recurringExpense = createRecurringExpense(getDatabase(), body as never);
    return NextResponse.json({ recurringExpense }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
