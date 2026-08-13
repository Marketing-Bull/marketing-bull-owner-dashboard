import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLICKUP_TASK_SYNC_STALE_MS,
  deleteCachedClickUpTask,
  ensureClickUpTasksFresh,
  getClickUpTaskSyncInfo,
  isClickUpTaskSyncStale,
  listCachedClickUpTasks,
  replaceCachedClickUpTasks
} from "@/lib/clickup-task-cache";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-clickup-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}

afterEach(() => {
  for (const db of open) {
    try {
      db.close();
    } catch {
      // already closed
    }
  }
  open = [];
});

const task = {
  id: "task-1",
  name: "[P1] Review cached task sync",
  url: "https://app.clickup.com/t/task-1",
  due_date: "1797249600000",
  date_updated: "1797163200000",
  priority: { priority: "high" },
  status: { status: "to do" },
  list: { id: "list-1", name: "Ops" },
  task_type: null
};

describe("ClickUp task cache", () => {
  it("stores tasks and sync metadata in SQLite", () => {
    const db = freshDb();
    const syncedAt = new Date("2026-08-13T12:00:00.000Z");

    expect(isClickUpTaskSyncStale(null, syncedAt)).toBe(true);
    replaceCachedClickUpTasks(db, [task], syncedAt);

    expect(listCachedClickUpTasks(db)).toEqual([task]);
    expect(getClickUpTaskSyncInfo(db, syncedAt)).toEqual({
      lastSyncedAt: "2026-08-13T12:00:00.000Z",
      lastAttemptedAt: "2026-08-13T12:00:00.000Z",
      stale: false,
      refreshed: false,
      error: undefined
    });
  });

  it("skips ClickUp while the cache is under one hour old", async () => {
    const db = freshDb();
    replaceCachedClickUpTasks(db, [task], new Date("2026-08-13T12:00:00.000Z"));
    let calls = 0;

    const result = await ensureClickUpTasksFresh(
      db,
      async () => {
        calls += 1;
        return [];
      },
      new Date("2026-08-13T12:59:59.000Z")
    );

    expect(calls).toBe(0);
    expect(result.tasks).toHaveLength(1);
    expect(result.sync.refreshed).toBe(false);
    expect(result.sync.stale).toBe(false);
  });

  it("refreshes stale cache and replaces old rows", async () => {
    const db = freshDb();
    replaceCachedClickUpTasks(db, [task], new Date("2026-08-13T12:00:00.000Z"));

    const result = await ensureClickUpTasksFresh(
      db,
      async () => [{ ...task, id: "task-2", name: "[P0] Fresh task" }],
      new Date(Date.parse("2026-08-13T12:00:00.000Z") + CLICKUP_TASK_SYNC_STALE_MS + 1)
    );

    expect(result.error).toBeNull();
    expect(result.sync.refreshed).toBe(true);
    expect(result.sync.stale).toBe(false);
    expect(result.tasks.map((entry) => entry.id)).toEqual(["task-2"]);
  });

  it("records refresh errors while keeping stale cached tasks", async () => {
    const db = freshDb();
    replaceCachedClickUpTasks(db, [task], new Date("2026-08-13T12:00:00.000Z"));

    const result = await ensureClickUpTasksFresh(
      db,
      async () => {
        throw new Error("ClickUp returned 500");
      },
      new Date("2026-08-13T14:00:00.000Z")
    );

    expect(result.error).toBe("ClickUp returned 500");
    expect(result.hadCache).toBe(true);
    expect(result.tasks.map((entry) => entry.id)).toEqual(["task-1"]);
    expect(result.sync).toMatchObject({
      lastSyncedAt: "2026-08-13T12:00:00.000Z",
      lastAttemptedAt: "2026-08-13T14:00:00.000Z",
      stale: true,
      refreshed: false,
      error: "ClickUp returned 500"
    });
  });

  it("can remove a cached task after ClickUp marks it done", () => {
    const db = freshDb();
    replaceCachedClickUpTasks(db, [task], new Date("2026-08-13T12:00:00.000Z"));

    deleteCachedClickUpTask(db, task.id);

    expect(listCachedClickUpTasks(db)).toEqual([]);
  });
});
