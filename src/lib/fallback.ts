/**
 * Helpers for reporting *why* a route fell back to sample data.
 *
 * The dashboard drives daily decisions off MRR and priorities, so silently
 * substituting sample numbers is the worst available failure mode. Every
 * fallback path logs server-side and hands the client a short reason to show.
 */

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  const text = String(error);
  return text === "[object Object]" ? "Unknown error" : text;
}

/** Logs the failure with its source so it is greppable in server output. */
export function reportFallback(scope: string, error: unknown): string {
  const reason = describeError(error);
  console.error(`[owner-dashboard] ${scope} fell back to sample data: ${reason}`);
  return reason;
}
