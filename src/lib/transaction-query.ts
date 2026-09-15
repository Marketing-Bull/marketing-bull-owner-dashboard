import type { DatabaseSync } from "node:sqlite";

export type QueryScalar = string | number;

export type SortDirection = "asc" | "desc";

export type PageInfo = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type FacetCount = {
  value: string;
  count: number;
};

export type TransactionQueryResult<TItem, TTotals, TFacets> = {
  items: TItem[];
  pageInfo: PageInfo;
  filteredTotals: TTotals;
  availableFacets: TFacets;
};

export class TransactionQueryValidationError extends Error {}

function clean(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function textParam(
  params: URLSearchParams,
  key: string,
  options: { maxLength?: number } = {}
): string | undefined {
  const value = clean(params.get(key));
  if (!value) return undefined;
  const maxLength = options.maxLength ?? 300;
  if (value.length > maxLength) {
    throw new TransactionQueryValidationError(`${key} cannot exceed ${maxLength} characters.`);
  }
  return value;
}

export function listParam(
  params: URLSearchParams,
  key: string,
  options: { maxItems?: number; maxLength?: number } = {}
): string[] | undefined {
  const values = params
    .getAll(key)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) return undefined;
  const unique = [...new Set(values)];
  const maxItems = options.maxItems ?? 50;
  const maxLength = options.maxLength ?? 160;
  if (unique.length > maxItems) {
    throw new TransactionQueryValidationError(`${key} accepts at most ${maxItems} values.`);
  }
  if (unique.some((value) => value.length > maxLength)) {
    throw new TransactionQueryValidationError(`${key} contains a value longer than ${maxLength} characters.`);
  }
  return unique;
}

export function booleanParam(params: URLSearchParams, key: string): boolean | undefined {
  const value = clean(params.get(key));
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new TransactionQueryValidationError(`${key} must be true or false.`);
}

export function numberParam(
  params: URLSearchParams,
  key: string,
  options: { min?: number; max?: number; integer?: boolean } = {}
): number | undefined {
  const value = clean(params.get(key));
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (options.integer && !Number.isInteger(parsed))) {
    throw new TransactionQueryValidationError(`${key} must be ${options.integer ? "an integer" : "a number"}.`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new TransactionQueryValidationError(`${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new TransactionQueryValidationError(`${key} must be no more than ${options.max}.`);
  }
  return parsed;
}

export function dateParam(params: URLSearchParams, key: string): string | undefined {
  const value = clean(params.get(key));
  if (value === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TransactionQueryValidationError(`${key} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TransactionQueryValidationError(`${key} must be a real calendar day.`);
  }
  return value;
}

export function enumParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = clean(params.get(key));
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) {
    throw new TransactionQueryValidationError(`${key} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function enumListParam<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[]
): T[] | undefined {
  const values = listParam(params, key);
  if (!values) return undefined;
  for (const value of values) {
    if (!allowed.includes(value as T)) {
      throw new TransactionQueryValidationError(`${key} contains an unsupported value: ${value}.`);
    }
  }
  return values as T[];
}

export function pageParams(params: URLSearchParams): { page: number; pageSize: number } {
  const page = numberParam(params, "page", { min: 1, max: 1_000_000, integer: true }) ?? 1;
  const explicitPageSize = numberParam(params, "pageSize", { min: 1, max: 100, integer: true });
  // `limit` is temporary backwards compatibility for the current screens. New
  // ledgers must use pageSize and are capped at 100 rows per request.
  const legacyLimit = numberParam(params, "limit", { min: 1, max: 1000, integer: true });
  return { page, pageSize: explicitPageSize ?? legacyLimit ?? 50 };
}

export function sortParams<T extends string>(
  params: URLSearchParams,
  allowed: readonly T[],
  fallback: T
): { sort: T; direction: SortDirection } {
  return {
    sort: enumParam(params, "sort", allowed) ?? fallback,
    direction: enumParam(params, "direction", ["asc", "desc"] as const) ?? "desc"
  };
}

export function assertRange(
  minimum: number | string | undefined,
  maximum: number | string | undefined,
  label: string
): void {
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
    throw new TransactionQueryValidationError(`${label} minimum cannot exceed its maximum.`);
  }
}

export function addInFilter(
  clauses: string[],
  values: QueryScalar[],
  column: string,
  selected: readonly QueryScalar[] | undefined
): void {
  if (!selected?.length) return;
  clauses.push(`${column} IN (${selected.map(() => "?").join(", ")})`);
  values.push(...selected);
}

export function addLikeFilter(
  clauses: string[],
  values: QueryScalar[],
  expression: string,
  query: string | undefined
): void {
  if (!query) return;
  const escaped = query.replace(/[\\%_]/g, "\\$&");
  clauses.push(`LOWER(${expression}) LIKE ? ESCAPE '\\'`);
  values.push(`%${escaped.toLowerCase()}%`);
}

export function makePageInfo(page: number, pageSize: number, totalItems: number): PageInfo {
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize);
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
    hasNextPage: page < totalPages
  };
}

export function countRows(
  db: DatabaseSync,
  table: string,
  where: string,
  params: readonly QueryScalar[]
): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get(...params) as {
    count: number;
  };
  return Number(row.count);
}

export function facetCounts(
  db: DatabaseSync,
  table: string,
  column: string,
  where: string,
  params: readonly QueryScalar[],
  options: { includeEmpty?: boolean; limit?: number } = {}
): FacetCount[] {
  const emptyClause = options.includeEmpty ? "" : `AND ${column} IS NOT NULL AND ${column} <> ''`;
  const rows = db
    .prepare(`
      SELECT CAST(${column} AS TEXT) AS value, COUNT(*) AS count
      FROM ${table}
      ${where || "WHERE 1=1"} ${emptyClause}
      GROUP BY ${column}
      ORDER BY count DESC, value COLLATE NOCASE
      LIMIT ?
    `)
    .all(...params, options.limit ?? 100) as Array<{ value: string; count: number }>;
  return rows.map((row) => ({ value: String(row.value), count: Number(row.count) }));
}
