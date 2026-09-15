"use client";

import { useId } from "react";
import { Minus, Plus } from "lucide-react";
import {
  describeHours,
  formatHours,
  HOURS_PRESETS,
  parseHoursInput,
  presetLabel,
  stepHours
} from "@/lib/hours-input";
import styles from "./transaction-ledger.module.css";

/**
 * The Time screen's hours entry.
 *
 * A quarter hour is one tap, and an odd duration is still just typing — the
 * field takes `1.35`, `1:21`, and `90m` alike. The hint under the field always
 * shows what will be saved, so a mistyped shorthand is visible before saving
 * rather than after.
 */
export function HoursField({
  value,
  error,
  onChange
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const hintId = useId();
  const parsed = parseHoursInput(value);
  const stepSize = 0.25;

  return (
    <div className={`${styles.sheetField} ${styles.spanAll}`}>
      <label className={styles.hoursLabel} htmlFor={`${hintId}-input`}>
        <span className={styles.fieldLabel}>Hours</span>
      </label>
      <div className={styles.hoursRow}>
        <input
          id={`${hintId}-input`}
          className={styles.input}
          inputMode="decimal"
          autoComplete="off"
          placeholder="1.35"
          aria-describedby={hintId}
          aria-invalid={value.trim() !== "" && parsed === null}
          value={value}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className={styles.stepButton}
          aria-label="Subtract 15 minutes"
          disabled={parsed === null}
          onClick={() => onChange(stepHours(value, -stepSize))}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          className={styles.stepButton}
          aria-label="Add 15 minutes"
          onClick={() => onChange(stepHours(value, stepSize))}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className={styles.chipRow}>
        {HOURS_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={`${styles.chip} ${parsed === preset ? styles.chipActive : ""}`}
            aria-pressed={parsed === preset}
            onClick={() => onChange(formatHours(preset))}
          >
            {presetLabel(preset)}
          </button>
        ))}
      </div>
      <span id={hintId} className={error ? styles.fieldError : styles.addressHint}>
        {error
          ? error
          : parsed !== null
            ? `${describeHours(parsed)} · saved as ${formatHours(parsed)} hours`
            : "Type 1.35, 1:21, or 90m — or tap a preset."}
      </span>
    </div>
  );
}
