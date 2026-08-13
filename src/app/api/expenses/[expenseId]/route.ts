import { unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { NextResponse } from "next/server";
import { getDatabase, getDatabasePath } from "@/lib/dashboard-state";
import { deleteExpense, ExpenseValidationError, getExpense, updateExpense } from "@/lib/expenses";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ expenseId: string }> };

export async function GET(_request: Request, context: Context) {
  const { expenseId } = await context.params;
  const expense = getExpense(getDatabase(), expenseId);
  return expense ? NextResponse.json({ expense }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "No such expense." }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const { expenseId } = await context.params;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
    const input = body as Record<string, unknown>;
    const expense = updateExpense(getDatabase(), expenseId, input as never);
    return NextResponse.json({ expense }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? (error.message === "No such expense." ? 404 : 400) : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { expenseId } = await context.params;
  try {
    const db = getDatabase();
    const receiptPath = getExpense(db, expenseId)?.receiptPath;
    deleteExpense(db, expenseId);
    if (receiptPath) await unlink(join(dirname(getDatabasePath()), "receipts", receiptPath)).catch(() => undefined);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
