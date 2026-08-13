"use client";

import { useEffect, useState } from "react";
import styles from "./login.module.css";

/**
 * Sign-in — and, when no token is configured, the setup screen.
 *
 * With the locked-by-default model there are deployments where this page is
 * the only thing reachable. It has to say why, and what to do, rather than
 * offer a form that can never succeed.
 */
export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // null = still probing; a form flash before "locked" would invite typing
  // into a dead input.
  const [authConfigured, setAuthConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/login", { cache: "no-store" })
      .then((response) => response.json())
      .then((json) => {
        if (!cancelled) setAuthConfigured(json?.authConfigured !== false);
      })
      .catch(() => {
        // Probe failed: show the form. Signing in may still work, and the
        // form's own error handling reports anything real.
        if (!cancelled) setAuthConfigured(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });
      const json = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(json?.error || `Sign in failed (${response.status})`);
      }

      // Read the redirect target here rather than via useSearchParams so the
      // page does not need a Suspense boundary just to resolve a query param.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") ? next : "/");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  }

  if (authConfigured === false) {
    return (
      <main className={styles.page}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Marketing Bull</p>
          <h1 className={styles.title}>Dashboard locked</h1>
          <p className={styles.help}>
            No access token is configured, so nothing is served — this screen included nothing
            private. To unlock, set a token and restart the server:
          </p>
          <pre className={styles.setupBlock}>
            {"# generate a token\nopenssl rand -base64 32\n\n# .env.local (or the systemd unit)\nOWNER_DASHBOARD_AUTH_TOKEN=<that value>"}
          </pre>
          <p className={styles.help}>
            Then reload this page and sign in with the token. On a machine only you can reach, the
            old open behaviour is still available — but only by asking for it explicitly with{" "}
            <code>OWNER_DASHBOARD_ALLOW_UNPROTECTED=1</code>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <p className={styles.eyebrow}>Marketing Bull</p>
        <h1 className={styles.title}>Owner Dashboard</h1>
        <p className={styles.help}>
          {authConfigured === null ? "Checking configuration…" : "Enter the dashboard token to continue."}
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Access token</span>
          <input
            className={styles.input}
            type="password"
            name="token"
            value={token}
            autoComplete="current-password"
            autoFocus
            onChange={(event) => setToken(event.target.value)}
          />
        </label>

        <button className={styles.button} type="submit" disabled={submitting || !token}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </main>
  );
}
