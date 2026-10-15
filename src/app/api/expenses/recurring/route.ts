import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { createRecurringExpense, ExpenseValidationError, listRecurringExpenses, type RecurringExpenseInput } from "@/lib/expenses";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ recurringExpenses: listRecurringExpenses(getDatabase()) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const recurringInput = {
      clientId: input.clientId,
      projectId: input.projectId,
      description: input.description,
      vendor: input.vendor,
      amount: input.amount,
      category: input.category,
      company: input.company,
      frequency: input.frequency,
      dayOfMonth: input.dayOfMonth,
      startDate: input.startDate,
      endDate: input.endDate,
      status: input.status,
      notes: input.notes,
      paymentMethod: input.paymentMethod,
      accountCode: input.accountCode
    } as RecurringExpenseInput;
    const recurringExpense = createRecurringExpense(getDatabase(), recurringInput);
    return NextResponse.json({ recurringExpense }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
