import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { replaceCachedClickUpTasks, type ClickUpTaskCacheInput } from "@/lib/clickup-task-cache";
import { parseClickUpTaskQuery, queryClickUpTasks } from "@/lib/clickup-tasks";
import { createClient, createProject } from "@/lib/entities";
import { runMigrations } from "@/lib/migrations";
import { DASHBOARD_MIGRATIONS } from "@/lib/schema";

let open: DatabaseSync[] = [];
function freshDb(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "owner-dash-tasks-")), "dash.sqlite"));
  runMigrations(db, DASHBOARD_MIGRATIONS);
  open.push(db);
  return db;
}
afterEach(() => { for (const db of open) try { db.close(); } catch {} open = []; });

const NOW = new Date(2026, 7, 13, 9, 0, 0);
function day(offsetDays: number, hour = 12): string {
  return String(new Date(2026, 7, 13 + offsetDays, hour, 0, 0).getTime());
}

function task(overrides: Partial<ClickUpTaskCacheInput> & { id: string; name: string }): ClickUpTaskCacheInput {
  return {
    url: `https://app.clickup.com/t/${overrides.id}`,
    date_updated: day(-1),
    status: { status: "in progress" },
    list: { id: "list-1", name: "Website" },
    space: { id: "space-1", name: "Delivery" },
    ...overrides
  };
}

function seed(db: DatabaseSync): void {
  const client = createClient(db, { name: "Acme" });
  createProject(db, { name: "Website", clientId: client.id });
  replaceCachedClickUpTasks(db, [
    task({ id: "1", name: "Ship the landing page", due_date: day(-2), priority: { priority: "urgent" } }),
    task({ id: "2", name: "Draft the invoice email", due_date: day(1), priority: { priority: "normal" }, list: { id: "list-2", name: "Finance" }, space: { id: "space-2", name: "Admin" }, status: { status: "to do" } }),
    task({ id: "3", name: "Renew the domain", due_date: day(20), priority: { priority: "low" }, list: { id: "list-2", name: "Finance" }, space: { id: "space-2", name: "Admin" } }),
    task({ id: "4", name: "Think about Q4 offer", due_date: null, list: { id: "list-2", name: "Finance" }, space: { id: "space-2", name: "Admin" } })
  ], NOW);
}

function query(search: string, now: Date = NOW) {
  return queryClickUpTasks(freshDbWithSeed(), parseClickUpTaskQuery(new URLSearchParams(search)), now);
}

let shared: DatabaseSync | null = null;
function freshDbWithSeed(): DatabaseSync {
  if (!shared) { shared = freshDb(); seed(shared); }
  return shared;
}
afterEach(() => { shared = null; });

describe("clickup task ledger", () => {
  it("sorts by due date and keeps undated tasks last in both directions", () => {
    expect(query("sort=due&direction=asc").items.map((item) => item.id)).toEqual(["1", "2", "3", "4"]);
    expect(query("sort=due&direction=desc").items.map((item) => item.id)).toEqual(["3", "2", "1", "4"]);
  });

  it("sorts by ClickUp's priority order, not alphabetically", () => {
    expect(query("sort=priority&direction=asc").items.map((item) => item.priority)).toEqual(["urgent", "normal", "low", null]);
  });

  it("filters by text, status, list, space, and priority including none", () => {
    expect(query("search=invoice").items.map((item) => item.id)).toEqual(["2"]);
    expect(query("status=to do").items.map((item) => item.id)).toEqual(["2"]);
    expect(query("listId=list-2&direction=asc").items.map((item) => item.id)).toEqual(["2", "3", "4"]);
    expect(query("spaceId=space-1").items.map((item) => item.id)).toEqual(["1"]);
    expect(query("priority=none").items.map((item) => item.id)).toEqual(["4"]);
    expect(query("priority=urgent,low&direction=asc").items.map((item) => item.id)).toEqual(["1", "3"]);
  });

  it("filters by due window, overdue, and the absence of a due date", () => {
    expect(query("overdue=true").items.map((item) => item.id)).toEqual(["1"]);
    expect(query("hasDueDate=false").items.map((item) => item.id)).toEqual(["4"]);
    expect(query("dueFrom=2026-08-13&dueTo=2026-08-14").items.map((item) => item.id)).toEqual(["2"]);
  });

  it("matches tasks to a local project by list name and filters on it", () => {
    const result = query("projectId=" + query("").items.find((item) => item.id === "1")!.projectId);
    expect(result.items.map((item) => item.id)).toEqual(["1"]);
    expect(query("assignment=unassigned&direction=asc").items.map((item) => item.id)).toEqual(["2", "3", "4"]);
  });

  it("reports filtered totals and facets for the same predicate", () => {
    const all = query("");
    expect(all.filteredTotals).toEqual({ tasks: 4, overdue: 1, dueSoon: 1, unassigned: 3 });
    expect(all.availableFacets.lists).toEqual([
      { id: "list-2", name: "Finance", count: 3 },
      { id: "list-1", name: "Website", count: 1 }
    ]);
    expect(all.availableFacets.priorities.map((facet) => facet.value).sort()).toEqual(["low", "none", "normal", "urgent"]);

    const scoped = query("listId=list-2");
    expect(scoped.filteredTotals).toEqual({ tasks: 3, overdue: 0, dueSoon: 1, unassigned: 3 });
  });

  it("pages without duplicates or gaps", () => {
    const first = query("pageSize=2&page=1&sort=due&direction=asc");
    const second = query("pageSize=2&page=2&sort=due&direction=asc");
    expect(first.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(second.items.map((item) => item.id)).toEqual(["3", "4"]);
    expect(first.pageInfo).toMatchObject({ totalItems: 4, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    expect(second.pageInfo).toMatchObject({ hasNextPage: false, hasPreviousPage: true });
  });

  it("rejects filters it cannot honour instead of ignoring them", () => {
    expect(() => parseClickUpTaskQuery(new URLSearchParams("priority=blocker"))).toThrow(/priority must be one of/i);
    expect(() => parseClickUpTaskQuery(new URLSearchParams("sort=vibes"))).toThrow(/one of/i);
    expect(() => parseClickUpTaskQuery(new URLSearchParams("dueFrom=2026-08-20&dueTo=2026-08-01"))).toThrow(/minimum/i);
    expect(() => parseClickUpTaskQuery(new URLSearchParams("overdue=maybe"))).toThrow(/true or false/i);
  });
});
