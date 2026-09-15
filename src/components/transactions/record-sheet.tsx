"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import styles from "./transaction-ledger.module.css";

export function RecordSheet({
  open,
  title,
  subtitle,
  dirty,
  onClose,
  children,
  footer
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  dirty?: boolean;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const keepEditingRef = useRef<HTMLButtonElement>(null);
  const [confirmingClose, setConfirmingClose] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }, [dirty, onClose]);

  const discardChanges = useCallback(() => {
    setConfirmingClose(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmingClose) {
        setConfirmingClose(false);
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [confirmingClose, open, requestClose]);

  useEffect(() => {
    if (confirmingClose) keepEditingRef.current?.focus();
  }, [confirmingClose]);

  if (!open) return null;
  return (
    <>
      <button type="button" className={styles.sheetBackdrop} aria-label="Close form" onClick={requestClose} />
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="record-sheet-title">
        <header className={styles.sheetHeader}>
          <button ref={closeButtonRef} type="button" className={styles.iconButton} onClick={requestClose} aria-label="Close form">
            <X size={19} />
          </button>
          <div className={styles.sheetHeaderText}>
            <h2 id="record-sheet-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        <div className={styles.sheetBody}>{children}</div>
        <footer className={styles.sheetFooter}>{footer}</footer>
      </section>
      {confirmingClose ? (
        <div className={styles.dialogBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmingClose(false);
        }}>
          <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="discard-title" aria-describedby="discard-description">
            <h2 id="discard-title">Discard unsaved changes?</h2>
            <p id="discard-description">Your changes have not been saved. You can keep editing or discard this draft.</p>
            <div className={styles.dialogActions}>
              <button ref={keepEditingRef} type="button" className={styles.secondaryButton} onClick={() => setConfirmingClose(false)}>Keep editing</button>
              <button type="button" className={styles.dangerButton} onClick={discardChanges}>Discard changes</button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
