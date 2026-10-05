/**
 * Tracks address pairs already auto-routed (or opened as already calculated).
 *
 * A pair is reserved when a calculation starts so the effect does not fire
 * twice for the same key. On success it stays locked (plus any normalized
 * label aliases). On failure it is unlocked so the same addresses can retry.
 */
export type RouteCalcLock = {
  has(key: string): boolean;
  /** Reserve a key for an in-flight attempt. False if already reserved/done. */
  begin(key: string): boolean;
  /** Keep the key locked after success; optionally lock normalized aliases. */
  succeed(key: string, ...aliases: string[]): void;
  /** Unlock so the pair can be retried after a failed calculation. */
  fail(key: string): void;
};

export function createRouteCalcLock(seed: Iterable<string> = []): RouteCalcLock {
  const keys = new Set(seed);
  return {
    has(key) {
      return keys.has(key);
    },
    begin(key) {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
    succeed(key, ...aliases) {
      keys.add(key);
      for (const alias of aliases) keys.add(alias);
    },
    fail(key) {
      keys.delete(key);
    }
  };
}
