"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, FileText, Paperclip, Pencil, Plus, Repeat2, Search, Trash2, WalletCards } from "lucide-react";
import { DataTable, type LedgerColumn } from "@/components/transactions/data-table";
import { DeleteDialog } from "@/components/transactions/delete-dialog";
import { FilterBar, FilterField, type ActiveFilter } from "@/components/transactions/filter-bar";
import { RecordSheet } from "@/components/transactions/record-sheet";
import { TransactionPage, TransactionPageHeader } from "@/components/transactions/transaction-page";
import styles from "@/components/transactions/transaction-ledger.module.css";
import type {
  ChartAccount,
  Client,
  Expense,
  ExpenseFrequency,
  ExpenseKind,
  ExpenseRecentDefaults,
  Project,
  RecurringExpense,
  RecurringExpenseStatus
} from "@/lib/types";

type Direction = "asc" | "desc";
type ExpenseSort = "date" | "amount" | "kind" | "category" | "company" | "vendor" | "details" | "accountCode" | "billable" | "reimbursable" | "recurring" | "paymentMethod" | "status" | "annualizedAmount" | "createdAt" | "updatedAt";
type Tab = "entries" | "recurring";

type ExpenseFilters = {
  page: number; pageSize: number; sort: ExpenseSort; direction: Direction;
  search: string; from: string; to: string; kind: string; category: string; clientId: string;
  projectId: string; receiptAttached: string; id: string; mcId: string; recurringExpenseId: string;
  amountMin: string; amountMax: string; company: string; vendor: string; details: string;
  accountCode: string; billable: string; reimbursable: string; recurring: string;
  recurringDayMin: string; recurringDayMax: string; paymentMethod: string; status: string;
  tags: string; receiptName: string; annualizedMin: string; annualizedMax: string;
  createdFrom: string; createdTo: string; updatedFrom: string; updatedTo: string;
};

type PageInfo = { page: number; pageSize: number; totalItems: number; totalPages: number; hasPreviousPage: boolean; hasNextPage: boolean };
type Totals = { records: number; expenses: number; income: number; reimbursable: number; net: number };
type ExpenseFacets = { categories: Array<{ value: string; count: number }>; companies: Array<{ value: string; count: number }>; paymentMethods: Array<{ value: string; count: number }>; statuses: Array<{ value: string; count: number }> };

type ExpenseFormValues = {
  date: string; amount: string; kind: ExpenseKind; vendor: string; category: string; paymentMethod: string;
  clientId: string; projectId: string; billable: boolean; reimbursable: boolean; details: string;
  company: string; accountCode: string; status: string; tags: string; recurring: ExpenseFrequency; recurringDay: string;
};

type RecurringValues = {
  description: string; vendor: string; amount: string; category: string; company: string;
  frequency: Exclude<ExpenseFrequency, "none">; dayOfMonth: string; startDate: string; endDate: string;
  status: RecurringExpenseStatus; paymentMethod: string; notes: string;
};

const DEFAULT_FILTERS: ExpenseFilters = {
  page: 1, pageSize: 50, sort: "date", direction: "desc", search: "", from: "", to: "", kind: "",
  category: "", clientId: "", projectId: "", receiptAttached: "", id: "", mcId: "", recurringExpenseId: "",
  amountMin: "", amountMax: "", company: "", vendor: "", details: "", accountCode: "", billable: "",
  reimbursable: "", recurring: "", recurringDayMin: "", recurringDayMax: "", paymentMethod: "", status: "",
  tags: "", receiptName: "", annualizedMin: "", annualizedMax: "", createdFrom: "", createdTo: "",
  updatedFrom: "", updatedTo: ""
};
const FILTER_KEYS = Object.keys(DEFAULT_FILTERS) as Array<keyof ExpenseFilters>;
const EMPTY_PAGE: PageInfo = { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasPreviousPage: false, hasNextPage: false };
const EMPTY_TOTALS: Totals = { records: 0, expenses: 0, income: 0, reimbursable: 0, net: 0 };
const SUGGESTED_CATEGORIES = ["Software", "Meals", "Travel", "Advertising", "Office", "Contract Labor", "Other"];

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
function money(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function friendlyDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date) : value;
}
function useDebouncedValue(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return debounced;
}

function filtersFromUrl(): ExpenseFilters {
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
  const savedPageSize = Number(window.localStorage.getItem("transaction-ledger.expenses.page-size"));
  if (!params.has("pageSize") && [25, 50, 100].includes(savedPageSize)) result.pageSize = savedPageSize;
  return result;
}

function queryString(filters: ExpenseFilters): string {
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

function blankExpense(defaults: ExpenseRecentDefaults | null): ExpenseFormValues {
  return { date: todayKey(), amount: "", kind: "expense", vendor: "", category: defaults?.category || "Software",
    paymentMethod: defaults?.paymentMethod || "", clientId: "", projectId: "", billable: false, reimbursable: false,
    details: "", company: defaults?.company || "Marketing Bull", accountCode: defaults?.accountCode || "",
    status: "", tags: "", recurring: "none", recurringDay: "" };
}
function expenseForm(entry: Expense, duplicate = false): ExpenseFormValues {
  return { date: duplicate ? todayKey() : entry.date, amount: String(entry.amount), kind: entry.kind, vendor: entry.vendor,
    category: entry.category, paymentMethod: entry.paymentMethod, clientId: entry.clientId || "", projectId: entry.projectId || "",
    billable: entry.billable, reimbursable: entry.reimbursable, details: entry.details, company: entry.company,
    accountCode: entry.accountCode || "", status: entry.status, tags: entry.tags, recurring: entry.recurring,
    recurringDay: entry.recurringDay == null ? "" : String(entry.recurringDay) };
}
function expensePayload(values: ExpenseFormValues) {
  return { ...values, amount: Number(values.amount), clientId: values.clientId || null, projectId: values.projectId || null,
    accountCode: values.accountCode || null, recurringDay: values.recurringDay ? Number(values.recurringDay) : null };
}
function blankRecurring(): RecurringValues { return { description: "", vendor: "", amount: "", category: "Software", company: "Marketing Bull", frequency: "monthly", dayOfMonth: "1", startDate: todayKey(), endDate: "", status: "active", paymentMethod: "", notes: "" }; }
function recurringForm(entry: RecurringExpense): RecurringValues { return { description: entry.description, vendor: entry.vendor, amount: String(entry.amount), category: entry.category, company: entry.company, frequency: entry.frequency, dayOfMonth: entry.dayOfMonth == null ? "" : String(entry.dayOfMonth), startDate: entry.startDate, endDate: entry.endDate || "", status: entry.status, paymentMethod: entry.paymentMethod, notes: entry.notes }; }
function recurringPayload(values: RecurringValues) { return { ...values, amount: Number(values.amount), dayOfMonth: values.dayOfMonth ? Number(values.dayOfMonth) : null, endDate: values.endDate || null }; }

function ExpenseForm({ formId, initial, clients, projects, accounts, categories, existingReceipt, uploading, onDirtyChange, onSubmit }:
  { formId: string; initial: ExpenseFormValues; clients: Client[]; projects: Project[]; accounts: ChartAccount[]; categories: string[]; existingReceipt?: string | null; uploading: boolean; onDirtyChange: (dirty: boolean) => void; onSubmit: (values: ExpenseFormValues, receipt: File | null, addAnother: boolean) => void }) {
  const [values, setValues] = useState(initial); const [receipt, setReceipt] = useState<File | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial) || receipt !== null;
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  const selectableProjects = projects.filter((project) => !values.clientId || project.clientId === values.clientId || project.id === values.projectId);
  return <form id={formId} className={styles.sheetForm} onSubmit={(event) => {
    event.preventDefault(); const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    onSubmit(values, receipt, submitter?.value === "another");
  }}>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Date</span><input className={styles.input} type="date" value={values.date} required onChange={(event) => setValues((current) => ({ ...current, date: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Amount</span><input className={styles.input} type="number" min="0.01" step="0.01" inputMode="decimal" value={values.amount} required autoFocus onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Type</span><select className={styles.select} value={values.kind} onChange={(event) => setValues((current) => ({ ...current, kind: event.target.value as ExpenseKind }))}><option value="expense">Expense</option><option value="income">Income</option></select></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Vendor</span><input className={styles.input} value={values.vendor} placeholder="Who was paid?" onChange={(event) => setValues((current) => ({ ...current, vendor: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Category</span><input className={styles.input} list="expense-categories" value={values.category} required onChange={(event) => setValues((current) => ({ ...current, category: event.target.value }))} /><datalist id="expense-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Payment method</span><input className={styles.input} value={values.paymentMethod} placeholder="Card, ACH, cash…" onChange={(event) => setValues((current) => ({ ...current, paymentMethod: event.target.value }))} /></label>
    <label className={`${styles.sheetField} ${styles.spanAll}`}><span className={styles.fieldLabel}>Details</span><textarea className={styles.textarea} value={values.details} placeholder="What was this for?" onChange={(event) => setValues((current) => ({ ...current, details: event.target.value }))} /></label>
    <label className={styles.receiptField}><span className={styles.fieldLabel}>Receipt</span><input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setReceipt(event.target.files?.[0] || null)} />
      <span className={styles.receiptHint}>{receipt ? `${receipt.name} · ${Math.max(1, Math.round(receipt.size / 1024))} KB ready to upload` : existingReceipt ? `${existingReceipt} is attached. Choose a new file to replace it.` : "Use the phone camera, photo library, or file picker. PDF, JPEG, PNG, or WebP up to 10 MB."}</span>
      {uploading ? <><progress className={styles.uploadProgress} aria-label="Uploading receipt" /><span className={styles.receiptHint}>Uploading receipt…</span></> : null}</label>
    <p className={styles.sheetSectionLabel}>Assignment</p>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Client</span><select className={styles.select} value={values.clientId} onChange={(event) => { const clientId = event.target.value; setValues((current) => ({ ...current, clientId, projectId: projects.some((project) => project.id === current.projectId && project.clientId === clientId) ? current.projectId : "" })); }}><option value="">Unassigned</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.isArchived ? " (archived)" : ""}</option>)}</select></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Project</span><select className={styles.select} value={values.projectId} onChange={(event) => { const project = projects.find((candidate) => candidate.id === event.target.value); setValues((current) => ({ ...current, projectId: event.target.value, clientId: project?.clientId ?? current.clientId })); }}><option value="">No project</option>{selectableProjects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.isArchived ? " (archived)" : ""}</option>)}</select></label>
    <label className={styles.toggleField}><span>Billable</span><input type="checkbox" checked={values.billable} onChange={(event) => setValues((current) => ({ ...current, billable: event.target.checked }))} /></label>
    <label className={styles.toggleField}><span>Reimbursable</span><input type="checkbox" checked={values.reimbursable} onChange={(event) => setValues((current) => ({ ...current, reimbursable: event.target.checked }))} /></label>
    <details className={styles.detailsDisclosure}><summary>More details</summary><div className={styles.detailsGrid}>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Company</span><input className={styles.input} value={values.company} onChange={(event) => setValues((current) => ({ ...current, company: event.target.value }))} /></label>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Account code</span><select className={styles.select} value={values.accountCode} onChange={(event) => setValues((current) => ({ ...current, accountCode: event.target.value }))}><option value="">Unmapped</option>{accounts.map((account) => <option key={account.accountCode} value={account.accountCode}>{account.accountCode} · {account.category}</option>)}</select></label>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Status</span><input className={styles.input} value={values.status} onChange={(event) => setValues((current) => ({ ...current, status: event.target.value }))} /></label>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Tags</span><input className={styles.input} value={values.tags} onChange={(event) => setValues((current) => ({ ...current, tags: event.target.value }))} /></label>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Recurring</span><select className={styles.select} value={values.recurring} onChange={(event) => setValues((current) => ({ ...current, recurring: event.target.value as ExpenseFrequency }))}><option value="none">One-time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
      <label className={styles.sheetField}><span className={styles.fieldLabel}>Recurring day</span><input className={styles.input} type="number" min="1" max="31" value={values.recurringDay} onChange={(event) => setValues((current) => ({ ...current, recurringDay: event.target.value }))} /></label>
    </div></details>
  </form>;
}

function RecurringForm({ formId, initial, onDirtyChange, onSubmit }: { formId: string; initial: RecurringValues; onDirtyChange: (dirty: boolean) => void; onSubmit: (values: RecurringValues) => void }) {
  const [values, setValues] = useState(initial); const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  return <form id={formId} className={styles.sheetForm} onSubmit={(event) => { event.preventDefault(); onSubmit(values); }}>
    <label className={`${styles.sheetField} ${styles.spanAll}`}><span className={styles.fieldLabel}>Description</span><input className={styles.input} value={values.description} required autoFocus onChange={(event) => setValues((current) => ({ ...current, description: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Amount</span><input className={styles.input} type="number" min="0.01" step="0.01" inputMode="decimal" value={values.amount} required onChange={(event) => setValues((current) => ({ ...current, amount: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Frequency</span><select className={styles.select} value={values.frequency} onChange={(event) => setValues((current) => ({ ...current, frequency: event.target.value as RecurringValues["frequency"] }))}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Vendor</span><input className={styles.input} value={values.vendor} onChange={(event) => setValues((current) => ({ ...current, vendor: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Category</span><input className={styles.input} value={values.category} required onChange={(event) => setValues((current) => ({ ...current, category: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Starts</span><input className={styles.input} type="date" value={values.startDate} required onChange={(event) => setValues((current) => ({ ...current, startDate: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Ends</span><input className={styles.input} type="date" value={values.endDate} onChange={(event) => setValues((current) => ({ ...current, endDate: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Day of month</span><input className={styles.input} type="number" min="1" max="31" value={values.dayOfMonth} onChange={(event) => setValues((current) => ({ ...current, dayOfMonth: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Status</span><select className={styles.select} value={values.status} onChange={(event) => setValues((current) => ({ ...current, status: event.target.value as RecurringExpenseStatus }))}><option value="active">Active</option><option value="paused">Paused</option><option value="cancelled">Cancelled</option></select></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Company</span><input className={styles.input} value={values.company} onChange={(event) => setValues((current) => ({ ...current, company: event.target.value }))} /></label>
    <label className={styles.sheetField}><span className={styles.fieldLabel}>Payment method</span><input className={styles.input} value={values.paymentMethod} onChange={(event) => setValues((current) => ({ ...current, paymentMethod: event.target.value }))} /></label>
    <label className={`${styles.sheetField} ${styles.spanAll}`}><span className={styles.fieldLabel}>Notes</span><textarea className={styles.textarea} value={values.notes} onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))} /></label>
  </form>;
}

export default function ExpensesPage() {
  const [ready, setReady] = useState(false); const [tab, setTab] = useState<Tab>("entries");
  const [filters, setFilters] = useState<ExpenseFilters>(DEFAULT_FILTERS); const [advancedOpen, setAdvancedOpen] = useState(false);
  const [entries, setEntries] = useState<Expense[]>([]); const [recurring, setRecurring] = useState<RecurringExpense[]>([]);
  const [pageInfo, setPageInfo] = useState<PageInfo>(EMPTY_PAGE); const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [facets, setFacets] = useState<ExpenseFacets>({ categories: [], companies: [], paymentMethods: [], statuses: [] });
  const [clients, setClients] = useState<Client[]>([]); const [projects, setProjects] = useState<Project[]>([]); const [accounts, setAccounts] = useState<ChartAccount[]>([]);
  const [defaults, setDefaults] = useState<ExpenseRecentDefaults | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false); const [error, setError] = useState<string | null>(null);
  const [sheetMode, setSheetMode] = useState<"create" | "edit" | null>(null); const [editingEntry, setEditingEntry] = useState<Expense | null>(null);
  const [editingRecurring, setEditingRecurring] = useState<RecurringExpense | null>(null); const [pendingExpenseId, setPendingExpenseId] = useState<string | null>(null);
  const [formSeed, setFormSeed] = useState<ExpenseFormValues | null>(null); const [recurringSeed, setRecurringSeed] = useState<RecurringValues | null>(null);
  const [formKey, setFormKey] = useState(0); const [formDirty, setFormDirty] = useState(false);
  const [deleteEntry, setDeleteEntry] = useState<Expense | null>(null); const [deleteRecurring, setDeleteRecurring] = useState<RecurringExpense | null>(null);
  const debouncedSearch = useDebouncedValue(filters.search, 300); const debouncedVendor = useDebouncedValue(filters.vendor, 300);
  const debouncedDetails = useDebouncedValue(filters.details, 300); const debouncedTags = useDebouncedValue(filters.tags, 300);
  const requestQuery = queryString({ ...filters, search: debouncedSearch, vendor: debouncedVendor, details: debouncedDetails, tags: debouncedTags });

  const patchFilters = useCallback((patch: Partial<ExpenseFilters>, keepPage = false) => setFilters((current) => ({ ...current, ...patch, page: keepPage && patch.page !== undefined ? patch.page : 1 })), []);
  useEffect(() => { const timer = window.setTimeout(() => { setFilters(filtersFromUrl()); setReady(true); }, 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => { if (!ready || tab !== "entries") return; window.history.replaceState(null, "", `${window.location.pathname}?${queryString(filters)}`); window.localStorage.setItem("transaction-ledger.expenses.page-size", String(filters.pageSize)); }, [filters, ready, tab]);

  useEffect(() => { const run = async () => { try {
    const [clientsResponse, projectsResponse] = await Promise.all([fetch("/api/clients?includeArchived=1", { cache: "no-store" }), fetch("/api/projects?includeArchived=1", { cache: "no-store" })]);
    if (redirectedToLogin(clientsResponse) || redirectedToLogin(projectsResponse)) return;
    const [clientsJson, projectsJson] = await Promise.all([clientsResponse.json(), projectsResponse.json()]);
    if (!clientsResponse.ok || !projectsResponse.ok) throw new Error("Client/project fetch failed");
    setClients(Array.isArray(clientsJson?.clients) ? clientsJson.clients : []); setProjects(Array.isArray(projectsJson?.projects) ? projectsJson.projects : []);
  } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); } }; void run(); }, []);

  const loadEntries = useCallback(async (signal?: AbortSignal) => { if (!ready) return; setLoading(true); setError(null); try {
    const response = await fetch(`/api/expenses?${requestQuery}`, { cache: "no-store", signal }); if (redirectedToLogin(response)) return;
    const json = await response.json(); if (!response.ok) throw new Error(json?.error || "Expenses fetch failed");
    setEntries(Array.isArray(json?.items) ? json.items : []); setPageInfo(json?.pageInfo ?? EMPTY_PAGE); setTotals(json?.filteredTotals ?? EMPTY_TOTALS);
    setFacets(json?.availableFacets ?? { categories: [], companies: [], paymentMethods: [], statuses: [] });
    setRecurring(Array.isArray(json?.recurringExpenses) ? json.recurringExpenses : []); setAccounts(Array.isArray(json?.accounts) ? json.accounts : []); setDefaults(json?.recentDefaults ?? null);
  } catch (caught) { if (caught instanceof DOMException && caught.name === "AbortError") return; setError(caught instanceof Error ? caught.message : String(caught)); }
  finally { if (!signal?.aborted) setLoading(false); } }, [ready, requestQuery]);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void loadEntries(controller.signal), 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [loadEntries]);

  async function mutate(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<{ success: boolean; expenseId?: string }> {
    setBusy(true); setError(null); try { const response = await fetch(path, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      if (redirectedToLogin(response)) return { success: false }; const json = await response.json().catch(() => null); if (!response.ok) throw new Error(json?.error || `${method} failed (${response.status})`);
      await loadEntries(); return { success: true, expenseId: json?.expense?.id };
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return { success: false }; } finally { setBusy(false); }
  }
  async function uploadReceipt(expenseId: string, receipt: File): Promise<boolean> { setUploading(true); setError(null); try {
    const form = new FormData(); form.set("receipt", receipt); const response = await fetch(`/api/expenses/${expenseId}/receipt`, { method: "POST", body: form });
    if (redirectedToLogin(response)) return false; const json = await response.json().catch(() => null); if (!response.ok) throw new Error(json?.error || "Receipt upload failed"); await loadEntries(); return true;
  } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); return false; } finally { setUploading(false); } }

  const clientNames = useMemo(() => new Map(clients.map((client) => [client.id, client.name])), [clients]);
  const projectNames = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const activeProjects = useMemo(() => projects.filter((project) => !filters.clientId || project.clientId === filters.clientId), [projects, filters.clientId]);
  const categories = useMemo(() => Array.from(new Set([...SUGGESTED_CATEGORIES, ...facets.categories.map((item) => item.value), ...recurring.map((item) => item.category)])).filter(Boolean).sort(), [facets.categories, recurring]);

  const activeFilters = useMemo<ActiveFilter[]>(() => { const result: ActiveFilter[] = []; const add = (id: keyof ExpenseFilters, label: string) => { if (!filters[id] || filters[id] === DEFAULT_FILTERS[id]) return; result.push({ id, label, onRemove: () => patchFilters({ [id]: DEFAULT_FILTERS[id] }) }); };
    add("search", `Search: ${filters.search}`); add("from", `From: ${filters.from}`); add("to", `To: ${filters.to}`); add("kind", `Type: ${filters.kind}`); add("category", `Category: ${filters.category}`);
    add("clientId", `Client: ${clientNames.get(filters.clientId) ?? filters.clientId}`); add("projectId", `Project: ${projectNames.get(filters.projectId) ?? filters.projectId}`);
    add("receiptAttached", `Receipt: ${filters.receiptAttached === "true" ? "Attached" : "Missing"}`);
    const labels: Array<[keyof ExpenseFilters, string]> = [["id","Entry ID"],["mcId","Imported ID"],["recurringExpenseId","Recurring ID"],["amountMin","Min amount"],["amountMax","Max amount"],["company","Company"],["vendor","Vendor"],["details","Details"],["accountCode","Account"],["billable","Billable"],["reimbursable","Reimbursable"],["recurring","Recurring"],["recurringDayMin","Min recurring day"],["recurringDayMax","Max recurring day"],["paymentMethod","Payment"],["status","Status"],["tags","Tags"],["receiptName","Receipt name"],["annualizedMin","Min annualized"],["annualizedMax","Max annualized"],["createdFrom","Created from"],["createdTo","Created to"],["updatedFrom","Updated from"],["updatedTo","Updated to"]];
    for (const [key, label] of labels) add(key, `${label}: ${filters[key]}`); return result;
  }, [filters, clientNames, projectNames, patchFilters]);

  function openCreate(seed?: ExpenseFormValues) { setEditingEntry(null); setEditingRecurring(null); setPendingExpenseId(null); setFormSeed(seed ?? blankExpense(defaults)); setRecurringSeed(null); setFormKey((current) => current + 1); setFormDirty(false); setSheetMode("create"); }
  function openEdit(entry: Expense) { setEditingEntry(entry); setEditingRecurring(null); setPendingExpenseId(null); setFormSeed(expenseForm(entry)); setRecurringSeed(null); setFormKey((current) => current + 1); setFormDirty(false); setSheetMode("edit"); }
  function openRecurringCreate() { setEditingEntry(null); setEditingRecurring(null); setPendingExpenseId(null); setRecurringSeed(blankRecurring()); setFormSeed(null); setFormKey((current) => current + 1); setFormDirty(false); setSheetMode("create"); }
  function openRecurringEdit(entry: RecurringExpense) { setEditingEntry(null); setEditingRecurring(entry); setPendingExpenseId(null); setRecurringSeed(recurringForm(entry)); setFormSeed(null); setFormKey((current) => current + 1); setFormDirty(false); setSheetMode("edit"); }

  const columns: LedgerColumn<Expense, ExpenseSort>[] = [
    { id: "date", label: "Date", sort: "date", render: (entry) => <span className={styles.primaryCell}>{friendlyDate(entry.date)}</span> },
    { id: "vendor", label: "Vendor / details", sort: "vendor", className: styles.detailsCell, render: (entry) => <><span className={styles.primaryCell}>{entry.vendor || entry.details || entry.category}</span>{entry.vendor && entry.details ? <div className={styles.secondaryText}>{entry.details}</div> : null}</> },
    { id: "kind", label: "Type", sort: "kind", render: (entry) => <span className={`${styles.status} ${entry.kind === "income" ? styles.kindIncome : ""}`}>{entry.kind === "income" ? "Income" : "Expense"}</span> },
    { id: "category", label: "Category", sort: "category", render: (entry) => entry.category },
    { id: "assignment", label: "Client / project", render: (entry) => projectNames.get(entry.projectId || "") ?? clientNames.get(entry.clientId || "") ?? <span className={styles.secondaryText}>Unassigned</span> },
    { id: "amount", label: "Amount", sort: "amount", align: "right", render: (entry) => <span className={styles.primaryCell}>{money(entry.amount)}</span> },
    { id: "payment", label: "Payment", sort: "paymentMethod", render: (entry) => entry.paymentMethod || <span className={styles.secondaryText}>—</span> },
    { id: "status", label: "Status", sort: "status", render: (entry) => entry.status || <span className={styles.secondaryText}>—</span> },
    { id: "receipt", label: "Receipt", render: (entry) => entry.receiptPath ? <a className={styles.receiptLink} href={`/api/expenses/${entry.id}/receipt`} target="_blank" rel="noreferrer"><FileText size={14} /> View</a> : <span className={styles.secondaryText}>Missing</span> },
    { id: "actions", label: "Actions", align: "right", render: (entry) => <div className={styles.rowActions}><button type="button" className={styles.iconButton} onClick={() => openEdit(entry)} aria-label={`Edit ${friendlyDate(entry.date)} expense`}><Pencil size={15} /></button><button type="button" className={styles.iconButton} onClick={() => openCreate(expenseForm(entry, true))} aria-label={`Duplicate ${friendlyDate(entry.date)} expense`}><Copy size={15} /></button><button type="button" className={styles.iconButton} onClick={() => setDeleteEntry(entry)} aria-label={`Delete ${friendlyDate(entry.date)} expense`}><Trash2 size={15} /></button></div> }
  ];
  const formId = `expense-form-${formKey}`; const hasAnyRecords = pageInfo.totalItems > 0 || activeFilters.length === 0;

  return <TransactionPage>
    <TransactionPageHeader title="Expenses" metrics={tab === "entries" ? [{ label: "filtered net", value: money(totals.net) }, { label: "filtered records", value: pageInfo.totalItems }] : [{ label: "active annual", value: money(recurring.filter((item) => item.status === "active").reduce((sum, item) => sum + item.annualizedAmount, 0)) }, { label: "definitions", value: recurring.length }]} action={<button type="button" className={styles.primaryButton} onClick={() => tab === "entries" ? openCreate() : openRecurringCreate()}><Plus size={16} /> {tab === "entries" ? "Add expense" : "Add recurring"}</button>} />
    <div className={styles.tabBar} role="tablist" aria-label="Expense views"><button type="button" role="tab" aria-selected={tab === "entries"} className={`${styles.tabButton} ${tab === "entries" ? styles.tabButtonActive : ""}`} onClick={() => { setTab("entries"); setSheetMode(null); }}><WalletCards size={15} /> Transactions</button><button type="button" role="tab" aria-selected={tab === "recurring"} className={`${styles.tabButton} ${tab === "recurring" ? styles.tabButtonActive : ""}`} onClick={() => { setTab("recurring"); setSheetMode(null); }}><Repeat2 size={15} /> Recurring ({recurring.length})</button></div>
    {error ? <div className={styles.errorBanner}><span>{error}</span><button type="button" className={styles.quietButton} onClick={() => void loadEntries()}>Retry</button></div> : null}
    {tab === "entries" ? <>
      <FilterBar advancedOpen={advancedOpen} onToggleAdvanced={() => setAdvancedOpen((current) => !current)} activeFilters={activeFilters} onClear={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))} advanced={<>
        <div className={styles.filterMobileOnly}><FilterField label="Type"><select className={styles.select} value={filters.kind} onChange={(event) => patchFilters({ kind: event.target.value })}><option value="">All types</option><option value="expense">Expenses</option><option value="income">Income</option></select></FilterField></div>
        <div className={styles.filterTabletOnly}><FilterField label="Category"><select className={styles.select} value={filters.category} onChange={(event) => patchFilters({ category: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></FilterField></div>
        <FilterField label="Client"><select className={styles.select} value={filters.clientId} onChange={(event) => patchFilters({ clientId: event.target.value, projectId: "" })}><option value="">All clients</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></FilterField>
        <FilterField label="Project"><select className={styles.select} value={filters.projectId} onChange={(event) => patchFilters({ projectId: event.target.value })}><option value="">All projects</option>{activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></FilterField>
        <div className={styles.filterTabletOnly}><FilterField label="Receipt"><select className={styles.select} value={filters.receiptAttached} onChange={(event) => patchFilters({ receiptAttached: event.target.value })}><option value="">Any receipt</option><option value="true">Attached</option><option value="false">Missing</option></select></FilterField></div>
        <FilterField label="Entry ID"><input className={styles.input} value={filters.id} onChange={(event) => patchFilters({ id: event.target.value })} /></FilterField><FilterField label="Imported ID"><input className={styles.input} inputMode="numeric" value={filters.mcId} onChange={(event) => patchFilters({ mcId: event.target.value })} /></FilterField><FilterField label="Recurring ID"><input className={styles.input} value={filters.recurringExpenseId} onChange={(event) => patchFilters({ recurringExpenseId: event.target.value })} /></FilterField>
        <FilterField label="Min amount"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.amountMin} onChange={(event) => patchFilters({ amountMin: event.target.value })} /></FilterField><FilterField label="Max amount"><input className={styles.input} type="number" inputMode="decimal" min="0" value={filters.amountMax} onChange={(event) => patchFilters({ amountMax: event.target.value })} /></FilterField>
        <FilterField label="Company"><select className={styles.select} value={filters.company} onChange={(event) => patchFilters({ company: event.target.value })}><option value="">All companies</option>{facets.companies.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></FilterField><FilterField label="Vendor"><input className={styles.input} value={filters.vendor} onChange={(event) => patchFilters({ vendor: event.target.value })} /></FilterField><FilterField label="Details"><input className={styles.input} value={filters.details} onChange={(event) => patchFilters({ details: event.target.value })} /></FilterField>
        <FilterField label="Account code"><select className={styles.select} value={filters.accountCode} onChange={(event) => patchFilters({ accountCode: event.target.value })}><option value="">All accounts</option>{accounts.map((account) => <option key={account.accountCode} value={account.accountCode}>{account.accountCode} · {account.category}</option>)}</select></FilterField>
        <FilterField label="Billable"><select className={styles.select} value={filters.billable} onChange={(event) => patchFilters({ billable: event.target.value })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></FilterField><FilterField label="Reimbursable"><select className={styles.select} value={filters.reimbursable} onChange={(event) => patchFilters({ reimbursable: event.target.value })}><option value="">Any</option><option value="true">Yes</option><option value="false">No</option></select></FilterField>
        <FilterField label="Recurring"><select className={styles.select} value={filters.recurring} onChange={(event) => patchFilters({ recurring: event.target.value })}><option value="">Any</option><option value="none">One-time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></FilterField><FilterField label="Min recurring day"><input className={styles.input} type="number" min="1" max="31" value={filters.recurringDayMin} onChange={(event) => patchFilters({ recurringDayMin: event.target.value })} /></FilterField><FilterField label="Max recurring day"><input className={styles.input} type="number" min="1" max="31" value={filters.recurringDayMax} onChange={(event) => patchFilters({ recurringDayMax: event.target.value })} /></FilterField>
        <FilterField label="Payment method"><select className={styles.select} value={filters.paymentMethod} onChange={(event) => patchFilters({ paymentMethod: event.target.value })}><option value="">All methods</option>{facets.paymentMethods.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></FilterField><FilterField label="Status"><select className={styles.select} value={filters.status} onChange={(event) => patchFilters({ status: event.target.value })}><option value="">All statuses</option>{facets.statuses.map((item) => <option key={item.value} value={item.value}>{item.value}</option>)}</select></FilterField><FilterField label="Tags"><input className={styles.input} value={filters.tags} onChange={(event) => patchFilters({ tags: event.target.value })} /></FilterField>
        <FilterField label="Receipt name"><input className={styles.input} value={filters.receiptName} onChange={(event) => patchFilters({ receiptName: event.target.value })} /></FilterField><FilterField label="Min annualized"><input className={styles.input} type="number" min="0" value={filters.annualizedMin} onChange={(event) => patchFilters({ annualizedMin: event.target.value })} /></FilterField><FilterField label="Max annualized"><input className={styles.input} type="number" min="0" value={filters.annualizedMax} onChange={(event) => patchFilters({ annualizedMax: event.target.value })} /></FilterField>
        <FilterField label="Created from"><input className={styles.input} type="date" value={filters.createdFrom} onChange={(event) => patchFilters({ createdFrom: event.target.value })} /></FilterField><FilterField label="Created to"><input className={styles.input} type="date" value={filters.createdTo} onChange={(event) => patchFilters({ createdTo: event.target.value })} /></FilterField><FilterField label="Updated from"><input className={styles.input} type="date" value={filters.updatedFrom} onChange={(event) => patchFilters({ updatedFrom: event.target.value })} /></FilterField><FilterField label="Updated to"><input className={styles.input} type="date" value={filters.updatedTo} onChange={(event) => patchFilters({ updatedTo: event.target.value })} /></FilterField>
      </>}>
        <FilterField label="Search"><div style={{ position: "relative" }}><Search size={15} style={{ position: "absolute", left: 11, top: 13, color: "var(--muted)" }} /><input className={styles.input} style={{ paddingLeft: 34 }} placeholder="Search expenses" value={filters.search} onChange={(event) => patchFilters({ search: event.target.value })} /></div></FilterField>
        <FilterField label="From"><input className={styles.input} type="date" value={filters.from} onChange={(event) => patchFilters({ from: event.target.value })} /></FilterField><FilterField label="To"><input className={styles.input} type="date" value={filters.to} onChange={(event) => patchFilters({ to: event.target.value })} /></FilterField>
        <FilterField label="Type"><select className={styles.select} value={filters.kind} onChange={(event) => patchFilters({ kind: event.target.value })}><option value="">All types</option><option value="expense">Expenses</option><option value="income">Income</option></select></FilterField><FilterField label="Category"><select className={styles.select} value={filters.category} onChange={(event) => patchFilters({ category: event.target.value })}><option value="">All categories</option>{categories.map((category) => <option key={category} value={category}>{category}</option>)}</select></FilterField><FilterField label="Receipt"><select className={styles.select} value={filters.receiptAttached} onChange={(event) => patchFilters({ receiptAttached: event.target.value })}><option value="">Any receipt</option><option value="true">Attached</option><option value="false">Missing</option></select></FilterField>
      </FilterBar>
      <section className={styles.ledgerSurface} aria-busy={loading}>{loading ? <div className={styles.loadingBar} /> : null}{entries.length === 0 && !loading ? <div className={styles.emptyState}><div><h2>{hasAnyRecords ? "No expense records yet" : "No records match these filters"}</h2><p>{hasAnyRecords ? "Add the first expense or income record to start the ledger." : "Clear one or more filters to broaden the result set."}</p>{activeFilters.length > 0 ? <button type="button" className={styles.secondaryButton} onClick={() => setFilters((current) => ({ ...DEFAULT_FILTERS, pageSize: current.pageSize }))}>Clear filters</button> : <button type="button" className={styles.primaryButton} onClick={() => openCreate()}><Plus size={15} /> Add expense</button>}</div></div> : <DataTable rows={entries} columns={columns} rowKey={(entry) => entry.id} sort={filters.sort} direction={filters.direction} onSort={(sort) => patchFilters({ sort, direction: filters.sort === sort && filters.direction === "desc" ? "asc" : "desc" })} renderMobile={(entry) => <article className={styles.mobileRow}><div className={styles.mobileRowHead}><div className={styles.mobileRowTitle}>{entry.vendor || entry.details || entry.category}</div><div className={styles.rowActions}><button type="button" className={styles.iconButton} onClick={() => openEdit(entry)} aria-label="Edit expense"><Pencil size={15} /></button><button type="button" className={styles.iconButton} onClick={() => setDeleteEntry(entry)} aria-label="Delete expense"><Trash2 size={15} /></button></div></div>{entry.vendor && entry.details ? <p className={styles.mobileRowDetails}>{entry.details}</p> : null}<div className={styles.mobileRowMeta}><span>{friendlyDate(entry.date)}</span><span>{entry.category}</span><span>{money(entry.amount)}</span><span className={`${styles.status} ${entry.kind === "income" ? styles.kindIncome : ""}`}>{entry.kind === "income" ? "Income" : "Expense"}</span>{entry.receiptPath ? <span><Paperclip size={12} /> Receipt</span> : null}</div></article>} />}
        <footer className={styles.ledgerFooter}><div className={styles.footerTotals}><span className={styles.footerTotal}><strong>{money(totals.expenses)}</strong><span>expenses</span></span><span className={styles.footerTotal}><strong>{money(totals.income)}</strong><span>income</span></span><span className={styles.footerTotal}><strong>{money(totals.net)}</strong><span>net</span></span></div><div className={styles.pagination}><select className={`${styles.select} ${styles.pageSize}`} aria-label="Rows per page" value={filters.pageSize} onChange={(event) => patchFilters({ pageSize: Number(event.target.value) })}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select><span className={styles.pageStatus}>Page {pageInfo.totalPages === 0 ? 0 : pageInfo.page} of {pageInfo.totalPages}</span><button type="button" className={styles.pageButton} disabled={!pageInfo.hasPreviousPage || loading} onClick={() => patchFilters({ page: filters.page - 1 }, true)}>Previous</button><button type="button" className={styles.pageButton} disabled={!pageInfo.hasNextPage || loading} onClick={() => patchFilters({ page: filters.page + 1 }, true)}>Next</button></div></footer>
      </section>
    </> : <section className={styles.ledgerSurface}>{recurring.length === 0 ? <div className={styles.emptyState}><div><h2>No recurring definitions yet</h2><p>Create reusable recurring expense definitions without mixing them into the transaction ledger.</p><button type="button" className={styles.primaryButton} onClick={openRecurringCreate}><Plus size={15} /> Add recurring</button></div></div> : <div className={styles.mobileRows} style={{ display: "flex", flexDirection: "column" }}>{recurring.map((item) => <article key={item.id} className={styles.mobileRow}><div className={styles.mobileRowHead}><div><div className={styles.mobileRowTitle}>{item.description}</div><p className={styles.mobileRowDetails}>{item.vendor || item.category} · {money(item.amount)} {item.frequency} · {money(item.annualizedAmount)}/year</p></div><div className={styles.rowActions}><span className={`${styles.status} ${item.status === "active" ? styles.statusActive : ""}`}>{item.status}</span><button type="button" className={styles.iconButton} onClick={() => openRecurringEdit(item)} aria-label="Edit recurring expense"><Pencil size={15} /></button><button type="button" className={styles.iconButton} onClick={() => setDeleteRecurring(item)} aria-label="Delete recurring expense"><Trash2 size={15} /></button></div></div></article>)}</div>}</section>}

    <RecordSheet open={sheetMode !== null} title={tab === "recurring" ? (sheetMode === "edit" ? "Edit recurring expense" : "Add recurring expense") : (sheetMode === "edit" ? "Edit expense" : "Add expense")} subtitle={tab === "entries" && sheetMode === "create" && defaults ? "Using recent category, company, account, and payment values" : undefined} dirty={formDirty} onClose={() => setSheetMode(null)} footer={<>{tab === "entries" && sheetMode === "create" ? <button type="submit" form={formId} name="intent" value="another" className={styles.secondaryButton} disabled={busy || uploading}>Save & add another</button> : null}<button type="submit" form={formId} name="intent" value="close" className={styles.primaryButton} disabled={busy || uploading}>{uploading ? "Uploading receipt…" : busy ? "Saving…" : tab === "recurring" ? (sheetMode === "edit" ? "Save changes" : "Save recurring") : (sheetMode === "edit" ? "Save changes" : "Save expense")}</button></>}>
      {tab === "entries" && formSeed ? <ExpenseForm key={formKey} formId={formId} initial={formSeed} clients={clients} projects={projects} accounts={accounts} categories={categories} existingReceipt={editingEntry?.receiptName} uploading={uploading} onDirtyChange={setFormDirty} onSubmit={async (values, receipt, addAnother) => {
        const existingId = editingEntry?.id || pendingExpenseId; const method = existingId ? "PUT" : "POST"; const path = existingId ? `/api/expenses/${existingId}` : "/api/expenses";
        const result = await mutate(method, path, expensePayload(values)); if (!result.success) return; const expenseId = existingId || result.expenseId;
        if (!editingEntry && expenseId) setPendingExpenseId(expenseId);
        if (receipt && expenseId && !(await uploadReceipt(expenseId, receipt))) return; setFormDirty(false);
        if (addAnother) { setPendingExpenseId(null); setFormSeed({ ...values, amount: "", vendor: "", details: "" }); setFormKey((current) => current + 1); } else { setPendingExpenseId(null); setSheetMode(null); }
      }} /> : null}
      {tab === "recurring" && recurringSeed ? <RecurringForm key={formKey} formId={formId} initial={recurringSeed} onDirtyChange={setFormDirty} onSubmit={async (values) => { const result = await mutate(editingRecurring ? "PUT" : "POST", editingRecurring ? `/api/expenses/recurring/${editingRecurring.id}` : "/api/expenses/recurring", recurringPayload(values)); if (result.success) { setFormDirty(false); setSheetMode(null); } }} /> : null}
    </RecordSheet>
    <DeleteDialog open={deleteEntry !== null} title="Delete expense?" description={deleteEntry ? `${friendlyDate(deleteEntry.date)} · ${deleteEntry.vendor || deleteEntry.details || deleteEntry.category} · ${money(deleteEntry.amount)}. This cannot be undone.` : ""} confirmLabel="Delete expense" busy={busy} onCancel={() => setDeleteEntry(null)} onConfirm={async () => { if (!deleteEntry) return; const wasLastRow = entries.length === 1 && filters.page > 1; if ((await mutate("DELETE", `/api/expenses/${deleteEntry.id}`)).success) { setDeleteEntry(null); if (wasLastRow) patchFilters({ page: filters.page - 1 }, true); } }} />
    <DeleteDialog open={deleteRecurring !== null} title="Delete recurring definition?" description={deleteRecurring ? `${deleteRecurring.description} · ${money(deleteRecurring.amount)} ${deleteRecurring.frequency}. Existing transaction records stay intact.` : ""} confirmLabel="Delete recurring expense" busy={busy} onCancel={() => setDeleteRecurring(null)} onConfirm={async () => { if (deleteRecurring && (await mutate("DELETE", `/api/expenses/recurring/${deleteRecurring.id}`)).success) setDeleteRecurring(null); }} />
  </TransactionPage>;
}
