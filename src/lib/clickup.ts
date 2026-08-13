/**
 * Shared ClickUp access.
 *
 * The API base is configurable so the write path can be exercised against a
 * stand-in server. Marking a task done mutates real work items, and pointing a
 * test at the live account to find out whether the mapping is right is not an
 * option.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getStoredClickUpApiKey, getStoredClickUpApiKeySummary } from "@/lib/app-settings";
import { getDatabase } from "@/lib/dashboard-state";

type SecretsFile = {
  env?: {
    CLICKUP_API_KEY?: string;
  };
};

export type ClickUpCredentialSource = "settings" | "environment" | "openclaw" | null;

export type ClickUpCredentialStatus = {
  configured: boolean;
  source: ClickUpCredentialSource;
  maskedValue: string | null;
  updatedAt: string | null;
};

/** ClickUp status types. `closed` and `done` both mean finished. */
export type ClickUpStatus = {
  status?: string;
  type?: string;
};

export type ClickUpList = {
  id?: string;
  name?: string;
  statuses?: ClickUpStatus[];
};

export function clickUpApiBase(): string {
  return (
    process.env.OWNER_DASHBOARD_CLICKUP_API_BASE?.trim().replace(/\/$/, "") ||
    "https://api.clickup.com/api/v2"
  );
}

function maskFallbackSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "configured";
  return `********${trimmed.slice(-4)}`;
}

async function readOpenClawClickUpApiKey(): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(join(homedir(), ".openclaw", "secrets.json"), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const secrets = JSON.parse(raw) as SecretsFile;
  return secrets.env?.CLICKUP_API_KEY?.trim() || null;
}

export async function getClickUpApiKey(): Promise<string | null> {
  const stored = getStoredClickUpApiKey(getDatabase());
  if (stored) return stored;

  const envKey = process.env.CLICKUP_API_KEY?.trim();
  if (envKey) return envKey;

  return readOpenClawClickUpApiKey();
}

export async function getClickUpCredentialStatus(): Promise<ClickUpCredentialStatus> {
  const stored = getStoredClickUpApiKeySummary(getDatabase());
  if (stored.configured) {
    return {
      configured: true,
      source: "settings",
      maskedValue: stored.maskedValue,
      updatedAt: stored.updatedAt
    };
  }

  const envKey = process.env.CLICKUP_API_KEY?.trim();
  if (envKey) {
    return {
      configured: true,
      source: "environment",
      maskedValue: maskFallbackSecret(envKey),
      updatedAt: null
    };
  }

  const openClawKey = await readOpenClawClickUpApiKey();
  if (openClawKey) {
    return {
      configured: true,
      source: "openclaw",
      maskedValue: maskFallbackSecret(openClawKey),
      updatedAt: null
    };
  }

  return {
    configured: false,
    source: null,
    maskedValue: null,
    updatedAt: null
  };
}

export async function fetchClickUpJson<T>(
  path: string,
  params: URLSearchParams,
  apiKey: string
): Promise<T> {
  const query = params.toString();
  const response = await fetch(`${clickUpApiBase()}${path}${query ? `?${query}` : ""}`, {
    headers: {
      Authorization: apiKey,
      Accept: "application/json"
    },
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`ClickUp returned ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function putClickUpJson<T>(path: string, body: unknown, apiKey: string): Promise<T> {
  const response = await fetch(`${clickUpApiBase()}${path}`, {
    method: "PUT",
    headers: {
      Authorization: apiKey,
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    cache: "no-store",
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`ClickUp returned ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Picks the status name to write for a done/not-done toggle.
 *
 * ClickUp status names are per-list ("Complete", "Done", "Closed", ...), so the
 * name cannot be hardcoded; only the `type` is stable. Returns null when the
 * list has no status of the needed type — the caller must then refuse to write
 * rather than guess, because writing the wrong status silently moves a real
 * task into a state the owner did not ask for.
 */
export function pickStatusForDone(statuses: ClickUpStatus[] | undefined, done: boolean): string | null {
  if (!Array.isArray(statuses)) return null;

  const wanted = done ? ["closed", "done"] : ["open"];
  for (const type of wanted) {
    const match = statuses.find(
      (status) => typeof status?.status === "string" && status.status && status.type?.toLowerCase() === type
    );
    if (match?.status) return match.status;
  }

  return null;
}
