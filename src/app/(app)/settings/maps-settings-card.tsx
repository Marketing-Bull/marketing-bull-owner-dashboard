"use client";

import { useState } from "react";
import type { StoredSecretSummary } from "@/lib/app-settings";
import styles from "../entities.module.css";

type Status = StoredSecretSummary & { provider: string };
async function responseJson(response: Response) { const json = await response.json().catch(() => ({})); if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `Request failed (${response.status})`); return json; }

export function MapsSettingsCard({ initialStatus }: { initialStatus: Status }) {
  const [status, setStatus] = useState(initialStatus); const [apiKey, setApiKey] = useState(""); const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  async function action(kind: "save" | "test" | "clear") { setBusy(kind); setMessage(""); setError(""); try { if (kind === "save") { const json = await responseJson(await fetch("/api/settings/maps", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) })); setStatus(json as Status); setApiKey(""); setMessage("Maps API key saved."); } else if (kind === "clear") { setStatus(await responseJson(await fetch("/api/settings/maps", { method: "DELETE" })) as Status); setMessage("Maps API key cleared. Manual mileage remains available."); } else { const json = await responseJson(await fetch("/api/settings/maps", { method: "POST" })); setMessage(json.sample ? `Maps connection works. Sample result: ${json.sample}` : "Maps connection works."); } } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } finally { setBusy(null); } }
  return <section className={styles.card}>
    <div className={styles.rowHead}><div><div className={styles.rowTitle}>Mileage maps provider</div><div className={styles.rowMeta}>OpenRouteService · server-side address search and driving distance</div><div className={styles.rowMeta}>{status.maskedValue ? `Saved key ${status.maskedValue}` : "No provider key saved; Mileage uses manual miles."}</div></div><span className={`${styles.statusChip} ${status.configured ? styles.statusActive : ""}`}>{status.configured ? "configured" : "manual only"}</span></div>
    <div className={styles.form}><label className={`${styles.field} ${styles.fieldWide}`}><span className={styles.label}>OpenRouteService API key</span><input className={styles.input} type="password" autoComplete="off" value={apiKey} placeholder={status.configured ? "Paste a new key to replace the saved key" : "Paste API key"} onChange={(event) => setApiKey(event.target.value)} /></label><div className={styles.formActions}><button type="button" className={styles.button} disabled={busy !== null || !apiKey.trim()} onClick={() => void action("save")}>{busy === "save" ? "Saving…" : "Save key"}</button><button type="button" className={styles.button} disabled={busy !== null || !status.configured} onClick={() => void action("test")}>{busy === "test" ? "Testing…" : "Test connection"}</button><button type="button" className={`${styles.button} ${styles.buttonDanger}`} disabled={busy !== null || !status.configured} onClick={() => void action("clear")}>{busy === "clear" ? "Clearing…" : "Clear key"}</button>{message ? <span className={styles.rowMeta}>{message}</span> : null}{error ? <span className={styles.error}>{error}</span> : null}</div></div>
    <p className={styles.empty}>Only From and To route inputs are sent to the provider. Client, project, purpose, and notes remain local.</p>
  </section>;
}
