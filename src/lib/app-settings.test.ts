import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteStoredClickUpApiKey,
  getStoredClickUpApiKey,
  getStoredClickUpApiKeySummary,
  setStoredClickUpApiKey
} from "@/lib/app-settings";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-settings-")), "dash.sqlite"));
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

describe("ClickUp app setting", () => {
  it("stores the API key without exposing the full value in the summary", () => {
    const db = freshDb();

    const summary = setStoredClickUpApiKey(db, "pk_test_123456789");

    expect(getStoredClickUpApiKey(db)).toBe("pk_test_123456789");
    expect(summary).toMatchObject({
      configured: true,
      maskedValue: "********6789"
    });
    expect(summary.updatedAt).toBeTruthy();
  });

  it("trims, replaces, and clears the stored key", () => {
    const db = freshDb();

    setStoredClickUpApiKey(db, " first ");
    expect(getStoredClickUpApiKey(db)).toBe("first");

    setStoredClickUpApiKey(db, "second");
    expect(getStoredClickUpApiKey(db)).toBe("second");

    const summary = deleteStoredClickUpApiKey(db);
    expect(getStoredClickUpApiKey(db)).toBeNull();
    expect(summary).toEqual({
      configured: false,
      maskedValue: null,
      updatedAt: null
    });
  });

  it("rejects a blank key", () => {
    const db = freshDb();

    expect(() => setStoredClickUpApiKey(db, "   ")).toThrow(/blank/i);
    expect(getStoredClickUpApiKeySummary(db).configured).toBe(false);
  });
});
