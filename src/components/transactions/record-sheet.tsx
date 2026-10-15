"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import styles from "./transaction-ledger.module.css";

export function RecordSheet({
  open,
  title,
  subtitle,
  dirty,
  error,
  onClose,
  children,
  footer,
  notice,
  onNoticeClear
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  dirty?: boolean;
  /** A failed save, shown inside the sheet: the page behind it is covered. */
  error?: string | null;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  notice?: string;
  onNoticeClear?: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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

  // The Escape handler reads the latest state through refs, so the effect below
  // runs once per open. Re-running it on every parent render (requestClose and
  // the pages' inline onClose change each time) stole focus mid-typing.
  const confirmingCloseRef = useRef(confirmingClose);
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    confirmingCloseRef.current = confirmingClose;
    requestCloseRef.current = requestClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Keep a field's autoFocus; otherwise start on the first field, not on X.
    if (!sheetRef.current?.contains(document.activeElement)) {
      const firstField = bodyRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])"
      );
      (firstField ?? closeButtonRef.current)?.focus();
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (confirmingCloseRef.current) {
        setConfirmingClose(false);
        return;
      }
      requestCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  useEffect(() => {
    if (confirmingClose) keepEditingRef.current?.focus();
  }, [confirmingClose]);

  if (!open) return null;
  return (
    <>
      <button type="button" className={styles.sheetBackdrop} aria-label="Close form" onClick={requestClose} />
      <section ref={sheetRef} className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="record-sheet-title">
        <header className={styles.sheetHeader}>
          <button ref={closeButtonRef} type="button" className={styles.iconButton} onClick={requestClose} aria-label="Close form">
            <X size={19} />
          </button>
          <div className={styles.sheetHeaderText}>
            <h2 id="record-sheet-title">{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </header>
        <div ref={bodyRef} className={styles.sheetBody} onChangeCapture={onNoticeClear}>{children}</div>
        {notice ? <p className={styles.sheetNotice} role="status">{notice}</p> : null}
        {error ? <p className={styles.sheetError} role="alert">{error}</p> : null}
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
