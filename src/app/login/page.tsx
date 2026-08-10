"use client";

import { useState } from "react";
import styles from "./login.module.css";

export default function LoginPage() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

  return (
    <main className={styles.page}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <p className={styles.eyebrow}>Marketing Bull</p>
        <h1 className={styles.title}>Owner Dashboard</h1>
        <p className={styles.help}>Enter the dashboard token to continue.</p>

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
