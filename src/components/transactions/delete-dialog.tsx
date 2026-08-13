"use client";

import { useEffect, useRef } from "react";
import styles from "./transaction-ledger.module.css";

export function DeleteDialog({
  open,
  title,
  description,
  confirmLabel,
  busy,
  onCancel,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
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
        <div className={styles.dialogActions}>
          <button ref={cancelRef} type="button" className={styles.secondaryButton} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className={styles.dangerButton} onClick={onConfirm} disabled={busy}>
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
