"use client";

/**
 * Clients — the first entity the dashboard owns rather than reads.
 * List, create, edit, archive; deletion does not exist (financial records
 * will hang off these rows from phase 3 on).
 */

import { useEffect, useMemo, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
import styles from "../entities.module.css";
import { CLIENT_STATUSES, PAYMENT_TYPES, type Client, type ClientStatus, type PaymentType } from "@/lib/types";

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // Hard navigation on purpose: losing the session should tear down the tree.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}

function statusLabel(status: ClientStatus): string {
  return status.replace("_", " ");
}

function money(value: number | null): string {
  if (value == null) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

type FormValues = {
  name: string;
  status: ClientStatus;
  paymentType: PaymentType;
  mrr: string;
  hourlyRate: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  paidThroughDate: string;
  invoiceStatus: string;
  notes: string;
};

const EMPTY_FORM: FormValues = {
  name: "",
  status: "active",
  paymentType: "mrr",
  mrr: "",
  hourlyRate: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  paidThroughDate: "",
  invoiceStatus: "",
  notes: ""
};

function toForm(client: Client): FormValues {
  return {
    name: client.name,
    status: client.status,
    paymentType: client.paymentType,
    mrr: client.mrr == null ? "" : String(client.mrr),
    hourlyRate: client.hourlyRate == null ? "" : String(client.hourlyRate),
    contactName: client.contactName,
    contactEmail: client.contactEmail,
    contactPhone: client.contactPhone,
    paidThroughDate: client.paidThroughDate,
    invoiceStatus: client.invoiceStatus,
    notes: client.notes
  };
}

function toPayload(form: FormValues) {
  return {
    name: form.name,
    status: form.status,
    paymentType: form.paymentType,
    mrr: form.mrr.trim() === "" ? null : Number(form.mrr),
    hourlyRate: form.hourlyRate.trim() === "" ? null : Number(form.hourlyRate),
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone,
    paidThroughDate: form.paidThroughDate,
    invoiceStatus: form.invoiceStatus,
    notes: form.notes
  };
}

function ClientForm({
  initial,
  submitLabel,
  busy,
  onSubmit,
  onCancel
}: {
  initial: FormValues;
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
        <span className={styles.label}>Status</span>
        <select className={styles.select} value={values.status} onChange={set("status")}>
          {CLIENT_STATUSES.map((status) => (
            <option key={status} value={status}>{statusLabel(status)}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Payment type</span>
        <select className={styles.select} value={values.paymentType} onChange={set("paymentType")}>
          {PAYMENT_TYPES.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.label}>MRR ($/mo)</span>
        <input className={styles.input} inputMode="decimal" value={values.mrr} onChange={set("mrr")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Hourly rate ($)</span>
        <input className={styles.input} inputMode="decimal" value={values.hourlyRate} onChange={set("hourlyRate")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Contact name</span>
        <input className={styles.input} value={values.contactName} onChange={set("contactName")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Contact email</span>
        <input className={styles.input} type="email" value={values.contactEmail} onChange={set("contactEmail")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Contact phone</span>
        <input className={styles.input} value={values.contactPhone} onChange={set("contactPhone")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Paid through</span>
        <input className={styles.input} placeholder="YYYY-MM-DD" value={values.paidThroughDate} onChange={set("paidThroughDate")} />
      </label>
      <label className={styles.field}>
        <span className={styles.label}>Invoice status</span>
        <input className={styles.input} value={values.invoiceStatus} onChange={set("invoiceStatus")} />
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

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/clients?includeArchived=1", { cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Clients fetch failed");
      setClients(Array.isArray(json?.clients) ? json.clients : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setClients([]);
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

  const visible = useMemo(
    () => (clients ?? []).filter((client) => showArchived || !client.isArchived),
    [clients, showArchived]
  );

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / CRM</p>
            <h1 className={styles.title}>Clients</h1>
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
              <Plus size={15} /> New client
            </button>
          </div>
        </header>

        {error ? <p className={styles.error}>{error}</p> : null}

        {creating ? (
          <section className={styles.card}>
            <ClientForm
              initial={EMPTY_FORM}
              submitLabel="Create client"
              busy={busy}
              onCancel={() => setCreating(false)}
              onSubmit={async (values) => {
                if (await submit("POST", "/api/clients", toPayload(values))) setCreating(false);
              }}
            />
          </section>
        ) : null}

        <section className={styles.card}>
          {clients === null ? (
            <div className={styles.loader}><LoaderCircle size={15} /> Loading clients…</div>
          ) : visible.length === 0 ? (
            <div className={styles.empty}>
              {showArchived ? "No clients yet." : "No active clients. New client, or show archived."}
            </div>
          ) : (
            <div className={styles.list}>
              {visible.map((client) => (
                <div key={client.id} className={`${styles.row} ${client.isArchived ? styles.rowArchived : ""}`}>
                  <div className={styles.rowHead}>
                    <div>
                      <div className={styles.rowTitle}>{client.name}</div>
                      <div className={styles.rowMeta}>
                        {[
                          client.mrr ? `${money(client.mrr)}/mo` : null,
                          client.hourlyRate ? `${money(client.hourlyRate)}/hr` : null,
                          client.contactName || null,
                          client.paymentType
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <span
                        className={`${styles.statusChip} ${client.status === "active" ? styles.statusActive : ""}`}
                      >
                        {client.isArchived ? "archived" : statusLabel(client.status)}
                      </span>
                      <button
                        type="button"
                        className={`${styles.button} ${styles.buttonQuiet}`}
                        onClick={() => setEditingId((current) => (current === client.id ? null : client.id))}
                      >
                        {editingId === client.id ? "Close" : "Edit"}
                      </button>
                      {client.isArchived ? (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.buttonQuiet}`}
                          disabled={busy}
                          onClick={() => void submit("PUT", `/api/clients/${client.id}`, { isArchived: false })}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`${styles.button} ${styles.buttonDanger}`}
                          disabled={busy}
                          onClick={() => void submit("DELETE", `/api/clients/${client.id}`)}
                        >
                          Archive
                        </button>
                      )}
                    </div>
                  </div>
                  {editingId === client.id ? (
                    <ClientForm
                      key={client.updatedAt}
                      initial={toForm(client)}
                      submitLabel="Save changes"
                      busy={busy}
                      onCancel={() => setEditingId(null)}
                      onSubmit={async (values) => {
                        if (await submit("PUT", `/api/clients/${client.id}`, toPayload(values))) setEditingId(null);
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
