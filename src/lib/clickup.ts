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

type SecretsFile = {
  env?: {
    CLICKUP_API_KEY?: string;
  };
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

export async function getClickUpApiKey(): Promise<string | null> {
  const raw = await readFile(join(homedir(), ".openclaw", "secrets.json"), "utf8");
  const secrets = JSON.parse(raw) as SecretsFile;
  return secrets.env?.CLICKUP_API_KEY?.trim() || null;
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
