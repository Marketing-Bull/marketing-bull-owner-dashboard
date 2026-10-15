/**
 * Parsing for hand-typed money fields (client MRR, hourly rates).
 *
 * Client-safe: imported by the Clients/Projects forms and by `entities.ts`.
 * `Number("2,500")` is NaN, which `JSON.stringify` sends as `null`, so a
 * formatted value used to erase the stored amount without a word. Here "$"
 * and thousands separators are accepted, and anything else is an error.
 */

export type MoneyInput = { value: number | null; error: string | null };

export function parseMoneyInput(raw: unknown, label = "Amount"): MoneyInput {
  if (raw === null || raw === undefined) return { value: null, error: null };
  if (typeof raw === "number") return checked(raw, label);
  if (typeof raw !== "string") return { value: null, error: `${label} must be a number.` };

  const cleaned = raw.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (cleaned === "") return { value: null, error: null };
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(cleaned)) {
    return { value: null, error: `${label} must be a number, like 2500 or 2,500.00.` };
  }
  return checked(Number(cleaned), label);
}

function checked(value: number, label: string): MoneyInput {
  if (!Number.isFinite(value)) return { value: null, error: `${label} must be a number.` };
  if (value < 0) return { value: null, error: `${label} cannot be negative.` };
  return { value, error: null };
}
