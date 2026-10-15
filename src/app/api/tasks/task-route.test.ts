import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { replaceCachedClickUpTasks } from "@/lib/clickup-task-cache";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

/**
 * The task toggle writes to ClickUp with the owner's API key, so the cases that
 * matter are the ones that must make no request at all.
 */

const clickup = vi.hoisted(() => ({
  fetchClickUpJson: vi.fn(),
  putClickUpJson: vi.fn(),
  getClickUpApiKey: vi.fn()
}));

let db: DatabaseSync;
vi.mock("@/lib/dashboard-state", () => ({ getDatabase: () => db }));
vi.mock("@/lib/clickup", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clickup")>()),
  ...clickup
}));

import { PATCH } from "@/app/api/tasks/[taskId]/route";

function call(taskId: string, body: unknown) {
  return PATCH(
    new Request(`http://localhost/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      body: JSON.stringify(body)
    }),
    { params: Promise.resolve({ taskId }) }
  );
}

beforeEach(() => {
  db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-task-route-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  replaceCachedClickUpTasks(db, [
    { id: "868abc", name: "Real task", list: { id: "901113884029", name: "Clients" } },
    { id: "868nolist", name: "No list" }
  ]);
  clickup.getClickUpApiKey.mockResolvedValue("key");
  clickup.fetchClickUpJson.mockResolvedValue({ name: "Clients", statuses: [{ status: "Complete", type: "closed" }] });
  clickup.putClickUpJson.mockResolvedValue({});
});

afterEach(() => {
  vi.clearAllMocks();
  db.close();
});

describe("PATCH /api/tasks/:taskId", () => {
  it("refuses an id that could climb out of the task path, without calling ClickUp", async () => {
    const response = await call("abc/../../space/999", { done: true, listId: "123/../../../team?x=" });
    expect(response.status).toBe(400);
    expect(clickup.fetchClickUpJson).not.toHaveBeenCalled();
    expect(clickup.putClickUpJson).not.toHaveBeenCalled();
  });

  it("ignores a listId in the body and uses the one ClickUp gave the cached task", async () => {
    const response = await call("868abc", { done: true, listId: "123/../../../team?x=" });
    expect(response.status).toBe(200);
    expect(clickup.fetchClickUpJson.mock.calls[0][0]).toBe("/list/901113884029");
    expect(clickup.putClickUpJson.mock.calls[0][0]).toBe("/task/868abc");
    expect(clickup.putClickUpJson.mock.calls[0][1]).toEqual({ status: "Complete" });
  });

  it("will not act on a task this app hasn't synced", async () => {
    const response = await call("868other", { done: true });
    expect(response.status).toBe(404);
    expect(clickup.putClickUpJson).not.toHaveBeenCalled();
  });

  it("reports a cached task with no list instead of guessing one", async () => {
    const response = await call("868nolist", { done: true });
    expect(response.status).toBe(400);
    expect(clickup.putClickUpJson).not.toHaveBeenCalled();
  });
});
