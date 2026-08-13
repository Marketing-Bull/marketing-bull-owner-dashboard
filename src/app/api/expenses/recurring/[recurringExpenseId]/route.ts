import { NextResponse } from "next/server";
import { getDatabase } from "@/lib/dashboard-state";
import { deleteRecurringExpense, ExpenseValidationError, getRecurringExpense, updateRecurringExpense } from "@/lib/expenses";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ recurringExpenseId: string }> };

export async function GET(_request: Request, context: Context) {
  const { recurringExpenseId } = await context.params;
  const recurringExpense = getRecurringExpense(getDatabase(), recurringExpenseId);
  return recurringExpense ? NextResponse.json({ recurringExpense }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "No such recurring expense." }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const { recurringExpenseId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    return NextResponse.json({ recurringExpense: updateRecurringExpense(getDatabase(), recurringExpenseId, body as never) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? (error.message === "No such recurring expense." ? 404 : 400) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { recurringExpenseId } = await context.params;
  try {
    deleteRecurringExpense(getDatabase(), recurringExpenseId);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
