"use client";

import { useState } from "react";
import type { ClickUpCredentialStatus } from "@/lib/clickup";
import styles from "../entities.module.css";

type TestResult = {
  ok?: boolean;
  user?: {
    username?: string;
    email?: string;
  } | null;
  error?: string;
};

function sourceLabel(source: ClickUpCredentialStatus["source"]): string {
  if (source === "settings") return "Settings";
  if (source === "environment") return "Environment";
  if (source === "openclaw") return "OpenClaw secrets";
  return "Not configured";
}

function formatUpdatedAt(value: string | null): string {
  if (!value) return "No saved Settings key";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Saved time unknown";
  return `Saved ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp)}`;
}

async function parseResponse(response: Response): Promise<Record<string, unknown>> {
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      json && typeof json === "object" && typeof json.error === "string"
        ? json.error
        : `Request failed (${response.status})`
    );
  }
  return json && typeof json === "object" ? json as Record<string, unknown> : {};
}

export function ClickUpSettingsCard({ initialStatus }: { initialStatus: ClickUpCredentialStatus }) {
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [busyAction, setBusyAction] = useState<"save" | "test" | "clear" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveKey() {
    setBusyAction("save");
    setMessage("");
    setError("");
    try {
      const json = await parseResponse(
        await fetch("/api/settings/clickup", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ apiKey })
        })
      );
      setStatus(json as ClickUpCredentialStatus);
      setApiKey("");
      setMessage("ClickUp API key saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setBusyAction(null);
    }
  }

  async function testKey() {
    setBusyAction("test");
    setMessage("");
    setError("");
    try {
      const body = apiKey.trim() ? { apiKey } : {};
      const json = await parseResponse(
        await fetch("/api/settings/clickup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        })
      ) as TestResult;
      const user = json.user?.username || json.user?.email;
      setMessage(user ? `ClickUp connection works for ${user}.` : "ClickUp connection works.");
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : String(testError));
    } finally {
      setBusyAction(null);
    }
  }

  async function clearKey() {
    setBusyAction("clear");
    setMessage("");
    setError("");
    try {
      const json = await parseResponse(
        await fetch("/api/settings/clickup", {
          method: "DELETE"
        })
      );
      setStatus(json as ClickUpCredentialStatus);
      setMessage("Settings key cleared.");
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      setBusyAction(null);
    }
  }

  const savingDisabled = busyAction !== null || !apiKey.trim();
  const testingDisabled = busyAction !== null || (!apiKey.trim() && !status.configured);
  const clearingDisabled = busyAction !== null || status.source !== "settings";

  return (
    <section className={styles.card}>
      <div className={styles.rowHead}>
        <div>
          <div className={styles.rowTitle}>ClickUp API Key</div>
          <div className={styles.rowMeta}>
            Source: {sourceLabel(status.source)}
            {status.maskedValue ? ` · ${status.maskedValue}` : ""}
          </div>
          <div className={styles.rowMeta}>{formatUpdatedAt(status.updatedAt)}</div>
        </div>
        <span className={`${styles.statusChip} ${status.configured ? styles.statusActive : ""}`}>
          {status.configured ? "configured" : "missing"}
        </span>
      </div>

      <div className={styles.form}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.label}>API key</span>
          <input
            className={styles.input}
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={status.configured ? "Paste a new key to replace the current one" : "Paste ClickUp API key"}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button className={styles.button} type="button" disabled={savingDisabled} onClick={() => void saveKey()}>
            {busyAction === "save" ? "Saving..." : "Save key"}
          </button>
          <button className={styles.button} type="button" disabled={testingDisabled} onClick={() => void testKey()}>
            {busyAction === "test" ? "Testing..." : "Test connection"}
          </button>
          <button
            className={`${styles.button} ${styles.buttonDanger}`}
            type="button"
            disabled={clearingDisabled}
            onClick={() => void clearKey()}
          >
            {busyAction === "clear" ? "Clearing..." : "Clear Settings key"}
          </button>
          {message ? <span className={styles.rowMeta}>{message}</span> : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>
    </section>
  );
}
