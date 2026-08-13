"use client";

/**
 * Projects — belongs-to-client, rate override, status lifecycle, and the
 * urgent/important axes that phase 6 turns into the Eisenhower quadrant.
 * Archive-only, like clients: time entries will hang off these rows.
 */

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import styles from "../entities.module.css";
import { PROJECT_STATUSES, type Client, type Project, type ProjectStatus } from "@/lib/types";

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // Hard navigation on purpose: losing the session should tear down the tree.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}

function statusLabel(status: ProjectStatus): string {
  return status.replace("_", " ");
}

type FormValues = {
  name: string;
  clientId: string;
  status: ProjectStatus;
  hourlyRateOverride: string;
  urgent: boolean;
  important: boolean;
  description: string;
  notes: string;
};

const EMPTY_FORM: FormValues = {
  name: "",
  clientId: "",
  status: "active",
  hourlyRateOverride: "",
  urgent: false,
  important: false,
  description: "",
  notes: ""
};

function toForm(project: Project): FormValues {
  return {
    name: project.name,
    clientId: project.clientId ?? "",
    status: project.status,
    hourlyRateOverride: project.hourlyRateOverride == null ? "" : String(project.hourlyRateOverride),
    urgent: project.urgent,
    important: project.important,
    description: project.description,
    notes: project.notes
  };
}

function toPayload(form: FormValues) {
  return {
    name: form.name,
    clientId: form.clientId === "" ? null : form.clientId,
    status: form.status,
    hourlyRateOverride: form.hourlyRateOverride.trim() === "" ? null : Number(form.hourlyRateOverride),
    urgent: form.urgent,
    important: form.important,
    description: form.description,
    notes: form.notes
  };
}

function ProjectForm({
  initial,
  clients,
  submitLabel,
  busy,
  onSubmit,
  onCancel
}: {
  initial: FormValues;
  clients: Client[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: FormValues) => void;
  onCancel?: () => void;
}) {
  const [values, setValues] = useState<FormValues>(initial);
  const set = (key: keyof FormValues) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <label className={styles.field}>
        <span className={styles.label}>Name</span>
        <input className={styles.input} value={values.name} onChange={set("name")} autoFocus required />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Client</span>
        <select className={styles.select} value={values.clientId} onChange={set("clientId")}>
          <option value="">Unassigned</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>{client.name}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Status</span>
        <select className={styles.select} value={values.status} onChange={set("status")}>
          {PROJECT_STATUSES.map((status) => (
            <option key={status} value={status}>{statusLabel(status)}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Rate override ($/hr)</span>
        <input className={styles.input} inputMode="decimal" value={values.hourlyRateOverride} onChange={set("hourlyRateOverride")} />
      </label>
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={values.urgent}
          onChange={(event) => setValues((current) => ({ ...current, urgent: event.target.checked }))}
        />
        Urgent
      </label>
      <label className={styles.checkboxField}>
        <input
          type="checkbox"
          checked={values.important}
          onChange={(event) => setValues((current) => ({ ...current, important: event.target.checked }))}
        />
        Important
      </label>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span className={styles.label}>Description</span>
        <textarea className={styles.textarea} value={values.description} onChange={set("description")} />
      </label>
      <label className={`${styles.field} ${styles.fieldWide}`}>
        <span className={styles.label}>Notes</span>
        <textarea className={styles.textarea} value={values.notes} onChange={set("notes")} />
      </label>
      <div className={styles.formActions}>
        <button type="submit" className={styles.button} disabled={busy || !values.name.trim()}>
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

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [projectsResponse, clientsResponse] = await Promise.all([
        fetch("/api/projects?includeArchived=1", { cache: "no-store" }),
        fetch("/api/clients?includeArchived=1", { cache: "no-store" })
      ]);
      if (redirectedToLogin(projectsResponse) || redirectedToLogin(clientsResponse)) return;
      const projectsJson = await projectsResponse.json();
      const clientsJson = await clientsResponse.json();
      if (!projectsResponse.ok) throw new Error(projectsJson?.error || "Projects fetch failed");
      if (!clientsResponse.ok) throw new Error(clientsJson?.error || "Clients fetch failed");
      setProjects(Array.isArray(projectsJson?.projects) ? projectsJson.projects : []);
      setClients(Array.isArray(clientsJson?.clients) ? clientsJson.clients : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setProjects([]);
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

  const clientNameById = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const visible = useMemo(
    () => (projects ?? []).filter((project) => showArchived || !project.isArchived),
    [projects, showArchived]
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / Delivery</p>
            <h1 className={styles.title}>Projects</h1>
          </div>
          <div className={styles.headerActions}>
            <label className={styles.toggleRow}>
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
              Show archived
            </label>
            <button type="button" className={styles.button} onClick={() => setCreating((value) => !value)}>
              <Plus size={15} /> New project
            </button>
          </div>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {creating ? (
          <section className={styles.card}>
            <ProjectForm
              initial={EMPTY_FORM}
              clients={clients}
              submitLabel="Create project"
              busy={busy}
              onCancel={() => setCreating(false)}
              onSubmit={async (values) => {
                if (await submit("POST", "/api/projects", toPayload(values))) setCreating(false);
              }}
            />
          </section>
        ) : null}

        <section className={styles.card}>
          {projects === null ? (
            <div className={styles.loader}><LoaderCircle size={15} /> Loading projects…</div>
          ) : visible.length === 0 ? (
            <div className={styles.empty}>
              {showArchived ? "No projects yet." : "No active projects. New project, or show archived."}
            </div>
          ) : (
            <div className={styles.list}>
              {visible.map((project) => (
                <div key={project.id} className={`${styles.row} ${project.isArchived ? styles.rowArchived : ""}`}>
                  <div className={styles.rowHead}>
                    <div>
                      <div className={styles.rowTitle}>{project.name}</div>
                      <div className={styles.rowMeta}>
                        {[
                          project.clientId ? clientNameById.get(project.clientId) ?? "Unknown client" : "Unassigned",
                          project.hourlyRateOverride != null ? `$${project.hourlyRateOverride}/hr override` : null,
                          project.urgent ? "urgent" : null,
                          project.important ? "important" : null
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <span
                        className={`${styles.statusChip} ${project.status === "active" && !project.isArchived ? styles.statusActive : ""}`}
                      >
                        {project.isArchived ? "archived" : statusLabel(project.status)}
                      </span>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonQuiet}`}
                        onClick={() => setEditingId((current) => (current === project.id ? null : project.id))}
                      >
                        {editingId === project.id ? "Close" : "Edit"}
                      </button>
                      {project.isArchived ? (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.buttonQuiet}`}
                          disabled={busy}
                          onClick={() => void submit("PUT", `/api/projects/${project.id}`, { isArchived: false })}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.buttonDanger}`}
                          disabled={busy}
                          onClick={() => void submit("DELETE", `/api/projects/${project.id}`)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                  {editingId === project.id ? (
                    <ProjectForm
                      key={project.updatedAt}
                      initial={toForm(project)}
                      clients={clients}
                      submitLabel="Save changes"
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        if (await submit("PUT", `/api/projects/${project.id}`, toPayload(values))) setEditingId(null);
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
