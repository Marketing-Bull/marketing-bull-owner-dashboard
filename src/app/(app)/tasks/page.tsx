"use client";

/**
 * Tasks — the ClickUp work queue, read the way the transaction ledgers are read.
 *
 * Same shape as Time, Expenses, and Mileage: compact header with filtered
 * totals, sticky filter bar with active-filter chips, sortable server-paged
 * table that becomes two-line rows on a phone, and a right-side sheet for one
 * record. The differences are the ones the data forces. ClickUp owns these
 * rows, so there is no Add and no Delete; the screen adds an explicit Sync,
 * says when the cache was last refreshed, and offers the one write this
 * dashboard supports — marking a task complete.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, ListTodo, RefreshCw, Search } from "lucide-react";
import { DataTable, type LedgerColumn } from "@/components/transactions/data-table";
import { FilterBar, FilterField, type ActiveFilter } from "@/components/transactions/filter-bar";
import { RecordSheet } from "@/components/transactions/record-sheet";
import { TransactionPage, TransactionPageHeader } from "@/components/transactions/transaction-page";
import styles from "@/components/transactions/transaction-ledger.module.css";
import type { ClickUpTaskRecord, Client, Project } from "@/lib/types";

type Direction = "asc" | "desc";
type TaskSort = "due" | "name" | "priority" | "status" | "list" | "space" | "client" | "project" | "updated";

type TaskFilters = {
  page: number; pageSize: number; sort: TaskSort; direction: Direction;
  search: string; status: string; priority: string; listId: string; spaceId: string;
  clientId: string; projectId: string; assignment: string; taskType: string;
  dueFrom: string; dueTo: string; hasDueDate: string; overdue: string;
  updatedFrom: string; updatedTo: string; id: string; name: string;
};

type PageInfo = { page: number; pageSize: number; totalItems: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
type Totals = { tasks: number; overdue: number; dueSoon: number; unassigned: number };
type GroupFacet = { id: string; name: string; count: number };
type Facets = {
  statuses: Array<{ value: string; count: number }>;
  priorities: Array<{ value: string; count: number }>;
  taskTypes: Array<{ value: string; count: number }>;
  lists: GroupFacet[];
  spaces: GroupFacet[];
};
type SyncInfo = { lastSyncedAt: string | null; lastAttemptedAt: string | null; stale: boolean; refreshed: boolean; error?: string };

const DEFAULT_FILTERS: TaskFilters = {
  page: 1, pageSize: 50, sort: "due", direction: "asc",
  search: "", status: "", priority: "", listId: "", spaceId: "", clientId: "", projectId: "",
  assignment: "", taskType: "", dueFrom: "", dueTo: "", hasDueDate: "", overdue: "",
  updatedFrom: "", updatedTo: "", id: "", name: ""
};
const FILTER_KEYS = Object.keys(DEFAULT_FILTERS) as Array<keyof TaskFilters>;
const EMPTY_PAGE: PageInfo = { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false };
const EMPTY_TOTALS: Totals = { tasks: 0, overdue: 0, dueSoon: 0, unassigned: 0 };
const EMPTY_FACETS: Facets = { statuses: [], priorities: [], taskTypes: [], lists: [], spaces: [] };
const PRIORITY_LABELS: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low", none: "No priority" };
const ASSOCIATION_LABELS: Record<string, string> = {
  "project-custom-field": "matched by ClickUp Project field",
  "project-tag": "matched by project tag",
  "project-list": "matched by list name",
  "client-custom-field": "matched by ClickUp Client field",
  "client-tag": "matched by client tag",
  "client-folder": "matched by folder name",
  "client-space": "matched by space name",
  none: "not matched to a client or project"
};

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return true;
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return debounced;
}

function filtersFromUrl(): TaskFilters {
  const params = new URLSearchParams(window.location.search);
  const result = { ...DEFAULT_FILTERS };
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value === null) continue;
    if (key === "page" || key === "pageSize") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) result[key] = parsed;
    } else (result[key] as string) = value;
  }
  const saved = Number(window.localStorage.getItem("transaction-ledger.tasks.page-size"));
  if (!params.has("pageSize") && [25, 50, 100].includes(saved)) result.pageSize = saved;
  return result;
}

function queryString(filters: TaskFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === "" || value === DEFAULT_FILTERS[key]) continue;
    params.set(key, String(value));
  }
  params.set("page", String(filters.page)); params.set("pageSize", String(filters.pageSize));
  params.set("sort", filters.sort); params.set("direction", filters.direction);
  return params.toString();
}

function startOfToday(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

function dueLabel(dueDate: number | null): { text: string; overdue: boolean; today: boolean } {
  if (dueDate === null) return { text: "No due date", overdue: false, today: false };
  const due = new Date(dueDate);
  if (!Number.isFinite(due.getTime())) return { text: "No due date", overdue: false, today: false };
  const dayStart = startOfToday();
  const days = Math.floor((new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime() - dayStart) / 86_400_000);
  const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(due);
  const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(due.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) }).format(due);
  if (days === 0) return { text: `Today ${time}`, overdue: dueDate < Date.now(), today: true };
  if (days === 1) return { text: "Tomorrow", overdue: false, today: false };
  if (days === -1) return { text: "Yesterday", overdue: true, today: false };
  return { text: date, overdue: days < 0, today: false };
}

function relativeTime(value: string | null): string {
  if (!value) return "never";
  const then = Date.parse(value);
  if (!Number.isFinite(then)) return "never";
  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function priorityLabel(priority: string | null): string {
  return PRIORITY_LABELS[(priority || "none").toLowerCase()] ?? priority ?? "No priority";
}

export default function TasksPage() {
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [tasks, setTasks] = useState<ClickUpTaskRecord[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>(EMPTY_PAGE);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [facets, setFacets] = useState<Facets>(EMPTY_FACETS);
  const [sync, setSync] = useState<SyncInfo | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [openTask, setOpenTask] = useState<ClickUpTaskRecord | null>(null);
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const debouncedName = useDebouncedValue(filters.name, 300);
  const debouncedTaskType = useDebouncedValue(filters.taskType, 300);
  const requestQuery = queryString({ ...filters, search: debouncedSearch, name: debouncedName, taskType: debouncedTaskType });

  const patchFilters = useCallback((patch: Partial<TaskFilters>, keepPage = false) => {
    setFilters((current) => ({ ...current, ...patch, page: keepPage && patch.page !== undefined ? patch.page : 1 }));
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { setFilters(filtersFromUrl()); setReady(true); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${queryString(filters)}`);
    window.localStorage.setItem("transaction-ledger.tasks.page-size", String(filters.pageSize));
  }, [filters, ready]);

  useEffect(() => {
    void (async () => {
      try {
        const [clientResponse, projectResponse] = await Promise.all([
          fetch("/api/clients?includeArchived=1", { cache: "no-store" }),
          fetch("/api/projects?includeArchived=1", { cache: "no-store" })
        ]);
        if (redirectedToLogin(clientResponse) || redirectedToLogin(projectResponse)) return;
        const [clientJson, projectJson] = await Promise.all([clientResponse.json(), projectResponse.json()]);
        if (!clientResponse.ok || !projectResponse.ok) throw new Error("Client/project fetch failed");
        setClients(Array.isArray(clientJson?.clients) ? clientJson.clients : []);
        setProjects(Array.isArray(projectJson?.projects) ? projectJson.projects : []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    })();
  }, []);

  const applyResult = useCallback((json: Record<string, unknown>) => {
    setTasks(Array.isArray(json?.items) ? (json.items as ClickUpTaskRecord[]) : []);
    setPageInfo((json?.pageInfo as PageInfo) ?? EMPTY_PAGE);
    setTotals((json?.filteredTotals as Totals) ?? EMPTY_TOTALS);
    setFacets((json?.availableFacets as Facets) ?? EMPTY_FACETS);
    setSync((json?.sync as SyncInfo) ?? null);
  }, []);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks?${requestQuery}`, { cache: "no-store", signal });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Task fetch failed");
      applyResult(json);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [applyResult, ready, requestQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadTasks(controller.signal), 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadTasks]);

  async function syncNow() {
    setBusy(true); setError(null); setNotice("");
    try {
      const response = await fetch(`/api/tasks?${requestQuery}`, { method: "POST", cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Sync failed");
      applyResult(json);
      setNotice(typeof json?.syncError === "string" && json.syncError ? "" : "Synced with ClickUp.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function markComplete(task: ClickUpTaskRecord) {
    setBusy(true); setError(null); setNotice("");
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: true, listId: task.listId })
      });
      if (redirectedToLogin(response)) return;
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || `Could not complete “${task.name}” in ClickUp.`);
      setNotice(`“${task.name}” marked ${json?.status || "complete"} in ClickUp.`);
      setOpenTask(null);
      await loadTasks();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const activeProjects = useMemo(() => projects.filter((project) => !filters.clientId || project.clientId === filters.clientId), [projects, filters.clientId]);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const result: ActiveFilter[] = [];
    const add = (id: keyof TaskFilters, label: string) => {
      if (!filters[id] || filters[id] === DEFAULT_FILTERS[id]) return;
      result.push({ id, label, onRemove: () => patchFilters({ [id]: DEFAULT_FILTERS[id] }) });
    };
    add("search", `Search: ${filters.search}`);
    add("status", `Status: ${filters.status}`);
    add("priority", `Priority: ${priorityLabel(filters.priority)}`);
    add("listId", `List: ${facets.lists.find((list) => list.id === filters.listId)?.name ?? filters.listId}`);
    add("spaceId", `Space: ${facets.spaces.find((space) => space.id === filters.spaceId)?.name ?? filters.spaceId}`);
    add("clientId", `Client: ${clientNames.get(filters.clientId) ?? filters.clientId}`);
    add("projectId", `Project: ${projectNames.get(filters.projectId) ?? filters.projectId}`);
    add("assignment", filters.assignment === "assigned" ? "Assigned to a client or project" : "Unassigned");
    add("taskType", `Type: ${filters.taskType}`);
    add("dueFrom", `Due from: ${filters.dueFrom}`);
    add("dueTo", `Due to: ${filters.dueTo}`);
    add("hasDueDate", filters.hasDueDate === "true" ? "Has a due date" : "No due date");
    add("overdue", filters.overdue === "true" ? "Overdue" : "Not overdue");
    add("updatedFrom", `Updated from: ${filters.updatedFrom}`);
    add("updatedTo", `Updated to: ${filters.updatedTo}`);
    add("id", `Task ID: ${filters.id}`);
    add("name", `Name: ${filters.name}`);
    return result;
  }, [filters, facets.lists, facets.spaces, clientNames, projectNames, patchFilters]);

  const columns: LedgerColumn<ClickUpTaskRecord, TaskSort>[] = [
    { id: "name", label: "Task", sort: "name", className: styles.detailsCell, render: (task) => (
      <>
        <button type="button" className={styles.linkCell} onClick={() => setOpenTask(task)}>{task.name}</button>
        <span className={styles.secondaryText}>{[task.listName, task.spaceName].filter(Boolean).join(" · ") || "No list"}</span>
      </>
    ) },
    { id: "status", label: "Status", sort: "status", render: (task) => task.status ? <span className={styles.status}>{task.status}</span> : <span className={styles.secondaryText}>—</span> },
    { id: "priority", label: "Priority", sort: "priority", render: (task) => (
      <span className={`${styles.status} ${(task.priority || "").toLowerCase() === "urgent" || (task.priority || "").toLowerCase() === "high" ? styles.statusUrgent : ""}`}>{priorityLabel(task.priority)}</span>
    ) },
    { id: "due", label: "Due", sort: "due", render: (task) => {
      const due = dueLabel(task.dueDate);
      return <span className={due.overdue ? styles.overdueText : due.today ? styles.primaryCell : undefined}>{due.text}</span>;
    } },
    { id: "assignment", label: "Client / project", render: (task) => task.projectName || task.clientName || <span className={styles.secondaryText}>Unassigned</span> },
    { id: "updated", label: "Updated", sort: "updated", render: (task) => <span className={styles.secondaryText}>{task.updatedAt ? relativeTime(new Date(task.updatedAt).toISOString()) : "—"}</span> },
    { id: "actions", label: "Actions", align: "right", render: (task) => (
      <div className={styles.rowActions}>
        {task.url ? <a className={styles.iconButton} href={task.url} target="_blank" rel="noreferrer" aria-label={`Open ${task.name} in ClickUp`}><ExternalLink size={15} /></a> : null}
        <button type="button" className={styles.iconButton} disabled={busy || !task.listId} onClick={() => void markComplete(task)} aria-label={`Mark ${task.name} complete in ClickUp`}><CheckCircle2 size={15} /></button>
      </div>
    ) }
  ];

  const hasAnyRecords = pageInfo.totalItems > 0 || activeFilters.length === 0;

  return (
    <TransactionPage>
      <TransactionPageHeader
        title="Tasks"
        metrics={[
          { label: "filtered tasks", value: pageInfo.totalItems },
          { label: "overdue", value: totals.overdue }
        ]}
        action={<button type="button" className={styles.primaryButton} disabled={busy || loading} onClick={() => void syncNow()}><RefreshCw size={16} /> {busy ? "Syncing…" : "Sync ClickUp"}</button>}
      />

      <p className={styles.sourceNote}>
        Open tasks assigned to the configured ClickUp user. Last synced {relativeTime(sync?.lastSyncedAt ?? null)}
        {sync?.stale ? " · cache is stale" : ""}. Editing happens in ClickUp; this screen can mark a task complete.
      </p>

      <FilterBar
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
        activeFilters={activeFilters}
        onClear={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))}
        advanced={<>
          <div className={styles.filterMobileOnly}>
            <FilterField label="Status"><select className={styles.select} value={filters.status} onChange={(event) => patchFilters({ status: event.target.value })}><option value="">All statuses</option>{facets.statuses.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></FilterField>
          </div>
          <div className={styles.filterTabletOnly}>
            <FilterField label="Priority"><select className={styles.select} value={filters.priority} onChange={(event) => patchFilters({ priority: event.target.value })}><option value="">Any priority</option>{["urgent", "high", "normal", "low", "none"].map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}</select></FilterField>
          </div>
          <div className={styles.filterTabletOnly}>
            <FilterField label="List"><select className={styles.select} value={filters.listId} onChange={(event) => patchFilters({ listId: event.target.value })}><option value="">All lists</option>{facets.lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.count})</option>)}</select></FilterField>
          </div>
          <FilterField label="Space"><select className={styles.select} value={filters.spaceId} onChange={(event) => patchFilters({ spaceId: event.target.value })}><option value="">All spaces</option>{facets.spaces.map((space) => <option key={space.id} value={space.id}>{space.name} ({space.count})</option>)}</select></FilterField>
          <FilterField label="Client"><select className={styles.select} value={filters.clientId} onChange={(event) => patchFilters({ clientId: event.target.value, projectId: "" })}><option value="">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></FilterField>
          <FilterField label="Project"><select className={styles.select} value={filters.projectId} onChange={(event) => patchFilters({ projectId: event.target.value })}><option value="">All projects</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FilterField>
          <FilterField label="Assignment"><select className={styles.select} value={filters.assignment} onChange={(event) => patchFilters({ assignment: event.target.value })}><option value="">Any</option><option value="assigned">Client or project</option><option value="unassigned">Unassigned</option></select></FilterField>
          <FilterField label="Task type"><input className={styles.input} list="task-types" value={filters.taskType} onChange={(event) => patchFilters({ taskType: event.target.value })} /><datalist id="task-types">{facets.taskTypes.map((item) => <option key={item.value} value={item.value} />)}</datalist></FilterField>
          <FilterField label="Has due date"><select className={styles.select} value={filters.hasDueDate} onChange={(event) => patchFilters({ hasDueDate: event.target.value })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></FilterField>
          <FilterField label="Overdue"><select className={styles.select} value={filters.overdue} onChange={(event) => patchFilters({ overdue: event.target.value })}><option value="">Any</option><option value="true">Overdue only</option><option value="false">Not overdue</option></select></FilterField>
          <FilterField label="Updated from"><input className={styles.input} type="date" value={filters.updatedFrom} onChange={(event) => patchFilters({ updatedFrom: event.target.value })} /></FilterField>
          <FilterField label="Updated to"><input className={styles.input} type="date" value={filters.updatedTo} onChange={(event) => patchFilters({ updatedTo: event.target.value })} /></FilterField>
          <FilterField label="Task name"><input className={styles.input} value={filters.name} onChange={(event) => patchFilters({ name: event.target.value })} /></FilterField>
          <FilterField label="Task ID"><input className={styles.input} value={filters.id} onChange={(event) => patchFilters({ id: event.target.value })} /></FilterField>
        </>}
      >
        <FilterField label="Search"><div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "var(--muted)" }} /><input className={styles.input} style={{ paddingLeft: 34 }} placeholder="Search tasks" value={filters.search} onChange={(event) => patchFilters({ search: event.target.value })} /></div></FilterField>
        <FilterField label="Due from"><input className={styles.input} type="date" value={filters.dueFrom} onChange={(event) => patchFilters({ dueFrom: event.target.value })} /></FilterField>
        <FilterField label="Due to"><input className={styles.input} type="date" value={filters.dueTo} onChange={(event) => patchFilters({ dueTo: event.target.value })} /></FilterField>
        <FilterField label="Status"><select className={styles.select} value={filters.status} onChange={(event) => patchFilters({ status: event.target.value })}><option value="">All statuses</option>{facets.statuses.map((item) => <option key={item.value} value={item.value}>{item.value} ({item.count})</option>)}</select></FilterField>
        <FilterField label="Priority"><select className={styles.select} value={filters.priority} onChange={(event) => patchFilters({ priority: event.target.value })}><option value="">Any priority</option>{["urgent", "high", "normal", "low", "none"].map((value) => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}</select></FilterField>
        <FilterField label="List"><select className={styles.select} value={filters.listId} onChange={(event) => patchFilters({ listId: event.target.value })}><option value="">All lists</option>{facets.lists.map((list) => <option key={list.id} value={list.id}>{list.name} ({list.count})</option>)}</select></FilterField>
      </FilterBar>

      {error ? <div className={styles.errorBanner}><span>{error}</span><button type="button" className={styles.quietButton} onClick={() => void loadTasks()}>Retry</button></div> : null}
      {sync?.error ? <div className={styles.errorBanner}><span>Showing the cached list: {sync.error}</span><button type="button" className={styles.quietButton} disabled={busy} onClick={() => void syncNow()}>Sync again</button></div> : null}
      {notice ? <p className={styles.sourceNote} role="status">{notice}</p> : null}

      <section className={styles.ledgerSurface} aria-busy={loading}>
        {loading ? <div className={styles.loadingBar} /> : null}
        {tasks.length === 0 && !loading ? (
          <div className={styles.emptyState}>
            <div>
              <ListTodo size={26} />
              <h2>{hasAnyRecords ? "No ClickUp tasks cached yet" : "No tasks match these filters"}</h2>
              <p>{hasAnyRecords
                ? "Sync to pull the open tasks assigned to the configured ClickUp user."
                : "Clear one or more filters to broaden the result set."}</p>
              {activeFilters.length > 0
                ? <button type="button" className={styles.secondaryButton} onClick={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))}>Clear filters</button>
                : <button type="button" className={styles.primaryButton} disabled={busy} onClick={() => void syncNow()}><RefreshCw size={15} /> Sync ClickUp</button>}
            </div>
          </div>
        ) : (
          <DataTable
            rows={tasks}
            columns={columns}
            rowKey={(task) => task.id}
            sort={filters.sort}
            direction={filters.direction}
            onSort={(sort) => patchFilters({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" })}
            renderMobile={(task) => {
              const due = dueLabel(task.dueDate);
              return (
                <article className={styles.mobileRow}>
                  <div className={styles.mobileRowHead}>
                    <button type="button" className={`${styles.mobileRowTitle} ${styles.linkCell}`} onClick={() => setOpenTask(task)}>{task.name}</button>
                    <div className={styles.rowActions}>
                      {task.url ? <a className={styles.iconButton} href={task.url} target="_blank" rel="noreferrer" aria-label="Open in ClickUp"><ExternalLink size={15} /></a> : null}
                      <button type="button" className={styles.iconButton} disabled={busy || !task.listId} onClick={() => void markComplete(task)} aria-label="Mark complete in ClickUp"><CheckCircle2 size={15} /></button>
                    </div>
                  </div>
                  <p className={styles.mobileRowDetails}>{[task.listName, task.spaceName].filter(Boolean).join(" · ") || "No list"}</p>
                  <div className={styles.mobileRowMeta}>
                    <span className={due.overdue ? styles.overdueText : undefined}>{due.text}</span>
                    <span>{priorityLabel(task.priority)}</span>
                    {task.status ? <span className={styles.status}>{task.status}</span> : null}
                    <span>{task.projectName || task.clientName || "Unassigned"}</span>
                  </div>
                </article>
              );
            }}
          />
        )}
        <footer className={styles.ledgerFooter}>
          <div className={styles.footerTotals}>
            <span className={styles.footerTotal}><strong>{totals.tasks}</strong><span>tasks</span></span>
            <span className={styles.footerTotal}><strong>{totals.overdue}</strong><span>overdue</span></span>
            <span className={styles.footerTotal}><strong>{totals.dueSoon}</strong><span>due in 7 days</span></span>
            <span className={styles.footerTotal}><strong>{totals.unassigned}</strong><span>unassigned</span></span>
          </div>
          <div className={styles.pagination}>
            <select className={`${styles.select} ${styles.pageSize}`} aria-label="Rows per page" value={filters.pageSize} onChange={(event) => patchFilters({ pageSize: Number(event.target.value) })}>
              <option value={25}>25</option><option value={50}>50</option><option value={100}>100</option>
            </select>
            <span className={styles.pageStatus}>Page {pageInfo.totalPages === 0 ? 0 : pageInfo.page} of {pageInfo.totalPages}</span>
            <button type="button" className={styles.pageButton} disabled={!pageInfo.hasPreviousPage || loading} onClick={() => patchFilters({ page: filters.page - 1 }, true)}>Previous</button>
            <button type="button" className={styles.pageButton} disabled={!pageInfo.hasNextPage || loading} onClick={() => patchFilters({ page: filters.page + 1 }, true)}>Next</button>
          </div>
        </footer>
      </section>

      <RecordSheet
        open={openTask !== null}
        title={openTask?.name ?? "Task"}
        subtitle={openTask ? [openTask.listName, openTask.folderName, openTask.spaceName].filter(Boolean).join(" · ") || "No list" : undefined}
        onClose={() => setOpenTask(null)}
        footer={<>
          {openTask?.url ? <a className={styles.secondaryButton} href={openTask.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in ClickUp</a> : null}
          <button type="button" className={styles.primaryButton} disabled={busy || !openTask?.listId} onClick={() => { if (openTask) void markComplete(openTask); }}>
            {busy ? "Working…" : "Mark complete"}
          </button>
        </>}
      >
        {openTask ? (
          <dl className={styles.detailList}>
            <div><dt>Status</dt><dd>{openTask.status || "—"}</dd></div>
            <div><dt>Priority</dt><dd>{priorityLabel(openTask.priority)}</dd></div>
            <div><dt>Due</dt><dd>{dueLabel(openTask.dueDate).text}</dd></div>
            <div><dt>Client</dt><dd>{openTask.clientName || "Unassigned"}</dd></div>
            <div><dt>Project</dt><dd>{openTask.projectName || "Unassigned"}</dd></div>
            <div><dt>Association</dt><dd>{ASSOCIATION_LABELS[openTask.associationSource] ?? openTask.associationSource}</dd></div>
            <div><dt>Task type</dt><dd>{openTask.taskType || "—"}</dd></div>
            <div><dt>Updated in ClickUp</dt><dd>{openTask.updatedAt ? relativeTime(new Date(openTask.updatedAt).toISOString()) : "—"}</dd></div>
            <div><dt>Task ID</dt><dd>{openTask.id}</dd></div>
            {!openTask.listId ? <div><dt>Complete</dt><dd>This task has no cached ClickUp list, so its completed status cannot be resolved. Open it in ClickUp instead.</dd></div> : null}
          </dl>
        ) : null}
      </RecordSheet>
    </TransactionPage>
  );
}
