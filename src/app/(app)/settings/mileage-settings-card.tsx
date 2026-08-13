"use client";

import { useState } from "react";
import styles from "../entities.module.css";

export function MileageSettingsCard({ initialRate }: { initialRate: number }) {
  const [rate, setRate] = useState(String(initialRate));
  const [savedRate, setSavedRate] = useState(initialRate);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function saveRate() {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/mileage/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mileageRate: Number(rate) })
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : "Unable to save mileage rate.");
      const nextRate = Number(json.mileageRate);
      setSavedRate(nextRate); setRate(String(nextRate)); setMessage("Mileage reimbursement rate saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  }

  const parsed = Number(rate);
  return <section className={styles.card}>
    <div className={styles.rowHead}>
      <div><div className={styles.rowTitle}>Mileage reimbursement</div><div className={styles.rowMeta}>Used to estimate reimbursement in the Mileage ledger. Stored miles never change when this rate changes.</div></div>
      <span className={`${styles.statusChip} ${styles.statusActive}`}>${savedRate.toFixed(2)}/mi</span>
    </div>
    <div className={styles.form}>
      <label className={styles.field}><span className={styles.label}>Rate per mile</span><input className={styles.input} type="number" inputMode="decimal" min="0" max="10" step="0.01" value={rate} onChange={(event) => setRate(event.target.value)} /></label>
      <div className={styles.formActions}><button type="button" className={styles.button} disabled={busy || !Number.isFinite(parsed) || parsed < 0 || parsed > 10 || parsed === savedRate} onClick={() => void saveRate()}>{busy ? "Saving…" : "Save rate"}</button>{message ? <span className={styles.rowMeta}>{message}</span> : null}{error ? <span className={styles.error}>{error}</span> : null}</div>
    </div>
  </section>;
}
