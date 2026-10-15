"use client";

import { useEffect, useRef } from "react";
import styles from "./transaction-ledger.module.css";

export function DeleteDialog({
  open,
  title,
  description,
  confirmLabel,
  busyLabel = "Deleting…",
  tone = "danger",
  busy,
  error,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busyLabel?: string;
  /** "primary" for a confirmation that isn't a deletion, such as closing a task. */
  tone?: "danger" | "primary";
  busy: boolean;
  /** A failed delete, shown in the dialog that covers the page's banner. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);
  if (!open) return null;
  return (
    <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onCancel();
    }}>
      <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
        <h2 id="delete-title">{title}</h2>
        <p id="delete-description">{description}</p>
        {error ? <p className={styles.dialogError} role="alert">{error}</p> : null}
        <div className={styles.dialogActions}>
          <button ref={cancelRef} type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={tone === "primary" ? styles.primaryButton : styles.dangerButton} onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
