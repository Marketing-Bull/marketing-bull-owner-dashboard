import Link from "next/link";
import { allowUnprotected, isAuthConfigured } from "@/lib/auth";
import { getAppVersion } from "@/lib/app-version";
import { getClickUpCredentialStatus } from "@/lib/clickup";
import styles from "../entities.module.css";
import { ClickUpSettingsCard } from "./clickup-settings-card";

// Protection state is runtime environment, never build-time.
export const dynamic = "force-dynamic";

/**
 * The system screen: what this deployment is, how it is protected, and where
 * its data lives. Read-only on purpose — every value here changes through env
 * or the documented runbooks, and a settings form that silently rewrites env
 * would be a lie about where configuration actually lives.
 */
export default async function SettingsPage() {
  const authConfigured = isAuthConfigured();
  const runningOpen = !authConfigured && allowUnprotected();
  const clickUpStatus = await getClickUpCredentialStatus();

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / System</p>
            <h1 className={styles.title}>Settings</h1>
          </div>
          <span className={styles.statusChip}>{getAppVersion()}</span>
        </header>

        <section className={styles.card}>
          <div className={styles.rowHead}>
            <div>
              <div className={styles.rowTitle}>Protection</div>
              <div className={styles.rowMeta}>
                {authConfigured
                  ? "Token gate is on: every page and API request needs the token."
                  : runningOpen
                    ? "Running open by explicit choice (OWNER_DASHBOARD_ALLOW_UNPROTECTED in the committed .env). Anyone who can reach this address can read and edit everything."
                    : "Locked: no token configured and no opt-out. Only the setup screen is served."}
              </div>
            </div>
            <span className={`${styles.statusChip} ${authConfigured ? styles.statusActive : ""}`}>
              {authConfigured ? "protected" : runningOpen ? "open" : "locked"}
            </span>
          </div>
          {!authConfigured ? (
            <p className={styles.empty}>
              To lock: set OWNER_DASHBOARD_AUTH_TOKEN (generate with `openssl rand -base64 32`) in
              .env.local or the systemd unit and restart — a configured token always beats the
              opt-out.
            </p>
          ) : null}
        </section>

        <ClickUpSettingsCard initialStatus={clickUpStatus} />

        <section className={styles.card}>
          <div className={styles.rowTitle}>Data</div>
          <p className={styles.empty}>
            SQLite at `data/dashboard.sqlite` under the app&apos;s working directory (or
            OWNER_DASHBOARD_DB_PATH). Migrations run automatically on open; the first save of each
            day snapshots the database to `data/backups/`, newest 14 kept. Restore = stop, copy a
            snapshot over the file, start.
          </p>
          <p className={styles.empty}>
            Clients and projects were imported from mission-control and are seeded on first boot;
            `POST /api/admin/import-mission-control` re-converges from a fresher MC copy (requires
            the token gate to be on).
          </p>
        </section>

        <section className={styles.card}>
          <div className={styles.rowTitle}>Consolidation</div>
          <p className={styles.empty}>
            Phases 0–2 done: foundation, then Clients + Projects as owned entities. Next: Time
            (phase 3), Expenses and Mileage (phase 4), Calendar views (phase 5), Eisenhower and
            derived MRR (phase 6). The full plan of record:
          </p>
          <p className={styles.empty}>
            <Link href="/scope" className={styles.buttonQuiet}>
              Dashboard Consolidation Scope →
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}
