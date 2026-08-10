"use client";

import { useEffect } from "react";
import styles from "./error.module.css";

/**
 * Route-level error boundary.
 *
 * Without this, an unhandled render error replaces the entire dashboard with
 * Next's bare "Application error" string and no way back other than a reload.
 */
export default function DashboardError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[owner-dashboard] render error:", error);
  }, [error]);

  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Marketing Bull / Owner view</p>
        <h1 className={styles.title}>The dashboard hit an error.</h1>
        <p className={styles.body}>
          Your saved state is safe on the server — this only affects rendering. Try again, and if it keeps
          happening the message below is the place to start.
        </p>
        <pre className={styles.detail}>{error.message || "Unknown error"}</pre>
        <button type="button" className={styles.button} onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
