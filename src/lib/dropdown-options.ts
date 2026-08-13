/**
 * Settings-owned dropdown vocabulary.
 *
 * These are the words the owner picks from — expense categories today — not
 * structural enums and not relational entities. Clients, projects, account
 * codes, expense/income kind, and recurring frequency stay where they are:
 * database constraints and business logic depend on those, and a Settings form
 * must not be able to redefine them.
 *
 * Transaction rows keep their plain text columns for now (redesign plan, staged
 * approach). That has one consequence worth stating out loud: renaming an
 * option rewrites the label on the records that use it, because leaving them
 * behind would strand history under a word no longer offered anywhere. Every
 * other lifecycle action leaves records untouched — deactivating hides an
 * option from new entries and keeps it readable on old ones.
 */

import type { DatabaseSync } from "node:sqlite";

type UsageSource = { table: string; column: string };

type DropdownList = {
  label: string;
  /** Singular noun used in messages: "category already exists". */
  noun: string;
  /**
   * Where the option's label is stored on real records. Registry-owned, never
   * request-owned: these strings are interpolated into SQL.
   */
  usage: UsageSource[];
};

export const DROPDOWN_LISTS = {
  "expense.category": {
    label: "Expense categories",
    noun: "category",
    usage: [
      { table: "expenses", column: "category" },
      { table: "recurring_expenses", column: "category" }
    ]
  }
} as const satisfies Record<string, DropdownList>;

export type DropdownListKey = keyof typeof DROPDOWN_LISTS;

export const DROPDOWN_LIST_KEYS = Object.keys(DROPDOWN_LISTS) as DropdownListKey[];

export const MAX_OPTION_LABEL_LENGTH = 60;

export class DropdownOptionError extends Error {}

export type DropdownOption = {
  id: string;
  listKey: DropdownListKey;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  /** Records currently carrying this label. */
  usageCount: number;
  createdAt: string;
  updatedAt: string;
};

type Row = Record<string, unknown>;

export function isDropdownListKey(value: unknown): value is DropdownListKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DROPDOWN_LISTS, value);
}

function assertListKey(value: unknown): DropdownListKey {
  if (!isDropdownListKey(value)) {
    throw new DropdownOptionError(`Unknown option list "${String(value)}".`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalize(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function cleanLabel(value: unknown): string {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!label) throw new DropdownOptionError("Label is required.");
  if (label.length > MAX_OPTION_LABEL_LENGTH) {
    throw new DropdownOptionError(`Label cannot exceed ${MAX_OPTION_LABEL_LENGTH} characters.`);
  }
  return label;
}

function rowToOption(row: Row, usageCount: number): DropdownOption {
  return {
    id: String(row.id),
    listKey: row.list_key as DropdownListKey,
    label: String(row.label),
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    isDefault: Boolean(row.is_default),
    usageCount,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function countDropdownOptionUsage(db: DatabaseSync, listKey: DropdownListKey, label: string): number {
  let total = 0;
  for (const source of DROPDOWN_LISTS[listKey].usage) {
    const row = db
      .prepare(`SELECT COUNT(*) AS count FROM ${source.table} WHERE LOWER(TRIM(${source.column})) = ?`)
      .get(normalize(label)) as { count?: unknown };
    total += Number(row?.count ?? 0);
  }
  return total;
}

/** Rewrites the label on every record that uses it. Returns rows touched. */
function relabelRecords(db: DatabaseSync, listKey: DropdownListKey, from: string, to: string): number {
  if (normalize(from) === normalize(to) && from === to) return 0;
  let changed = 0;
  for (const source of DROPDOWN_LISTS[listKey].usage) {
    const result = db
      .prepare(`UPDATE ${source.table} SET ${source.column} = ? WHERE LOWER(TRIM(${source.column})) = ?`)
      .run(to, normalize(from));
    changed += Number(result.changes);
  }
  return changed;
}

function getRow(db: DatabaseSync, id: string): Row {
  const row = db.prepare("SELECT * FROM dropdown_options WHERE id = ?").get(id) as Row | undefined;
  if (!row) throw new DropdownOptionError("No such option.");
  return row;
}

function findByLabel(db: DatabaseSync, listKey: DropdownListKey, label: string): Row | null {
  const row = db
    .prepare("SELECT * FROM dropdown_options WHERE list_key = ? AND normalized_label = ?")
    .get(listKey, normalize(label)) as Row | undefined;
  return row ?? null;
}

export function listDropdownOptions(
  db: DatabaseSync,
  listKey: DropdownListKey,
  options: { includeInactive?: boolean } = {}
): DropdownOption[] {
  const rows = db
    .prepare(`
      SELECT * FROM dropdown_options
      WHERE list_key = ? ${options.includeInactive ? "" : "AND is_active = 1"}
      ORDER BY sort_order, label COLLATE NOCASE
    `)
    .all(listKey) as Row[];
  return rows.map((row) => rowToOption(row, countDropdownOptionUsage(db, listKey, String(row.label))));
}

/**
 * The labels a picker should offer, with `current` kept even when it has been
 * deactivated or renamed away — editing a record must never silently change a
 * value the form did not ask about.
 */
export function pickerLabels(db: DatabaseSync, listKey: DropdownListKey, current?: string | null): string[] {
  const labels = (db
    .prepare("SELECT label FROM dropdown_options WHERE list_key = ? AND is_active = 1 ORDER BY sort_order, label COLLATE NOCASE")
    .all(listKey) as Row[]).map((row) => String(row.label));
  const existing = current?.trim();
  if (existing && !labels.some((label) => normalize(label) === normalize(existing))) labels.push(existing);
  return labels;
}

export function getDefaultDropdownLabel(db: DatabaseSync, listKey: DropdownListKey): string | null {
  const row = db
    .prepare("SELECT label FROM dropdown_options WHERE list_key = ? AND is_active = 1 AND is_default = 1 ORDER BY sort_order LIMIT 1")
    .get(listKey) as Row | undefined;
  return row ? String(row.label) : null;
}

export function createDropdownOption(db: DatabaseSync, listKeyValue: unknown, labelValue: unknown): DropdownOption {
  const listKey = assertListKey(listKeyValue);
  const label = cleanLabel(labelValue);
  if (findByLabel(db, listKey, label)) {
    throw new DropdownOptionError(`That ${DROPDOWN_LISTS[listKey].noun} already exists.`);
  }
  const next = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM dropdown_options WHERE list_key = ?")
    .get(listKey) as { next?: unknown };
  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare(`
    INSERT INTO dropdown_options (
      id, list_key, label, normalized_label, sort_order, is_active, is_default, metadata_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 1, 0, '{}', ?, ?)
  `).run(id, listKey, label, normalize(label), Number(next?.next ?? 0), now, now);
  return rowToOption(getRow(db, id), countDropdownOptionUsage(db, listKey, label));
}

export type DropdownOptionPatch = {
  label?: unknown;
  isActive?: unknown;
  isDefault?: unknown;
};

export function updateDropdownOption(
  db: DatabaseSync,
  id: string,
  patch: DropdownOptionPatch
): { option: DropdownOption; relabeledRecords: number } {
  const row = getRow(db, id);
  const listKey = assertListKey(row.list_key);
  const previousLabel = String(row.label);
  const label = patch.label === undefined ? previousLabel : cleanLabel(patch.label);
  const conflict = findByLabel(db, listKey, label);
  if (conflict && String(conflict.id) !== id) {
    throw new DropdownOptionError(`Another ${DROPDOWN_LISTS[listKey].noun} already uses that name.`);
  }

  const isActive = patch.isActive === undefined ? Boolean(row.is_active) : Boolean(patch.isActive);
  // An inactive default would apply a value that is no longer offered.
  const isDefault = (patch.isDefault === undefined ? Boolean(row.is_default) : Boolean(patch.isDefault)) && isActive;
  const now = nowIso();

  db.exec("BEGIN");
  try {
    const relabeledRecords = label === previousLabel ? 0 : relabelRecords(db, listKey, previousLabel, label);
    if (isDefault) {
      db.prepare("UPDATE dropdown_options SET is_default = 0, updated_at = ? WHERE list_key = ? AND id <> ?")
        .run(now, listKey, id);
    }
    db.prepare(`
      UPDATE dropdown_options
      SET label = ?, normalized_label = ?, is_active = ?, is_default = ?, updated_at = ?
      WHERE id = ?
    `).run(label, normalize(label), isActive ? 1 : 0, isDefault ? 1 : 0, now, id);
    db.exec("COMMIT");
    return { option: rowToOption(getRow(db, id), countDropdownOptionUsage(db, listKey, label)), relabeledRecords };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Swaps an option with its neighbour so Settings can order the picker. */
export function moveDropdownOption(db: DatabaseSync, id: string, direction: "up" | "down"): DropdownOption[] {
  const row = getRow(db, id);
  const listKey = assertListKey(row.list_key);
  const ordered = db
    .prepare("SELECT id FROM dropdown_options WHERE list_key = ? ORDER BY sort_order, label COLLATE NOCASE")
    .all(listKey) as Row[];
  const index = ordered.findIndex((candidate) => String(candidate.id) === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) {
    return listDropdownOptions(db, listKey, { includeInactive: true });
  }
  const reordered = [...ordered];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  const now = nowIso();
  db.exec("BEGIN");
  try {
    const update = db.prepare("UPDATE dropdown_options SET sort_order = ?, updated_at = ? WHERE id = ?");
    reordered.forEach((candidate, position) => update.run(position, now, String(candidate.id)));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return listDropdownOptions(db, listKey, { includeInactive: true });
}

/**
 * Removes an option outright. Records using it must be moved to a replacement
 * first — deleting the word out from under them would leave rows labelled with
 * something Settings no longer knows about.
 */
export function deleteDropdownOption(
  db: DatabaseSync,
  id: string,
  replacementValue?: unknown
): { reassignedRecords: number } {
  const row = getRow(db, id);
  const listKey = assertListKey(row.list_key);
  const label = String(row.label);
  const usageCount = countDropdownOptionUsage(db, listKey, label);
  const replacement = replacementValue === undefined || replacementValue === null || replacementValue === ""
    ? null
    : cleanLabel(replacementValue);

  if (usageCount > 0 && !replacement) {
    throw new DropdownOptionError(
      `"${label}" is used by ${usageCount} record${usageCount === 1 ? "" : "s"}. Choose a replacement before deleting it.`
    );
  }
  if (replacement) {
    const target = findByLabel(db, listKey, replacement);
    if (!target) throw new DropdownOptionError("The replacement option does not exist.");
    if (String(target.id) === id) throw new DropdownOptionError("Choose a different option as the replacement.");
  }

  db.exec("BEGIN");
  try {
    const reassignedRecords = replacement ? relabelRecords(db, listKey, label, replacement) : 0;
    db.prepare("DELETE FROM dropdown_options WHERE id = ?").run(id);
    db.exec("COMMIT");
    return { reassignedRecords };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
