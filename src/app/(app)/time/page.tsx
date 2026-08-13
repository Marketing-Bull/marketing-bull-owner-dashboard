"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { DataTable, type LedgerColumn } from "@/components/transactions/data-table";
import { DeleteDialog } from "@/components/transactions/delete-dialog";
import { FilterBar, FilterField, type ActiveFilter } from "@/components/transactions/filter-bar";
import { HoursField } from "@/components/transactions/hours-field";
import { RecordSheet } from "@/components/transactions/record-sheet";
import { TransactionPage, TransactionPageHeader } from "@/components/transactions/transaction-page";
import styles from "@/components/transactions/transaction-ledger.module.css";
import { formatHours, MAX_HOURS, parseHoursInput } from "@/lib/hours-input";
import type { Client, Project, TimeEntry, TimeEntryRecentDefaults } from "@/lib/types";

type TimeSort = "date" | "hours" | "rate" | "amount" | "details" | "billable" | "startTime" | "endTime" | "createdAt" | "updatedAt";
type Direction = "asc" | "desc";

type TimeFilters = {
  page: number;
  pageSize: number;
  sort: TimeSort;
  direction: Direction;
  search: string;
  from: string;
  to: string;
  clientId: string;
  projectId: string;
  billable: string;
  id: string;
  mcId: string;
  hoursMin: string;
  hoursMax: string;
  rateMin: string;
  rateMax: string;
  amountMin: string;
  amountMax: string;
  details: string;
  startTime: string;
  endTime: string;
  hasStartTime: string;
  hasEndTime: string;
  createdFrom: string;
  createdTo: string;
  updatedFrom: string;
  updatedTo: string;
};

type PageInfo = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

type Totals = { hours: number; billableHours: number; amount: number; billableAmount: number };

type FormValues = {
  date: string;
  hours: string;
  clientId: string;
  projectId: string;
  billable: boolean;
  details: string;
  startTime: string;
  endTime: string;
};

const DEFAULT_FILTERS: TimeFilters = {
  page: 1,
  pageSize: 50,
  sort: "date",
  direction: "desc",
  search: "",
  from: "",
  to: "",
  clientId: "",
  projectId: "",
  billable: "",
  id: "",
  mcId: "",
  hoursMin: "",
  hoursMax: "",
  rateMin: "",
  rateMax: "",
  amountMin: "",
  amountMax: "",
  details: "",
  startTime: "",
  endTime: "",
  hasStartTime: "",
  hasEndTime: "",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: ""
};

const FILTER_KEYS = Object.keys(DEFAULT_FILTERS) as Array<keyof TimeFilters>;

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  return true;
}

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function friendlyDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
    : value;
}

function blankForm(defaults: TimeEntryRecentDefaults | null): FormValues {
  return {
    date: todayKey(),
    hours: "",
    clientId: defaults?.clientId ?? "",
    projectId: defaults?.projectId ?? "",
    billable: defaults?.billable ?? true,
    details: "",
    startTime: "",
    endTime: ""
  };
}

function entryForm(entry: TimeEntry, duplicate = false): FormValues {
  return {
    date: duplicate ? todayKey() : entry.date,
    hours: formatHours(entry.hours),
    clientId: entry.clientId ?? "",
    projectId: entry.projectId ?? "",
    billable: entry.billable,
    details: entry.details,
    startTime: entry.startTime ?? "",
    endTime: entry.endTime ?? ""
  };
}

function payload(values: FormValues) {
  return {
    date: values.date,
    // The form refuses to submit unparseable hours, so this always resolves.
    hours: parseHoursInput(values.hours) ?? 0,
    clientId: values.clientId || null,
    projectId: values.projectId || null,
    billable: values.billable,
    details: values.details,
    startTime: values.startTime || null,
    endTime: values.endTime || null
  };
}

function filtersFromUrl(): TimeFilters {
  const params = new URLSearchParams(window.location.search);
  const result = { ...DEFAULT_FILTERS };
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value === null) continue;
    if (key === "page" || key === "pageSize") {
      const parsed = Number(value);
      if (Number.isInteger(parsed) && parsed > 0) result[key] = parsed;
    } else {
      (result[key] as string) = value;
    }
  }
  const savedPageSize = Number(window.localStorage.getItem("transaction-ledger.time.page-size"));
  if (!params.has("pageSize") && [25, 50, 100].includes(savedPageSize)) result.pageSize = savedPageSize;
  return result;
}

function queryString(filters: TimeFilters): string {
  const params = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filters[key];
    if (value === "" || value === DEFAULT_FILTERS[key]) continue;
    params.set(key, String(value));
  }
  params.set("page", String(filters.page));
  params.set("pageSize", String(filters.pageSize));
  params.set("sort", filters.sort);
  params.set("direction", filters.direction);
  return params.toString();
}

function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function TimeForm({
  formId,
  initial,
  clients,
  projects,
  frozenRate,
  onDirtyChange,
  onSubmit
}: {
  formId: string;
  initial: FormValues;
  clients: Client[];
  projects: Project[];
  frozenRate?: number;
  onDirtyChange: (dirty: boolean) => void;
  onSubmit: (values: FormValues, addAnother: boolean) => void;
}) {
  const [values, setValues] = useState(initial);
  const [hoursError, setHoursError] = useState("");
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const selectedProject = projects.find((project) => project.id === values.projectId);
  const selectedClient = clients.find((client) => client.id === values.clientId);
  const rate = frozenRate ?? selectedProject?.hourlyRateOverride ?? selectedClient?.hourlyRate ?? 0;
  const hours = parseHoursInput(values.hours);
  const estimated = (hours ?? 0) * rate;
  const selectableProjects = projects.filter((project) => !values.clientId || project.clientId === values.clientId || project.id === values.projectId);

  return (
    <form
      id={formId}
      className={styles.sheetForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (hours === null) {
          setHoursError(`Enter hours as 1.35, 1:21, or 90m — more than 0 and up to ${MAX_HOURS}.`);
          (event.currentTarget.querySelector("input[inputmode=decimal]") as HTMLInputElement | null)?.focus();
          return;
        }
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        onSubmit(values, submitter?.value === "another");
      }}
    >
      <label className={`${styles.sheetField} ${styles.spanAll}`}>
        <span className={styles.fieldLabel}>Date</span>
        <input className={styles.input} type="date" value={values.date} required onChange={(event) => setValues((current) => ({ ...current, date: event.target.value }))} />
      </label>
      <HoursField
        value={values.hours}
        error={hoursError}
        onChange={(next) => { setHoursError(""); setValues((current) => ({ ...current, hours: next })); }}
      />
      <label className={styles.sheetField}>
        <span className={styles.fieldLabel}>Client</span>
        <select className={styles.select} value={values.clientId} onChange={(event) => {
          const clientId = event.target.value;
          setValues((current) => ({
            ...current,
            clientId,
            projectId: projects.some((project) => project.id === current.projectId && project.clientId === clientId) ? current.projectId : ""
          }));
        }}>
          <option value="">Unassigned</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.isArchived ? " (archived)" : ""}</option>)}
        </select>
      </label>
      <label className={styles.sheetField}>
        <span className={styles.fieldLabel}>Project</span>
        <select className={styles.select} value={values.projectId} onChange={(event) => {
          const project = projects.find((candidate) => candidate.id === event.target.value);
          setValues((current) => ({ ...current, projectId: event.target.value, clientId: project?.clientId ?? current.clientId }));
        }}>
          <option value="">No project</option>
          {selectableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.isArchived ? " (archived)" : ""}</option>)}
        </select>
      </label>
      <label className={`${styles.toggleField} ${styles.spanAll}`}>
        <span>Billable</span>
        <input type="checkbox" checked={values.billable} onChange={(event) => setValues((current) => ({ ...current, billable: event.target.checked }))} />
      </label>
      <label className={`${styles.sheetField} ${styles.spanAll}`}>
        <span className={styles.fieldLabel}>Details</span>
        <textarea className={styles.textarea} value={values.details} placeholder="What did you work on?" onChange={(event) => setValues((current) => ({ ...current, details: event.target.value }))} />
      </label>
      <div className={styles.calculation} aria-label="Time value calculation">
        <div><strong>{money(rate)}/hr</strong><span>{frozenRate === undefined ? "Rate at save" : "Frozen rate"}</span></div>
        <div><strong>Estimated {money(estimated)}</strong><span>{(hours ?? 0).toFixed(2)} hrs × {money(rate)}</span></div>
      </div>
      <details className={styles.detailsDisclosure}>
        <summary>More details</summary>
        <div className={styles.detailsGrid}>
          <label className={styles.sheetField}>
            <span className={styles.fieldLabel}>Start time</span>
            <input className={styles.input} type="time" value={values.startTime} onChange={(event) => setValues((current) => ({ ...current, startTime: event.target.value }))} />
          </label>
          <label className={styles.sheetField}>
            <span className={styles.fieldLabel}>End time</span>
            <input className={styles.input} type="time" value={values.endTime} onChange={(event) => setValues((current) => ({ ...current, endTime: event.target.value }))} />
          </label>
        </div>
      </details>
    </form>
  );
}

export default function TimePage() {
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState<TimeFilters>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>({ page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false });
  const [totals, setTotals] = useState<Totals>({ hours: 0, billableHours: 0, amount: 0, billableAmount: 0 });
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentDefaults, setRecentDefaults] = useState<TimeEntryRecentDefaults | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<"create" | "edit" | null>(null);
  const [editingEntry, setEditingEntry] = useState<TimeEntry | null>(null);
  const [formSeed, setFormSeed] = useState<FormValues | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [formDirty, setFormDirty] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<TimeEntry | null>(null);
  const debouncedSearch = useDebouncedValue(filters.search, 300);
  const debouncedDetails = useDebouncedValue(filters.details, 300);
  const requestQuery = queryString({
    ...filters,
    search: debouncedSearch,
    details: debouncedDetails,
  });

  const patchFilters = useCallback((patch: Partial<TimeFilters>, keepPage = false) => {
    setFilters((current) => ({ ...current, ...patch, page: keepPage && patch.page !== undefined ? patch.page : 1 }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setFilters(filtersFromUrl());
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.history.replaceState(null, "", `${window.location.pathname}?${queryString(filters)}`);
    window.localStorage.setItem("transaction-ledger.time.page-size", String(filters.pageSize));
  }, [filters, ready]);

  useEffect(() => {
    const run = async () => {
      try {
        const [clientsResponse, projectsResponse] = await Promise.all([
          fetch("/api/clients?includeArchived=1", { cache: "no-store" }),
          fetch("/api/projects?includeArchived=1", { cache: "no-store" })
        ]);
        if (redirectedToLogin(clientsResponse) || redirectedToLogin(projectsResponse)) return;
        const [clientsJson, projectsJson] = await Promise.all([clientsResponse.json(), projectsResponse.json()]);
        if (!clientsResponse.ok) throw new Error(clientsJson?.error || "Clients fetch failed");
        if (!projectsResponse.ok) throw new Error(projectsJson?.error || "Projects fetch failed");
        setClients(Array.isArray(clientsJson?.clients) ? clientsJson.clients : []);
        setProjects(Array.isArray(projectsJson?.projects) ? projectsJson.projects : []);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void run();
  }, []);

  const loadEntries = useCallback(async (signal?: AbortSignal) => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/time-entries?${requestQuery}`, { cache: "no-store", signal });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Time entries fetch failed");
      setEntries(Array.isArray(json?.items) ? json.items : []);
      setPageInfo((current) => json?.pageInfo ?? current);
      setTotals(json?.filteredTotals ?? { hours: 0, billableHours: 0, amount: 0, billableAmount: 0 });
      setRecentDefaults(json?.recentDefaults ?? null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [ready, requestQuery]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadEntries(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadEntries]);

  async function mutate(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      if (redirectedToLogin(response)) return false;
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || `${method} failed (${response.status})`);
      await loadEntries();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const activeProjects = useMemo(() => projects.filter((project) => !filters.clientId || project.clientId === filters.clientId), [projects, filters.clientId]);

  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const result: ActiveFilter[] = [];
    const add = (id: keyof TimeFilters, label: string) => {
      if (!filters[id] || filters[id] === DEFAULT_FILTERS[id]) return;
      result.push({ id, label, onRemove: () => patchFilters({ [id]: DEFAULT_FILTERS[id] }) });
    };
    add("search", `Search: ${filters.search}`);
    add("from", `From: ${filters.from}`);
    add("to", `To: ${filters.to}`);
    add("clientId", `Client: ${clientNames.get(filters.clientId) ?? filters.clientId}`);
    add("projectId", `Project: ${projectNames.get(filters.projectId) ?? filters.projectId}`);
    add("billable", `Billable: ${filters.billable === "true" ? "Yes" : "No"}`);
    const labels: Array<[keyof TimeFilters, string]> = [
      ["id", "Entry ID"], ["mcId", "Imported ID"], ["hoursMin", "Min hours"], ["hoursMax", "Max hours"],
      ["rateMin", "Min rate"], ["rateMax", "Max rate"], ["amountMin", "Min amount"], ["amountMax", "Max amount"],
      ["details", "Details"], ["startTime", "Start time"], ["endTime", "End time"], ["hasStartTime", "Has start"],
      ["hasEndTime", "Has end"], ["createdFrom", "Created from"], ["createdTo", "Created to"],
      ["updatedFrom", "Updated from"], ["updatedTo", "Updated to"]
    ];
    for (const [key, label] of labels) add(key, `${label}: ${filters[key]}`);
    return result;
  }, [filters, clientNames, projectNames, patchFilters]);

  function openCreate(seed?: FormValues) {
    setEditingEntry(null);
    setFormSeed(seed ?? blankForm(recentDefaults));
    setFormKey((current) => current + 1);
    setFormDirty(false);
    setSheetMode("create");
  }

  function openEdit(entry: TimeEntry) {
    setEditingEntry(entry);
    setFormSeed(entryForm(entry));
    setFormKey((current) => current + 1);
    setFormDirty(false);
    setSheetMode("edit");
  }

  const columns: LedgerColumn<TimeEntry, TimeSort>[] = [
    { id: "date", label: "Date", sort: "date", render: (entry) => <span className={styles.primaryCell}>{friendlyDate(entry.date)}</span> },
    { id: "client", label: "Client", render: (entry) => clientNames.get(entry.clientId ?? "") ?? <span className={styles.secondaryText}>Unassigned</span> },
    { id: "project", label: "Project", render: (entry) => projectNames.get(entry.projectId ?? "") ?? <span className={styles.secondaryText}>No project</span> },
    { id: "details", label: "Details", sort: "details", className: styles.detailsCell, render: (entry) => entry.details || <span className={styles.secondaryText}>—</span> },
    { id: "hours", label: "Hours", sort: "hours", align: "right", render: (entry) => entry.hours.toFixed(2) },
    { id: "rate", label: "Rate", sort: "rate", align: "right", render: (entry) => money(entry.rate) },
    { id: "amount", label: "Amount", sort: "amount", align: "right", render: (entry) => money(entry.hours * entry.rate) },
    { id: "billable", label: "Billable", sort: "billable", render: (entry) => <span className={`${styles.status} ${entry.billable ? styles.statusActive : ""}`}>{entry.billable ? "Billable" : "Internal"}</span> },
    { id: "actions", label: "Actions", align: "right", render: (entry) => (
      <div className={styles.rowActions}>
        <button type="button" className={styles.iconButton} onClick={() => openEdit(entry)} aria-label={`Edit ${friendlyDate(entry.date)} time entry`}><Pencil size={15} /></button>
        <button type="button" className={styles.iconButton} onClick={() => openCreate(entryForm(entry, true))} aria-label={`Duplicate ${friendlyDate(entry.date)} time entry`}><Copy size={15} /></button>
        <button type="button" className={styles.iconButton} onClick={() => setDeleteEntry(entry)} aria-label={`Delete ${friendlyDate(entry.date)} time entry`}><Trash2 size={15} /></button>
      </div>
    )}
  ];

  const formId = `time-form-${formKey}`;
  const hasAnyRecords = pageInfo.totalItems > 0 || activeFilters.length === 0;

  return (
    <TransactionPage>
      <TransactionPageHeader
        title="Time"
        metrics={[
          { label: "filtered hours", value: `${totals.hours.toFixed(1)}h` },
          { label: "filtered entries", value: pageInfo.totalItems }
        ]}
        action={<button type="button" className={styles.primaryButton} onClick={() => openCreate()}><Plus size={16} /> Log time</button>}
      />

      <FilterBar
        advancedOpen={advancedOpen}
        onToggleAdvanced={() => setAdvancedOpen((current) => !current)}
        activeFilters={activeFilters}
        onClear={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))}
        advanced={<>
          <div className={styles.filterMobileOnly}>
            <FilterField label="Client"><select className={styles.select} value={filters.clientId} onChange={(event) => patchFilters({ clientId: event.target.value, projectId: "" })}><option value="">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></FilterField>
          </div>
          <div className={styles.filterTabletOnly}>
            <FilterField label="Project"><select className={styles.select} value={filters.projectId} onChange={(event) => patchFilters({ projectId: event.target.value })}><option value="">All projects</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FilterField>
          </div>
          <div className={styles.filterTabletOnly}>
            <FilterField label="Billable"><select className={styles.select} value={filters.billable} onChange={(event) => patchFilters({ billable: event.target.value })}><option value="">All</option><option value="true">Billable</option><option value="false">Non-billable</option></select></FilterField>
          </div>
          <FilterField label="Entry ID"><input className={styles.input} value={filters.id} onChange={(event) => patchFilters({ id: event.target.value })} /></FilterField>
          <FilterField label="Imported ID"><input className={styles.input} inputMode="numeric" value={filters.mcId} onChange={(event) => patchFilters({ mcId: event.target.value })} /></FilterField>
          <FilterField label="Min hours"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.hoursMin} onChange={(event) => patchFilters({ hoursMin: event.target.value })} /></FilterField>
          <FilterField label="Max hours"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.hoursMax} onChange={(event) => patchFilters({ hoursMax: event.target.value })} /></FilterField>
          <FilterField label="Details"><input className={styles.input} value={filters.details} onChange={(event) => patchFilters({ details: event.target.value })} /></FilterField>
          <FilterField label="Min rate"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.rateMin} onChange={(event) => patchFilters({ rateMin: event.target.value })} /></FilterField>
          <FilterField label="Max rate"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.rateMax} onChange={(event) => patchFilters({ rateMax: event.target.value })} /></FilterField>
          <FilterField label="Min amount"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.amountMin} onChange={(event) => patchFilters({ amountMin: event.target.value })} /></FilterField>
          <FilterField label="Max amount"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.amountMax} onChange={(event) => patchFilters({ amountMax: event.target.value })} /></FilterField>
          <FilterField label="Start time"><input className={styles.input} type="time" value={filters.startTime} onChange={(event) => patchFilters({ startTime: event.target.value })} /></FilterField>
          <FilterField label="End time"><input className={styles.input} type="time" value={filters.endTime} onChange={(event) => patchFilters({ endTime: event.target.value })} /></FilterField>
          <FilterField label="Has start time"><select className={styles.select} value={filters.hasStartTime} onChange={(event) => patchFilters({ hasStartTime: event.target.value })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></FilterField>
          <FilterField label="Has end time"><select className={styles.select} value={filters.hasEndTime} onChange={(event) => patchFilters({ hasEndTime: event.target.value })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></FilterField>
          <FilterField label="Created from"><input className={styles.input} type="date" value={filters.createdFrom} onChange={(event) => patchFilters({ createdFrom: event.target.value })} /></FilterField>
          <FilterField label="Created to"><input className={styles.input} type="date" value={filters.createdTo} onChange={(event) => patchFilters({ createdTo: event.target.value })} /></FilterField>
          <FilterField label="Updated from"><input className={styles.input} type="date" value={filters.updatedFrom} onChange={(event) => patchFilters({ updatedFrom: event.target.value })} /></FilterField>
          <FilterField label="Updated to"><input className={styles.input} type="date" value={filters.updatedTo} onChange={(event) => patchFilters({ updatedTo: event.target.value })} /></FilterField>
        </>}
      >
        <FilterField label="Search"><div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "var(--muted)" }} /><input className={styles.input} style={{ paddingLeft: 34 }} placeholder="Search time entries" value={filters.search} onChange={(event) => patchFilters({ search: event.target.value })} /></div></FilterField>
        <FilterField label="From"><input className={styles.input} type="date" value={filters.from} onChange={(event) => patchFilters({ from: event.target.value })} /></FilterField>
        <FilterField label="To"><input className={styles.input} type="date" value={filters.to} onChange={(event) => patchFilters({ to: event.target.value })} /></FilterField>
        <FilterField label="Client"><select className={styles.select} value={filters.clientId} onChange={(event) => patchFilters({ clientId: event.target.value, projectId: "" })}><option value="">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></FilterField>
        <FilterField label="Project"><select className={styles.select} value={filters.projectId} onChange={(event) => patchFilters({ projectId: event.target.value })}><option value="">All projects</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FilterField>
        <FilterField label="Billable"><select className={styles.select} value={filters.billable} onChange={(event) => patchFilters({ billable: event.target.value })}><option value="">All</option><option value="true">Billable</option><option value="false">Non-billable</option></select></FilterField>
      </FilterBar>

      {error ? <div className={styles.errorBanner}><span>{error}</span><button type="button" className={styles.quietButton} onClick={() => void loadEntries()}>Retry</button></div> : null}

      <section className={styles.ledgerSurface} aria-busy={loading}>
        {loading ? <div className={styles.loadingBar} /> : null}
        {entries.length === 0 && !loading ? (
          <div className={styles.emptyState}>
            <div>
              <h2>{hasAnyRecords ? "No time entries yet" : "No entries match these filters"}</h2>
              <p>{hasAnyRecords ? "Log the first time entry to start building the ledger." : "Clear one or more filters to broaden the result set."}</p>
              {activeFilters.length > 0
                ? <button type="button" className={styles.secondaryButton} onClick={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))}>Clear filters</button>
                : <button type="button" className={styles.primaryButton} onClick={() => openCreate()}><Plus size={15} /> Log time</button>}
            </div>
          </div>
        ) : (
          <DataTable
            rows={entries}
            columns={columns}
            rowKey={(entry) => entry.id}
            sort={filters.sort}
            direction={filters.direction}
            onSort={(sort) => patchFilters({ sort, direction: filters.sort === sort && filters.direction === "desc" ? "asc" : "desc" })}
            renderMobile={(entry) => (
              <article className={styles.mobileRow}>
                <div className={styles.mobileRowHead}>
                  <div className={styles.mobileRowTitle}>{projectNames.get(entry.projectId ?? "") ?? clientNames.get(entry.clientId ?? "") ?? "Unassigned"}</div>
                  <div className={styles.rowActions}>
                    <button type="button" className={styles.iconButton} onClick={() => openEdit(entry)} aria-label="Edit time entry"><Pencil size={15} /></button>
                    <button type="button" className={styles.iconButton} onClick={() => setDeleteEntry(entry)} aria-label="Delete time entry"><Trash2 size={15} /></button>
                  </div>
                </div>
                {entry.details ? <p className={styles.mobileRowDetails}>{entry.details}</p> : null}
                <div className={styles.mobileRowMeta}>
                  <span>{friendlyDate(entry.date)}</span><span>{entry.hours.toFixed(2)}h</span><span>{money(entry.hours * entry.rate)}</span>
                  <span className={`${styles.status} ${entry.billable ? styles.statusActive : ""}`}>{entry.billable ? "Billable" : "Internal"}</span>
                </div>
              </article>
            )}
          />
        )}
        <footer className={styles.ledgerFooter}>
          <div className={styles.footerTotals}>
            <span className={styles.footerTotal}><strong>{totals.hours.toFixed(1)}</strong><span>total hours</span></span>
            <span className={styles.footerTotal}><strong>{money(totals.billableAmount)}</strong><span>billable value</span></span>
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
        open={sheetMode !== null}
        title={sheetMode === "edit" ? "Edit time" : "Log time"}
        subtitle={sheetMode === "create" && recentDefaults ? "Using recent client, project, and billing values" : undefined}
        dirty={formDirty}
        onClose={() => setSheetMode(null)}
        footer={<>
          {sheetMode === "create" ? <button type="submit" form={formId} name="intent" value="another" className={styles.secondaryButton} disabled={busy}>Save & add another</button> : null}
          <button type="submit" form={formId} name="intent" value="close" className={styles.primaryButton} disabled={busy}>{busy ? "Saving…" : sheetMode === "edit" ? "Save changes" : "Save time"}</button>
        </>}
      >
        {formSeed ? <TimeForm
          key={formKey}
          formId={formId}
          initial={formSeed}
          clients={clients}
          projects={projects}
          frozenRate={sheetMode === "edit" ? editingEntry?.rate : undefined}
          onDirtyChange={setFormDirty}
          onSubmit={async (values, addAnother) => {
            const path = sheetMode === "edit" && editingEntry ? `/api/time-entries/${editingEntry.id}` : "/api/time-entries";
            const succeeded = await mutate(sheetMode === "edit" ? "PUT" : "POST", path, payload(values));
            if (!succeeded) return;
            setFormDirty(false);
            if (addAnother) {
              setFormSeed({ ...values, hours: "", details: "", startTime: "", endTime: "" });
              setFormKey((current) => current + 1);
            } else {
              setSheetMode(null);
            }
          }}
        /> : null}
      </RecordSheet>

      <DeleteDialog
        open={deleteEntry !== null}
        title="Delete time entry?"
        description={deleteEntry ? `${friendlyDate(deleteEntry.date)} · ${deleteEntry.hours.toFixed(2)} hours${deleteEntry.details ? ` · ${deleteEntry.details}` : ""}. This cannot be undone.` : ""}
        confirmLabel="Delete time entry"
        busy={busy}
        onCancel={() => setDeleteEntry(null)}
        onConfirm={async () => {
          if (!deleteEntry) return;
          const wasLastRow = entries.length === 1 && filters.page > 1;
          if (await mutate("DELETE", `/api/time-entries/${deleteEntry.id}`)) {
            setDeleteEntry(null);
            if (wasLastRow) patchFilters({ page: filters.page - 1 }, true);
          }
        }}
      />
    </TransactionPage>
  );
}
