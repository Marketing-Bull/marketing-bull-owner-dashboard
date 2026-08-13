import type { DatabaseSync } from "node:sqlite";

const CLICKUP_API_KEY_SETTING = "clickup.api_key";

type SettingRow = {
  value: string;
  updated_at: string;
};

export type StoredSecretSummary = {
  configured: boolean;
  maskedValue: string | null;
  updatedAt: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "configured";
  return `********${trimmed.slice(-4)}`;
}

function getSettingRow(db: DatabaseSync, key: string): SettingRow | null {
  const row = db.prepare("SELECT value, updated_at FROM app_settings WHERE key = ?").get(key) as
    | SettingRow
    | undefined;
  return row ?? null;
}

export function getStoredClickUpApiKey(db: DatabaseSync): string | null {
  const value = getSettingRow(db, CLICKUP_API_KEY_SETTING)?.value.trim();
  return value || null;
}

export function getStoredClickUpApiKeySummary(db: DatabaseSync): StoredSecretSummary {
  const row = getSettingRow(db, CLICKUP_API_KEY_SETTING);
  const value = row?.value.trim() || "";
  return {
    configured: Boolean(value),
    maskedValue: value ? maskSecret(value) : null,
    updatedAt: value ? row?.updated_at ?? null : null
  };
}

export function setStoredClickUpApiKey(db: DatabaseSync, apiKey: string): StoredSecretSummary {
  const value = apiKey.trim();
  if (!value) {
    throw new Error("ClickUp API key cannot be blank.");
  }
  const updatedAt = nowIso();
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `).run(CLICKUP_API_KEY_SETTING, value, updatedAt);
  return getStoredClickUpApiKeySummary(db);
}

export function deleteStoredClickUpApiKey(db: DatabaseSync): StoredSecretSummary {
  db.prepare("DELETE FROM app_settings WHERE key = ?").run(CLICKUP_API_KEY_SETTING);
  return getStoredClickUpApiKeySummary(db);
}
