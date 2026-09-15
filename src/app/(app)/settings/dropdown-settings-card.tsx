"use client";

import { useState } from "react";
import type { DropdownListKey, DropdownOption } from "@/lib/dropdown-options";
import styles from "../entities.module.css";

/**
 * Settings control for one editable option list.
 *
 * Add, rename, reorder, default, deactivate, and delete — the lifecycle the
 * redesign plan asks for. Each row states what it costs: how many records use
 * the option, that renaming updates them, and that deactivating leaves them
 * alone. Deleting an option that is in use requires naming its replacement.
 */
export function DropdownSettingsCard({
  listKey,
  title,
  description,
  initialOptions
}: {
  listKey: DropdownListKey;
  title: string;
  description: string;
  initialOptions: DropdownOption[];
}) {
  const [options, setOptions] = useState(initialOptions);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [removing, setRemoving] = useState<{ option: DropdownOption; replaceWith: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function call(path: string, init: RequestInit, describe: (json: Record<string, unknown>) => string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(path, init);
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof json.error === "string" ? json.error : `Request failed (${response.status})`);
      if (Array.isArray(json.options)) setOptions(json.options as DropdownOption[]);
      setMessage(describe(json));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const activeOptions = options.filter((option) => option.isActive);

  return (
    <section className={styles.card}>
      <div className={styles.rowHead}>
        <div>
          <div className={styles.rowTitle}>{title}</div>
          <div className={styles.rowMeta}>{description}</div>
        </div>
        <span className={styles.statusChip}>
          {activeOptions.length} active / {options.length}
        </span>
      </div>

      <div className={styles.form}>
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.label}>Add an option</span>
          <input
            className={styles.input}
            value={newLabel}
            maxLength={60}
            placeholder="Category name"
            onChange={(event) => setNewLabel(event.target.value)}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="button"
            className={styles.button}
            disabled={busy || !newLabel.trim()}
            onClick={async () => {
              const label = newLabel.trim();
              if (await call("/api/dropdown-options", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ listKey, label })
              }, () => `Added “${label}”.`)) setNewLabel("");
            }}
          >
            {busy ? "Working…" : "Add"}
          </button>
          {message ? <span className={styles.rowMeta}>{message}</span> : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.list}>
        {options.map((option, index) => (
          <div key={option.id} className={`${styles.row} ${option.isActive ? "" : styles.rowArchived}`}>
            <div className={styles.rowHead}>
              <div>
                <div className={styles.rowTitle}>{option.label}</div>
                <div className={styles.rowMeta}>
                  {option.usageCount} record{option.usageCount === 1 ? "" : "s"}
                  {option.isDefault ? " · applied by default to new records" : ""}
                  {option.isActive ? "" : " · hidden from new records, kept on existing ones"}
                </div>
              </div>
              <div className={styles.rowActions}>
                <button type="button" className={styles.buttonQuiet} disabled={busy || index === 0}
                  aria-label={`Move ${option.label} up`}
                  onClick={() => void call(`/api/dropdown-options/${option.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ listKey, move: "up" })
                  }, () => `Moved “${option.label}” up.`)}
                >↑</button>
                <button type="button" className={styles.buttonQuiet} disabled={busy || index === options.length - 1}
                  aria-label={`Move ${option.label} down`}
                  onClick={() => void call(`/api/dropdown-options/${option.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ listKey, move: "down" })
                  }, () => `Moved “${option.label}” down.`)}
                >↓</button>
                <button type="button" className={styles.buttonQuiet} disabled={busy}
                  onClick={() => { setEditing({ id: option.id, label: option.label }); setRemoving(null); }}
                >Rename</button>
                <button type="button" className={styles.buttonQuiet} disabled={busy || !option.isActive || option.isDefault}
                  onClick={() => void call(`/api/dropdown-options/${option.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ listKey, isDefault: true })
                  }, () => `“${option.label}” is now the default.`)}
                >{option.isDefault ? "Default" : "Set default"}</button>
                <button type="button" className={styles.buttonQuiet} disabled={busy}
                  onClick={() => void call(`/api/dropdown-options/${option.id}`, {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ listKey, isActive: !option.isActive })
                  }, () => option.isActive
                    ? `“${option.label}” is hidden from new records. Existing records keep it.`
                    : `“${option.label}” is available again.`)}
                >{option.isActive ? "Deactivate" : "Reactivate"}</button>
                <button type="button" className={`${styles.button} ${styles.buttonDanger}`} disabled={busy}
                  onClick={() => {
                    setEditing(null);
                    setRemoving({ option, replaceWith: activeOptions.find((candidate) => candidate.id !== option.id)?.label ?? "" });
                  }}
                >Delete</button>
              </div>
            </div>

            {editing?.id === option.id ? (
              <div className={styles.form}>
                <label className={`${styles.field} ${styles.fieldWide}`}>
                  <span className={styles.label}>New name</span>
                  <input className={styles.input} value={editing.label} maxLength={60} autoFocus
                    onChange={(event) => setEditing({ id: option.id, label: event.target.value })} />
                </label>
                <div className={styles.formActions}>
                  <button type="button" className={styles.button} disabled={busy || !editing.label.trim()}
                    onClick={async () => {
                      const label = editing.label.trim();
                      if (await call(`/api/dropdown-options/${option.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ listKey, label })
                      }, (json) => {
                        const relabeled = Number(json.relabeledRecords ?? 0);
                        return relabeled
                          ? `Renamed to “${label}” and updated ${relabeled} record${relabeled === 1 ? "" : "s"}.`
                          : `Renamed to “${label}”.`;
                      })) setEditing(null);
                    }}
                  >Save name</button>
                  <button type="button" className={styles.buttonQuiet} disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
                  <span className={styles.rowMeta}>Renaming updates the {option.usageCount} record{option.usageCount === 1 ? "" : "s"} using it.</span>
                </div>
              </div>
            ) : null}

            {removing?.option.id === option.id ? (
              <div className={styles.form}>
                {option.usageCount > 0 ? (
                  <label className={`${styles.field} ${styles.fieldWide}`}>
                    <span className={styles.label}>Move {option.usageCount} record{option.usageCount === 1 ? "" : "s"} to</span>
                    <select className={styles.select} value={removing.replaceWith}
                      onChange={(event) => setRemoving({ option, replaceWith: event.target.value })}>
                      <option value="">Choose a replacement</option>
                      {options.filter((candidate) => candidate.id !== option.id).map((candidate) => (
                        <option key={candidate.id} value={candidate.label}>{candidate.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className={styles.formActions}>
                  <button type="button" className={`${styles.button} ${styles.buttonDanger}`}
                    disabled={busy || (option.usageCount > 0 && !removing.replaceWith)}
                    onClick={async () => {
                      const query = new URLSearchParams({ listKey });
                      if (removing.replaceWith) query.set("replaceWith", removing.replaceWith);
                      if (await call(`/api/dropdown-options/${option.id}?${query}`, { method: "DELETE" }, (json) => {
                        const moved = Number(json.reassignedRecords ?? 0);
                        return moved
                          ? `Deleted “${option.label}” and moved ${moved} record${moved === 1 ? "" : "s"} to “${removing.replaceWith}”.`
                          : `Deleted “${option.label}”.`;
                      })) setRemoving(null);
                    }}
                  >Delete “{option.label}”</button>
                  <button type="button" className={styles.buttonQuiet} disabled={busy} onClick={() => setRemoving(null)}>Cancel</button>
                </div>
              </div>
            ) : null}
          </div>
        ))}
        {options.length === 0 ? <p className={styles.empty}>No options yet. Add the first one above.</p> : null}
      </div>
    </section>
  );
}
