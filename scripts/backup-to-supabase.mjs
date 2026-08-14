#!/usr/bin/env node

/**
 * Pushes the dashboard's SQLite database to the Supabase mirror.
 *
 * Run it on the machine that holds the real database (amb-ubuntu-01). SQLite
 * stays the system of record; this is a copy that survives that machine, since
 * the daily `VACUUM INTO` snapshots sit on the same disk as the database they
 * protect.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   npm run backup:supabase
 *
 * `--dry-run` reads and counts everything, prints what it would send, and
 * writes nothing.
 *
 * Three properties worth keeping if this is ever edited:
 *
 * 1. Secrets are allowlisted, not denylisted. `app_settings` holds the ClickUp
 *    and maps API keys; only keys named in SAFE_SETTING_KEYS are sent, so a
 *    credential added by a future feature is excluded by default rather than
 *    shipped to a third party by accident.
 *
 * 2. Deletions propagate, but only after a table fully succeeds. Every row in a
 *    run is stamped with the same `synced_at`; rows in the mirror older than
 *    that stamp were not in the source any more and are removed. A partial
 *    failure skips the delete, so a network blip can never empty a table.
 *
 * 3. An unknown column fails the run loudly. PostgREST rejects columns the
 *    mirror does not have, which is the correct outcome: a migration landed
 *    locally and `supabase/owner-dashboard-mirror.sql` has not caught up, and
 *    a backup silently missing a column is worse than one that stops.
 */

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { hostname } from "node:os";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SCHEMA = process.env.SUPABASE_MIRROR_SCHEMA || "owner_dashboard";
const DB_PATH = process.env.OWNER_DASHBOARD_DB_PATH || "data/dashboard.sqlite";
const DRY_RUN = process.argv.includes("--dry-run");

/** Rows per request. Small enough to keep a failed batch cheap to retry. */
const BATCH_SIZE = 500;

/** The only `app_settings` keys allowed to leave the machine. */
const SAFE_SETTING_KEYS = ["mileage.rate"];

/**
 * What gets mirrored. Caches are absent on purpose: `clickup_tasks`,
 * `clickup_sync_state`, and `mileage_route_cache` are rebuilt from their
 * upstreams and carrying them would be copying noise off-site.
 */
const TABLES = [
  { name: "clients", conflict: "id", booleans: ["is_archived"] },
  { name: "projects", conflict: "id", booleans: ["urgent", "important", "is_archived"] },
  { name: "time_entries", conflict: "id", booleans: ["billable"] },
  { name: "expenses", conflict: "id", booleans: ["billable", "reimbursable"] },
  { name: "recurring_expenses", conflict: "id", booleans: [] },
  { name: "mileage_entries", conflict: "id", booleans: ["round_trip", "billable"] },
  { name: "chart_accounts", conflict: "account_code", booleans: ["is_income"] },
  { name: "expense_category_accounts", conflict: "category", booleans: [] },
  { name: "dashboard_state", conflict: "id", booleans: [] },
  { name: "daily_history", conflict: "day", booleans: [] },
  { name: "phone_calls", conflict: "id", booleans: ["checked"] },
  { name: "schema_migrations", conflict: "id", booleans: [] },
  {
    name: "app_settings",
    conflict: "key",
    booleans: [],
    // Allowlist, applied in SQL so a secret is never even read into memory.
    where: `key IN (${SAFE_SETTING_KEYS.map((key) => `'${key}'`).join(", ")})`
  }
];

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function request(path, { method = "GET", body, prefer } = {}) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Accept-Profile": SCHEMA,
    "Content-Profile": SCHEMA
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;

  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function errorText(response) {
  const raw = await response.text().catch(() => "");
  if (!raw) return `${response.status} ${response.statusText}`;

  // PGRST106: the schema exists but PostgREST is not allowed to see it. That is
  // a one-line settings change, so say so rather than printing a bare 406.
  if (raw.includes("PGRST106")) {
    return (
      `Supabase will not serve the "${SCHEMA}" schema over its API yet.\n` +
      `  Add it in Dashboard → Project Settings → API → Exposed schemas, then re-run.\n` +
      `  Raw response: ${raw}`
    );
  }
  return `${response.status} ${response.statusText} — ${raw}`;
}

/** SQLite has no booleans; the mirror does. Everything else passes through. */
function toRow(row, booleans, stamp) {
  const out = { ...row, synced_at: stamp };
  for (const column of booleans) {
    if (out[column] !== null && out[column] !== undefined) out[column] = Boolean(out[column]);
  }
  return out;
}

async function main() {
  if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
    fail(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set.\n" +
        "  The service-role key is a full-access credential: keep it in the systemd unit\n" +
        "  or a root-owned env file, never in the repo."
    );
  }
  if (!existsSync(DB_PATH)) {
    fail(`No database at ${DB_PATH}. Set OWNER_DASHBOARD_DB_PATH if it lives elsewhere.`);
  }

  const startedAt = new Date().toISOString();
  const stamp = startedAt;
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  const counts = {};

  console.log(`\nOwner dashboard → Supabase mirror`);
  console.log(`  source   ${DB_PATH} on ${hostname()}`);
  console.log(`  target   ${DRY_RUN ? "(dry run — nothing will be written)" : `${SUPABASE_URL} · schema ${SCHEMA}`}`);
  console.log("");

  if (!DRY_RUN) {
    const probe = await request("sync_runs?select=id&limit=1");
    if (!probe.ok) fail(await errorText(probe));
  }

  try {
    for (const table of TABLES) {
      const where = table.where ? ` WHERE ${table.where}` : "";
      const rows = db.prepare(`SELECT * FROM ${table.name}${where}`).all();
      counts[table.name] = rows.length;

      if (DRY_RUN) {
        console.log(`  ${table.name.padEnd(26)} ${String(rows.length).padStart(6)} rows`);
        continue;
      }

      for (let index = 0; index < rows.length; index += BATCH_SIZE) {
        const batch = rows.slice(index, index + BATCH_SIZE).map((row) => toRow(row, table.booleans, stamp));
        const response = await request(`${table.name}?on_conflict=${table.conflict}`, {
          method: "POST",
          body: batch,
          prefer: "resolution=merge-duplicates,return=minimal"
        });
        if (!response.ok) throw new Error(`${table.name}: ${await errorText(response)}`);
      }

      // Only now, with every batch for this table accepted, is it safe to say
      // that anything older than this run's stamp is gone from the source.
      const pruned = await request(`${table.name}?synced_at=lt.${encodeURIComponent(stamp)}`, {
        method: "DELETE",
        prefer: "return=representation"
      });
      if (!pruned.ok) throw new Error(`${table.name} prune: ${await errorText(pruned)}`);
      const removed = (await pruned.json().catch(() => [])).length;

      console.log(
        `  ${table.name.padEnd(26)} ${String(rows.length).padStart(6)} rows${removed ? ` · ${removed} removed` : ""}`
      );
    }

    if (!DRY_RUN) {
      await request("sync_runs", {
        method: "POST",
        body: [
          {
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            source_host: hostname(),
            status: "success",
            row_counts: counts
          }
        ],
        prefer: "return=minimal"
      });
    }

    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    console.log(`\n✓ ${total.toLocaleString()} rows ${DRY_RUN ? "would be mirrored" : "mirrored"}.`);
    console.log(
      "  Receipt files are not included — they live beside the database and need their own copy.\n"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!DRY_RUN) {
      await request("sync_runs", {
        method: "POST",
        body: [
          {
            started_at: startedAt,
            finished_at: new Date().toISOString(),
            source_host: hostname(),
            status: "failed",
            row_counts: counts,
            error: message.slice(0, 2000)
          }
        ],
        prefer: "return=minimal"
      }).catch(() => {});
    }
    fail(message);
  } finally {
    db.close();
  }
}

await main();
