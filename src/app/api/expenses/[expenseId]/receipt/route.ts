import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { NextResponse } from "next/server";
import { getDatabase, getDatabasePath } from "@/lib/dashboard-state";
import { ExpenseValidationError, getExpense, setExpenseReceipt } from "@/lib/expenses";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ expenseId: string }> };
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function receiptFile(path: string): string { return join(dirname(getDatabasePath()), "receipts", path); }

export async function GET(_request: Request, context: Context) {
  const { expenseId } = await context.params;
  const expense = getExpense(getDatabase(), expenseId);
  if (!expense?.receiptPath) return NextResponse.json({ error: "No receipt attached." }, { status: 404 });
  try {
    const bytes = await readFile(receiptFile(expense.receiptPath));
    const extension = extname(expense.receiptPath).toLowerCase();
    const contentType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return new Response(bytes, { headers: { "Content-Type": contentType, "Content-Disposition": `inline; filename="${(expense.receiptName || "receipt").replace(/[\r\n"\\]/g, "")}"`, "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Receipt file is missing." }, { status: 404 });
  }
}

export async function POST(request: Request, context: Context) {
  const { expenseId } = await context.params;
  const db = getDatabase();
  const existing = getExpense(db, expenseId);
  if (!existing) return NextResponse.json({ error: "No such expense." }, { status: 404 });
  try {
    const form = await request.formData();
    const receipt = form.get("receipt");
    if (!(receipt instanceof File)) throw new ExpenseValidationError("Choose a receipt file.");
    if (!ALLOWED_TYPES.has(receipt.type)) throw new ExpenseValidationError("Receipt must be a PDF, JPEG, PNG, or WebP file.");
    if (receipt.size <= 0 || receipt.size > 10 * 1024 * 1024) throw new ExpenseValidationError("Receipt must be between 1 byte and 10 MB.");
    const extension = receipt.type === "application/pdf" ? ".pdf" : receipt.type === "image/png" ? ".png" : receipt.type === "image/webp" ? ".webp" : ".jpg";
    const storedName = `${expenseId}-${crypto.randomUUID()}${extension}`;
    const directory = join(dirname(getDatabasePath()), "receipts");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, storedName), new Uint8Array(await receipt.arrayBuffer()), { flag: "wx" });
    try {
      const expense = setExpenseReceipt(db, expenseId, receipt.name, storedName);
      if (existing.receiptPath) await unlink(receiptFile(existing.receiptPath)).catch(() => undefined);
      return NextResponse.json({ expense }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await unlink(join(directory, storedName)).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    const status = error instanceof ExpenseValidationError ? 400 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}

export async function DELETE(_request: Request, context: Context) {
  const { expenseId } = await context.params;
  const db = getDatabase();
  const expense = getExpense(db, expenseId);
  if (!expense) return NextResponse.json({ error: "No such expense." }, { status: 404 });
  if (expense.receiptPath) await unlink(receiptFile(expense.receiptPath)).catch(() => undefined);
  return NextResponse.json({ expense: setExpenseReceipt(db, expenseId, null, null) }, { headers: { "Cache-Control": "no-store" } });
}
