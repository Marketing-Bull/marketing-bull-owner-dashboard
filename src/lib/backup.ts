/**
 * Daily database backup.
 *
 * The SQLite file is the only copy of the dashboard's state — and with the
 * consolidation it is about to hold clients, rates, and financial entries.
 * "Whatever is in the working directory of the process" is not a backup story.
 *
 * There is no scheduler in a Next.js server, so this piggybacks on writes: the
 * first save of each local day snapshots the database *before* that save runs,
 * so the snapshot for day N captures the state as day N-1 left it. `VACUUM
 * INTO` produces a consistent, compacted copy while the database is open,
 * without blocking other readers.
 *
 * A backup failure never fails the save — losing today's edit to protect
 * yesterday's copy would be backwards — but it is logged loudly, because a
 * backup that quietly stopped happening is the failure this file exists for.
 */

import { existsSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/** How many daily snapshots survive pruning. Two weeks of history. */
export const BACKUPS_TO_KEEP = 14;

const BACKUP_FILE_PATTERN = /^dashboard-\d{4}-\d{2}-\d{2}\.sqlite$/;

export function backupFileName(day: string): string {
  return `dashboard-${day}.sqlite`;
}

/**
 * Which files to delete, given a directory listing. Pure so the retention rule
 * is testable without a filesystem. Day keys sort lexicographically in date
 * order, so newest-first is a plain string sort. Files that do not match the
 * backup pattern are never touched — this function decides deletions, and
 * deleting something it does not recognise is how a stray file gets destroyed.
 */
export function selectBackupsToPrune(fileNames: string[], keep: number = BACKUPS_TO_KEEP): string[] {
  return fileNames
    .filter((name) => BACKUP_FILE_PATTERN.test(name))
    .sort()
    .reverse()
    .slice(keep);
}

export type BackupResult = {
  created: boolean;
  path?: string;
  pruned: string[];
};

/**
 * Takes the day's snapshot if it does not already exist, then prunes.
 * At most one backup per local day, however many saves happen.
 */
export function ensureDailyBackup(
  db: DatabaseSync,
  directory: string,
  day: string,
  keep: number = BACKUPS_TO_KEEP
): BackupResult {
  const target = join(directory, backupFileName(day));
  if (existsSync(target)) {
    return { created: false, pruned: [] };
  }

  mkdirSync(directory, { recursive: true });
  // VACUUM INTO takes the filename as an SQL expression, so it can be bound
  // as a parameter — no path escaping to get wrong.
  db.prepare("VACUUM INTO ?").run(target);

  const pruned = selectBackupsToPrune(readdirSync(directory), keep);
  for (const name of pruned) {
    unlinkSync(join(directory, name));
  }

  return { created: true, path: target, pruned };
}
