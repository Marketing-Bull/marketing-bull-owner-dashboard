"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3, LoaderCircle, Plus } from "lucide-react";
import styles from "../entities.module.css";
import type {
  Client,
  Project,
  TimeEntry,
  TimeEntryRecentDefaults
} from "@/lib/types";

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}

function todayKey(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(value);
}

function friendlyDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)
    : value;
}

type FormValues = {
  date: string;
  hours: string;
  clientId: string;
  projectId: string;
  billable: boolean;
  details: string;
};

function emptyForm(defaults: TimeEntryRecentDefaults | null): FormValues {
  return {
    date: todayKey(),
    hours: "",
    clientId: defaults?.clientId ?? "",
    projectId: defaults?.projectId ?? "",
    billable: defaults?.billable ?? true,
    details: ""
  };
}

function toForm(entry: TimeEntry): FormValues {
  return {
    date: entry.date,
    hours: String(entry.hours),
    clientId: entry.clientId ?? "",
    projectId: entry.projectId ?? "",
    billable: entry.billable,
    details: entry.details
  };
}

function toPayload(values: FormValues) {
  return {
    date: values.date,
    hours: Number(values.hours),
    clientId: values.clientId || null,
    projectId: values.projectId || null,
    billable: values.billable,
    details: values.details
  };
}

function TimeEntryForm({
  initial,
  clients,
  projects,
  frozenRate,
  submitLabel,
  busy,
  onSubmit,
  onCancel
}: {
  initial: FormValues;
  clients: Client[];
  projects: Project[];
  frozenRate?: number;
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState(initial);
  const selectedProject = projects.find((project) => project.id === values.projectId) ?? null;
  const selectedClient = clients.find((client) => client.id === values.clientId) ?? null;
  const resolvedRate =
    selectedProject?.hourlyRateOverride && selectedProject.hourlyRateOverride > 0
      ? selectedProject.hourlyRateOverride
      : selectedClient?.hourlyRate && selectedClient.hourlyRate > 0
        ? selectedClient.hourlyRate
        : 0;
  const selectableProjects = projects.filter(
    (project) => !values.clientId || project.clientId === values.clientId || project.id === values.projectId
  );

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>Date</span>
        <input
          className={styles.input}
          type="date"
          value={values.date}
          onChange={(event) => setValues((current) => ({ ...current, date: event.target.value }))}
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Hours</span>
        <input
          className={styles.input}
          type="number"
          inputMode="decimal"
          min="0.01"
          max="24"
          step="0.01"
          value={values.hours}
          onChange={(event) => setValues((current) => ({ ...current, hours: event.target.value }))}
          autoFocus
          required
        />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Client</span>
        <select
          className={styles.select}
          value={values.clientId}
          onChange={(event) => {
            const clientId = event.target.value;
            const projectStillFits = Boolean(clientId) && projects.some(
              (project) => project.id === values.projectId && project.clientId === clientId
            );
            setValues((current) => ({
              ...current,
              clientId,
              projectId: projectStillFits ? current.projectId : ""
            }));
          }}
        >
          <option value="">Unassigned</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}{client.isArchived ? " (archived)" : ""}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Project</span>
        <select
          className={styles.select}
          value={values.projectId}
          onChange={(event) => {
            const projectId = event.target.value;
            const project = projects.find((candidate) => candidate.id === projectId);
            setValues((current) => ({
              ...current,
              projectId,
              clientId: project?.clientId ?? current.clientId
            }));
          }}
        >
          <option value="">No project</option>
          {selectableProjects.map((project) => (
            <option key={project.id} value={project.id}>{project.name}{project.isArchived ? " (archived)" : ""}</option>
          ))}
        </select>
      </label>
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={values.billable}
          onChange={(event) => setValues((current) => ({ ...current, billable: event.target.checked }))}
        />
        Billable
      </label>
      <div className={styles.field}>
        <span className={styles.label}>{frozenRate === undefined ? "Rate at save" : "Frozen rate"}</span>
        <div className={styles.readonlyValue}>
          {money(frozenRate ?? resolvedRate)}/hr
          {frozenRate !== undefined ? " — changes only if client/project changes" : " — saved as a snapshot"}
        </div>
      </div>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span className={styles.label}>Details</span>
        <textarea
          className={styles.textarea}
          value={values.details}
          onChange={(event) => setValues((current) => ({ ...current, details: event.target.value }))}
          placeholder="What did you work on?"
        />
      </label>
      <div className={styles.formActions}>
        <button
          type="submit"
          className={styles.button}
          disabled={busy || !values.date || !(Number(values.hours) > 0)}
        >
          {busy ? "Saving…" : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className={`${styles.button} ${styles.buttonQuiet}`} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

export default function TimePage() {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [recentDefaults, setRecentDefaults] = useState<TimeEntryRecentDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [timeResponse, clientsResponse, projectsResponse] = await Promise.all([
        fetch("/api/time-entries?limit=500", { cache: "no-store" }),
        fetch("/api/clients?includeArchived=1", { cache: "no-store" }),
        fetch("/api/projects?includeArchived=1", { cache: "no-store" })
      ]);
      if (
        redirectedToLogin(timeResponse) ||
        redirectedToLogin(clientsResponse) ||
        redirectedToLogin(projectsResponse)
      ) return;
      const [timeJson, clientsJson, projectsJson] = await Promise.all([
        timeResponse.json(),
        clientsResponse.json(),
        projectsResponse.json()
      ]);
      if (!timeResponse.ok) throw new Error(timeJson?.error || "Time entries fetch failed");
      if (!clientsResponse.ok) throw new Error(clientsJson?.error || "Clients fetch failed");
      if (!projectsResponse.ok) throw new Error(projectsJson?.error || "Projects fetch failed");
      setEntries(Array.isArray(timeJson?.timeEntries) ? timeJson.timeEntries : []);
      setRecentDefaults(timeJson?.recentDefaults ?? null);
      setClients(Array.isArray(clientsJson?.clients) ? clientsJson.clients : []);
      setProjects(Array.isArray(projectsJson?.projects) ? projectsJson.projects : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setEntries([]);
    }
  }

  useEffect(() => {
    const run = async () => {
      await load();
    };
    void run();
  }, []);

  async function submit(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown) {
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
      await load();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const clientNameById = useMemo(
    () => new Map(clients.map((client) => [client.id, client.name])),
    [clients]
  );
  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const totals = useMemo(() => {
    const rows = entries ?? [];
    return {
      hours: rows.reduce((sum, entry) => sum + entry.hours, 0),
      billableHours: rows.reduce((sum, entry) => sum + (entry.billable ? entry.hours : 0), 0),
      billableValue: rows.reduce(
        (sum, entry) => sum + (entry.billable ? entry.hours * entry.rate : 0),
        0
      )
    };
  }, [entries]);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / Tracking</p>
            <h1 className={styles.title}>Time</h1>
          </div>
          <button type="button" className={styles.button} onClick={() => setCreating((value) => !value)}>
            <Plus size={15} /> Log time
          </button>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.summaryGrid} aria-label="Loaded time totals">
          <div className={styles.summaryItem}>
            <span className={styles.label}>Entries loaded</span>
            <strong className={styles.summaryValue}>{entries?.length ?? "—"}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Total hours</span>
            <strong className={styles.summaryValue}>{entries ? `${totals.hours.toFixed(1)}h` : "—"}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Billable hours</span>
            <strong className={styles.summaryValue}>{entries ? `${totals.billableHours.toFixed(1)}h` : "—"}</strong>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.label}>Billable value</span>
            <strong className={styles.summaryValue}>{entries ? money(totals.billableValue) : "—"}</strong>
          </div>
        </section>

        {creating ? (
          <section className={styles.card}>
            <TimeEntryForm
              key={`${recentDefaults?.clientId}-${recentDefaults?.projectId}-${String(recentDefaults?.billable)}`}
              initial={emptyForm(recentDefaults)}
              clients={clients}
              projects={projects}
              submitLabel="Save time entry"
              busy={busy}
              onCancel={() => setCreating(false)}
              onSubmit={async (values) => {
                if (await submit("POST", "/api/time-entries", toPayload(values))) setCreating(false);
              }}
            />
          </section>
        ) : null}

        <section className={styles.card}>
          {entries === null ? (
            <div className={styles.loader}><LoaderCircle size={15} /> Loading time entries…</div>
          ) : entries.length === 0 ? (
            <div className={styles.empty}>No time entries yet. Log the first one.</div>
          ) : (
            <div className={styles.list}>
              {entries.map((entry) => (
                <div key={entry.id} className={styles.row}>
                  <div className={styles.rowHead}>
                    <div>
                      <div className={styles.rowTitle}>
                        {entry.projectId
                          ? projectNameById.get(entry.projectId) ?? "Unknown project"
                          : entry.clientId
                            ? clientNameById.get(entry.clientId) ?? "Unknown client"
                            : "Unassigned"}
                      </div>
                      <div className={styles.rowMeta}>
                        {[
                          friendlyDate(entry.date),
                          `${entry.hours}h`,
                          entry.clientId ? clientNameById.get(entry.clientId) : null,
                          entry.billable ? `${money(entry.rate)}/hr · ${money(entry.hours * entry.rate)}` : "non-billable",
                          entry.startTime ? `${entry.startTime}${entry.endTime ? `–${entry.endTime}` : ""}` : null
                        ].filter(Boolean).join(" · ")}
                      </div>
                      {entry.details ? <p className={styles.rowDetails}>{entry.details}</p> : null}
                    </div>
                    <div className={styles.rowActions}>
                      <span className={`${styles.statusChip} ${entry.billable ? styles.statusActive : ""}`}>
                        {entry.billable ? "billable" : "internal"}
                      </span>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonQuiet}`}
                        onClick={() => setEditingId((current) => current === entry.id ? null : entry.id)}
                      >
                        {editingId === entry.id ? "Close" : "Edit"}
                      </button>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonDanger}`}
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm("Delete this time entry? This cannot be undone.")) {
                            void submit("DELETE", `/api/time-entries/${entry.id}`);
                          }
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  {editingId === entry.id ? (
                    <TimeEntryForm
                      key={entry.updatedAt}
                      initial={toForm(entry)}
                      clients={clients}
                      projects={projects}
                      frozenRate={entry.rate}
                      submitLabel="Save changes"
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        if (await submit("PUT", `/api/time-entries/${entry.id}`, toPayload(values))) {
                          setEditingId(null);
                        }
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <p className={styles.footerNote}>
          <Clock3 size={14} /> Rates are frozen when an entry is saved. Changing a client or project rate does not restate history.
        </p>
      </div>
    </main>
  );
}
