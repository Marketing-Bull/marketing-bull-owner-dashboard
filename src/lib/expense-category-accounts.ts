/**
 * Client-safe helpers for the Expenses form's Category → Account code mapping.
 *
 * `GET /api/expenses` returns `categoryAccounts` (category → account code, from
 * `expense_category_accounts`). The form uses it to prefill the account code
 * when a category is picked; the user can still override the code by hand.
 */
export type CategoryAccountMap = Record<string, string>;

/** Mapped account code for a category (case-insensitive), or "" when unmapped. */
export function accountCodeForCategory(map: CategoryAccountMap | null | undefined, category: string | null | undefined): string {
  if (!map || !category) return "";
  const wanted = category.trim().toLowerCase();
  if (!wanted) return "";
  if (map[category]) return map[category];
  for (const [key, code] of Object.entries(map)) {
    if (key.trim().toLowerCase() === wanted) return code;
  }
  return "";
}

/**
 * Account code after the category changes.
 *
 * - New category is mapped → use its account code.
 * - New category is unmapped and the current code was the old category's
 *   mapped code → clear it (it described the old category, not this one).
 * - Otherwise keep the current code (a manual override survives).
 */
export function accountCodeAfterCategoryChange(
  map: CategoryAccountMap | null | undefined,
  previousCategory: string,
  nextCategory: string,
  currentAccountCode: string
): string {
  const next = accountCodeForCategory(map, nextCategory);
  if (next) return next;
  const previous = accountCodeForCategory(map, previousCategory);
  if (previous && currentAccountCode === previous) return "";
  return currentAccountCode;
}

/**
 * Account code for a blank create form: the category's mapping wins; the
 * recent account code is used only when it was recorded with this same
 * category (so it cannot leak onto an unrelated default category).
 */
export function initialAccountCode(
  map: CategoryAccountMap | null | undefined,
  category: string,
  recent: { category?: string | null; accountCode?: string | null } | null | undefined
): string {
  const mapped = accountCodeForCategory(map, category);
  if (mapped) return mapped;
  if (recent?.accountCode && recent.category && category && recent.category.toLowerCase() === category.toLowerCase()) return recent.accountCode;
  return "";
}
