"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Grip,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldAlert,
  Target,
  TrendingUp
} from "lucide-react";
import styles from "./owner-dashboard.module.css";
import { buildDayColumns, dayKey } from "@/lib/calendar-days";
import { normalizeDashboardData } from "@/lib/dashboard-data";
import { computeStreak, withTodaySnapshot } from "@/lib/history";
import {
  hasUnsavedChanges,
  serializeState,
  type DashboardStatePayload
} from "@/lib/dashboard-save";
import {
  DEFAULT_WIDGET_ORDER,
  HYPERFOCUS_PANEL_ID,
  isCollapsibleId,
  type CollapsibleId,
  type WidgetId
} from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type {
  CalendarEvent,
  ClickUpProject,
  Client,
  DashboardData,
  HistoryEntry,
  ManualState,
  PhoneCallItem,
  Project,
  UpNextTask
} from "@/lib/types";

function formatMoney(value: string): string {
  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(numeric)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(numeric);
}

/**
 * Hydration-safe current minute.
 *
 * The server and the client can never agree on "now", so the server snapshot is
 * null and the first client render matches it; the value appears after mount.
 * The snapshot is the minute index rather than a raw timestamp so it stays
 * stable between calls (React requires that) and re-renders at most once a
 * minute even though the subscription polls more often.
 */
const MINUTE_MS = 60_000;

function subscribeToMinute(onChange: () => void): () => void {
  const interval = setInterval(onChange, 15_000);
  return () => clearInterval(interval);
}

function getMinuteSnapshot(): number {
  return Math.floor(Date.now() / MINUTE_MS);
}

function getServerMinuteSnapshot(): null {
  return null;
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(event.startMs));
}

function formatDateCompact(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(timestamp);
}

/** Days shown in the calendar widget: today plus the next two. */
const CALENDAR_DAY_COUNT = 3;

/**
 * The proxy answers unauthenticated API calls with 401 JSON rather than the
 * login page, so the client has to do the redirecting itself.
 *
 * Kept at module scope: it closes over no state, and declaring it inside the
 * component would make every fetch callback reactive for exhaustive-deps.
 */
function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // A hard navigation, not router.push(), and not only because this sits at
  // module scope where the router hook cannot reach. Losing the session should
  // tear down the React tree: a soft navigation keeps the dashboard mounted
  // behind the login page, still holding the MRR figures and phone numbers the
  // 401 just said this client is not entitled to.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}

function createPhoneCallItem(): PhoneCallItem {
  return {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `call-${Date.now()}`,
    name: "",
    number: "",
    checked: false
  };
}

function moveWidget(order: WidgetId[], sourceId: WidgetId, targetId: WidgetId): WidgetId[] {
  if (sourceId === targetId) return order;

  const next = [...order];
  const sourceIndex = next.indexOf(sourceId);
  const targetIndex = next.indexOf(targetId);

  if (sourceIndex === -1 || targetIndex === -1) return order;

  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceId);
  return next;
}

function PriorityBadge({ priority }: { priority: UpNextTask["priority"] }) {
  return (
    <span className={`${styles.priorityBadge} ${styles[priority.toLowerCase()]}`}>
      {priority}
    </span>
  );
}

function Card({
  title,
  eyebrow,
  action,
  dragLabel,
  className,
  bodyClassName,
  collapsed = false,
  onToggleCollapse,
  children
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  dragLabel?: string;
  className?: string;
  bodyClassName?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.card} ${collapsed ? styles.cardCollapsed : ""} ${className || ""}`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.cardEyebrow}>{eyebrow}</p>
          <h2 className={styles.cardTitle}>{title}</h2>
        </div>
        <div className={styles.cardActions}>
          {/* A collapsed card hides its own status chips along with the body. */}
          {collapsed ? null : action}
          {onToggleCollapse ? (
            <button
              type="button"
              className={styles.collapseButton}
              onClick={onToggleCollapse}
              aria-expanded={!collapsed}
              aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}
              title={`${collapsed ? "Expand" : "Collapse"} ${title}`}
            >
              {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </button>
          ) : null}
          {dragLabel ? (
            <span className={styles.dragHandle} title={`Drag to move ${dragLabel}`}>
              <Grip size={14} />
            </span>
          ) : null}
        </div>
      </div>
      {collapsed ? null : <div className={`${styles.cardBody} ${bodyClassName || ""}`}>{children}</div>}
    </section>
  );
}

function formatEventDateTimeRange(event: CalendarEvent): string {
  if (event.allDay) {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric"
    }).format(new Date(event.startMs));
  }

  const start = new Date(event.startMs);
  const end = new Date(event.endMs);
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(start);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
  return `${day} · ${time.format(start)} - ${time.format(end)}`;
}

function CollectionCard({
  title,
  eyebrow,
  dragLabel,
  loadingLabel,
  emptyLabel,
  items,
  loading,
  error,
  manageHref,
  collapseProps
}: {
  title: string;
  eyebrow: string;
  dragLabel: string;
  loadingLabel: string;
  emptyLabel?: string;
  items: ClickUpProject[];
  loading: boolean;
  error: string | null;
  /** Where the full management page for this entity lives. */
  manageHref: string;
  collapseProps: { collapsed: boolean; onToggleCollapse: () => void };
}) {
  return (
    <Card
      title={title}
      eyebrow={eyebrow}
      dragLabel={dragLabel}
      {...collapseProps}
      action={
        <a href={manageHref} className={styles.inlineLinkText}>
          Manage
        </a>
      }
    >
      {loading ? (
        <div className={styles.loader}><LoaderCircle size={16} /> {loadingLabel}</div>
      ) : error ? (
        <div className={styles.error}>{error}</div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>{emptyLabel || "Nothing to show yet."}</div>
      ) : (
        <div className={styles.stack}>
          {items.map((item) => (
            <div key={item.id} className={styles.chip}>
              <div className={styles.rowBetween}>
                <div className={styles.chipTitle}>{item.title}</div>
                {item.href ? (
                  <a href={item.href} target="_blank" rel="noreferrer" className={styles.inlineLinkText}>
                    Open
                  </a>
                ) : null}
              </div>
              {item.subtitle ? <div className={styles.chipMeta}>{item.subtitle}</div> : null}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function OwnerDashboard({ version }: { version: string }) {
  const [manual, setManual] = useState<ManualState>(DEFAULT_MANUAL_STATE);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>([...DEFAULT_WIDGET_ORDER]);
  const [collapsed, setCollapsed] = useState<CollapsibleId[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // The entities the dashboard owns (consolidation phase 2), served locally.
  const [localClients, setLocalClients] = useState<Client[]>([]);
  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const [entitiesError, setEntitiesError] = useState<string | null>(null);
  const [loadingEntities, setLoadingEntities] = useState(true);
  // Assume protected until the server says otherwise, so a failed state fetch
  // never produces a false "unprotected" claim.
  const [authConfigured, setAuthConfigured] = useState(true);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [calendarFallbackReason, setCalendarFallbackReason] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [loadingState, setLoadingState] = useState(true);
  const [hoursWindow, setHoursWindow] = useState<"week" | "month">("week");
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null);
  const [draggingWidget, setDraggingWidget] = useState<WidgetId | null>(null);
  const currentMinute = useSyncExternalStore(
    subscribeToMinute,
    getMinuteSnapshot,
    getServerMinuteSnapshot
  );
  const now = currentMinute === null ? null : currentMinute * MINUTE_MS;
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const hasLoadedStateRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors the latest edits so a pending save can be flushed on demand
  // without waiting for the debounce to elapse.
  const pendingSaveRef = useRef<DashboardStatePayload | null>(null);
  // Serialized copy of what the server is known to hold. Loading state feeds
  // the same values back into the effect below, which would otherwise write
  // them straight back and report "Saved" before the user edited anything.
  const savedSnapshotRef = useRef<string | null>(null);
  const calendarWidgetRef = useRef<HTMLDivElement | null>(null);

  async function fetchDashboardState() {
    setStateError(null);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "State fetch failed");
      }
      const loadedManual = (json?.manual as ManualState) || DEFAULT_MANUAL_STATE;
      const loadedOrder = Array.isArray(json?.widgetOrder)
        ? (json.widgetOrder as WidgetId[])
        : [...DEFAULT_WIDGET_ORDER];
      const loadedCollapsed = Array.isArray(json?.collapsed) ? json.collapsed.filter(isCollapsibleId) : [];

      setManual(loadedManual);
      setWidgetOrder(loadedOrder);
      setCollapsed(loadedCollapsed);
      setHistory(Array.isArray(json?.history) ? (json.history as HistoryEntry[]) : []);
      setAuthConfigured(json?.authConfigured !== false);
      savedSnapshotRef.current = serializeState({
        manual: loadedManual,
        widgetOrder: loadedOrder,
        collapsed: loadedCollapsed
      });
      hasLoadedStateRef.current = true;
    } catch (error) {
      setStateError(error instanceof Error ? error.message : String(error));
      hasLoadedStateRef.current = true;
    } finally {
      setLoadingState(false);
    }
  }

  async function saveDashboardState(
    nextManual: ManualState,
    nextWidgetOrder: WidgetId[],
    nextCollapsed: CollapsibleId[]
  ) {
    setSaveStatus("saving");
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          manual: nextManual,
          widgetOrder: nextWidgetOrder,
          collapsed: nextCollapsed
        })
      });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "State save failed");
      }
      setStateError(null);
      // The write landed, so nothing is outstanding for a flush to send.
      pendingSaveRef.current = null;
      savedSnapshotRef.current = serializeState({
        manual: nextManual,
        widgetOrder: nextWidgetOrder,
        collapsed: nextCollapsed
      });
      setLastSavedAt(Date.now());
      setSaveStatus("saved");
    } catch (error) {
      setSaveStatus("idle");
      setStateError(error instanceof Error ? error.message : String(error));
    }
  }

  async function fetchDashboardData() {
    setDashboardError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Dashboard fetch failed");
      }
      // Normalize rather than cast: a proxied upstream can return any shape,
      // and an undefined `hours` used to crash the entire page.
      setDashboardData(normalizeDashboardData(json));
      setLastRefreshed(Date.now());
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDashboard(false);
    }
  }

  async function fetchEntities() {
    setEntitiesError(null);
    try {
      const [clientsResponse, projectsResponse] = await Promise.all([
        fetch("/api/clients", { cache: "no-store" }),
        fetch("/api/projects", { cache: "no-store" })
      ]);
      if (redirectedToLogin(clientsResponse) || redirectedToLogin(projectsResponse)) return;
      const clientsJson = await clientsResponse.json();
      const projectsJson = await projectsResponse.json();
      if (!clientsResponse.ok) throw new Error(clientsJson?.error || "Clients fetch failed");
      if (!projectsResponse.ok) throw new Error(projectsJson?.error || "Projects fetch failed");
      setLocalClients(Array.isArray(clientsJson?.clients) ? clientsJson.clients : []);
      setLocalProjects(Array.isArray(projectsJson?.projects) ? projectsJson.projects : []);
    } catch (error) {
      setEntitiesError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingEntities(false);
    }
  }

  async function fetchCalendarData() {
    setCalendarError(null);
    try {
      const response = await fetch("/api/calendar", { cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Calendar fetch failed");
      }
      setCalendarEvents(Array.isArray(json?.upcomingEvents) ? json.upcomingEvents : []);
      setCalendarFallbackReason(
        json?.source === "gog" || json?.source === "upstream" ? null : json?.fallbackReason || null
      );
      setLastRefreshed(Date.now());
    } catch (error) {
      setCalendarError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingCalendar(false);
    }
  }

  useEffect(() => {
    const run = async () => {
      await Promise.all([fetchDashboardState(), fetchDashboardData(), fetchCalendarData(), fetchEntities()]);
    };
    void run();
  }, []);


  useEffect(() => {
    if (!hasLoadedStateRef.current) return;
    if (loadingState) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Nothing actually changed (this run came from a load or a refresh), so
    // there is nothing to write and nothing to announce.
    if (!hasUnsavedChanges({ manual, widgetOrder, collapsed }, savedSnapshotRef.current)) return;

    // Record what is owed before waiting out the debounce, so a refresh (or
    // anything else that interrupts) can still flush it instead of dropping it.
    pendingSaveRef.current = { manual, widgetOrder, collapsed };

    saveTimeoutRef.current = setTimeout(() => {
      saveTimeoutRef.current = null;
      void saveDashboardState(manual, widgetOrder, collapsed);
    }, 350);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [loadingState, manual, widgetOrder, collapsed]);

  /**
   * Writes any debounced edit immediately.
   *
   * Refreshing used to discard in-flight edits: it set `loadingState`, which
   * re-ran the effect above and cancelled the pending timer, and then the
   * refetch overwrote the local value with the server's copy. Anyone who typed
   * and hit Refresh to check whether it saved lost exactly what they were
   * checking on.
   */
  async function flushPendingSave() {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }

    const pending = pendingSaveRef.current;
    if (!pending) return;

    await saveDashboardState(pending.manual, pending.widgetOrder, pending.collapsed);
  }

  function setTaskDone(taskId: string, done: boolean) {
    setDashboardData((current) =>
      current
        ? {
            ...current,
            upNext: current.upNext.map((entry) => (entry.id === taskId ? { ...entry, done } : entry))
          }
        : current
    );
  }

  /**
   * Ticking a task closes it in ClickUp.
   *
   * The box moves immediately so it feels responsive, but a failed write puts
   * it back and says why: a checkbox that stays ticked while ClickUp still has
   * the task open is worse than one that never moved.
   */
  async function toggleTaskDone(task: UpNextTask) {
    const nextDone = !task.done;
    setTaskDone(task.id, nextDone);
    setTaskError(null);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: nextDone, listId: task.listId })
      });
      if (redirectedToLogin(response)) return;
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error || `ClickUp update failed (${response.status})`);
      }
    } catch (error) {
      setTaskDone(task.id, task.done);
      setTaskError(
        `${task.title}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  function toggleCollapsed(id: CollapsibleId) {
    setCollapsed((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]
    );
  }

  /** Spread onto a Card to make it collapsible and persist the choice. */
  function collapseProps(id: CollapsibleId) {
    return {
      collapsed: collapsed.includes(id),
      onToggleCollapse: () => toggleCollapsed(id)
    };
  }

  function openFullCalendar() {
    setCalendarExpanded(true);
    window.setTimeout(() => {
      calendarWidgetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function refreshAll() {
    setLoadingDashboard(true);
    setLoadingCalendar(true);
    setLoadingState(true);
    setLoadingEntities(true);
    void (async () => {
      // Persist unsaved edits first, or the state refetch below would overwrite
      // them with the server's older copy.
      await flushPendingSave();
      await Promise.all([fetchDashboardState(), fetchDashboardData(), fetchCalendarData(), fetchEntities()]);
    })();
  }

  // Local midnight, so the columns roll over for a dashboard left open
  // overnight but do not rebuild on every clock tick. Empty before mount
  // rather than guessing a date the server and client would disagree on.
  const dayStartMs = now === null ? null : new Date(now).setHours(0, 0, 0, 0);
  const groupedDays = useMemo(
    () => (dayStartMs === null ? [] : buildDayColumns(calendarEvents, CALENDAR_DAY_COUNT, new Date(dayStartMs))),
    [calendarEvents, dayStartMs]
  );

  const hoursEntries = dashboardData?.hours[hoursWindow] ?? [];
  const maxHours = Math.max(...hoursEntries.map((entry) => entry.hours), 1);

  const isRefreshing = loadingDashboard || loadingCalendar || loadingState || loadingEntities;

  // Local entities, shaped for the chip widgets. Active first, capped so the
  // widget stays a glance; the full lists live on /clients and /projects.
  const clientNameById = useMemo(
    () => new Map(localClients.map((client) => [client.id, client.name])),
    [localClients]
  );
  const clientChips = useMemo(
    () =>
      localClients.slice(0, 6).map((client) => ({
        id: client.id,
        title: client.name,
        subtitle: [
          client.status.replace("_", " "),
          client.mrr ? `${formatMoney(String(client.mrr))}/mo` : null
        ]
          .filter(Boolean)
          .join(" · ")
      })),
    [localClients]
  );
  const projectChips = useMemo(
    () =>
      localProjects
        .filter((project) => project.status === "active")
        .slice(0, 6)
        .map((project) => ({
          id: project.id,
          title: project.name,
          subtitle: project.clientId
            ? clientNameById.get(project.clientId) ?? "Unknown client"
            : "Unassigned"
        })),
    [localProjects, clientNameById]
  );

  // `now` stays null through SSR and the first client render so the clock never
  // causes a hydration mismatch; the effect above fills it in and ticks it.
  const dateLabel = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now)
    : "Today";
  const clockLabel = now ? formatClock(now) : "--:--";
  const refreshLabel = isRefreshing
    ? "Refreshing…"
    : lastRefreshed
      ? `Refreshed ${formatClock(lastRefreshed)}`
      : "Not refreshed yet";

  // Nothing to report until the first save of the session; after that the label
  // stays visible so "did that save?" always has an answer on screen.
  const saveLabel =
    saveStatus === "saving"
      ? "Saving…"
      : saveStatus === "saved" && lastSavedAt
        ? `Saved ${formatClock(lastSavedAt)}`
        : null;

  const p0Count = dashboardData?.priorities.find((bucket) => bucket.key === "P0")?.projects.length ?? 0;
  const weekHours = (dashboardData?.hours.week ?? []).reduce((total, entry) => total + entry.hours, 0);
  const openTasks = dashboardData?.upNext.filter((task) => !task.done).length ?? 0;

  // Gated on `now` for the same hydration reason, and so "next" means next
  // relative to the ticking clock rather than page load.
  const nextEvent = useMemo(() => {
    if (now === null) return null;
    return (
      calendarEvents
        .filter((event) => event.endMs >= now)
        .sort((a, b) => a.startMs - b.startMs)[0] ?? null
    );
  }, [calendarEvents, now]);

  /**
   * Consecutive days with a daily win recorded, measured from saved history.
   *
   * Null until the clock hydrates, for the same reason as `nextEvent`: the
   * server has no local day, so computing one during SSR would mismatch.
   */
  const streak = useMemo(() => {
    if (now === null) return null;
    const today = dayKey(new Date(now));
    // Overlay what is on screen, so a win typed a moment ago counts straight
    // away instead of waiting out the save debounce.
    return computeStreak(withTodaySnapshot(history, manual, today), today);
  }, [history, manual, now]);

  const streakLabel = streak === null ? "—" : `${streak} ${streak === 1 ? "day" : "days"}`;

  const kpis = [
    {
      label: "MRR",
      value: formatMoney(manual.mrr.current),
      hint: `${manual.mrr.momDelta}% MoM · proj ${formatMoney(manual.mrr.projected)}`,
      title: undefined as string | undefined
    },
    {
      label: "P0 critical",
      value: loadingDashboard ? "—" : String(p0Count),
      hint: p0Count === 0 ? "nothing critical" : "projects need you",
      title: undefined
    },
    {
      label: "Open in Up Next",
      value: loadingDashboard ? "—" : String(openTasks),
      hint: "tasks queued",
      title: undefined
    },
    {
      label: "Hours this week",
      value: loadingDashboard ? "—" : `${Math.round(weekHours * 10) / 10}h`,
      hint: "tracked in ClickUp",
      title: undefined
    },
    {
      label: "Next up",
      value: loadingCalendar || now === null ? "—" : nextEvent ? formatEventTime(nextEvent) : "Clear",
      hint: nextEvent ? nextEvent.title : "nothing scheduled",
      title: nextEvent?.title
    }
  ];

  // Sample data that looks live is the failure mode worth shouting about, so
  // collect every route that fell back and say why.
  const fallbackNotices = [
    dashboardData?.fallbackReason ? { scope: "ClickUp", reason: dashboardData.fallbackReason } : null,
    calendarFallbackReason ? { scope: "Calendar", reason: calendarFallbackReason } : null
  ].filter((notice): notice is { scope: string; reason: string } => notice !== null);

  const widgets: Record<WidgetId, React.ReactNode> = {
    projects: (
      <Card
        title="Eisenhower Matrix"
        eyebrow="Add / prioritization"
        dragLabel="Eisenhower Matrix" {...collapseProps("projects")}
        action={<span className={styles.badge}>{dashboardData?.source === "live" ? "Live ClickUp" : "Sample"}</span>}
      >
        {loadingDashboard ? (
          <div className={styles.loader}><LoaderCircle size={16} /> Loading matrix</div>
        ) : dashboardError ? (
          <div className={styles.error}>{dashboardError}</div>
        ) : (
          <div className={styles.priorityGrid}>
            {dashboardData?.priorities.map((bucket) => (
              <div key={bucket.key} className={styles.priorityCell}>
                <div className={styles.priorityHead}>
                  <span className={styles.priorityKey}>{bucket.key}</span>
                  <span className={styles.tinyUpper}>{bucket.label}</span>
                </div>
                <div className={styles.stack}>
                  {bucket.projects.map((project) => (
                    <div key={project.id} className={styles.chip}>
                      <div className={styles.chipTitle}>{project.title}</div>
                      {project.subtitle ? <div className={styles.chipMeta}>{project.subtitle}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    ),
    activeProjects: (
      <CollectionCard
        title="Projects"
        eyebrow="Execute / active work"
        dragLabel="Projects"
        loadingLabel="Loading projects"
        emptyLabel="No active projects yet — add one on the Projects page."
        items={projectChips}
        loading={loadingEntities}
        error={entitiesError}
        manageHref="/projects"
        collapseProps={collapseProps("activeProjects")}
      />
    ),
    clients: (
      <CollectionCard
        title="Clients"
        eyebrow="CRM / owned locally"
        dragLabel="Clients"
        loadingLabel="Loading clients"
        emptyLabel="No clients yet — add one on the Clients page."
        items={clientChips}
        loading={loadingEntities}
        error={entitiesError}
        manageHref="/clients"
        collapseProps={collapseProps("clients")}
      />
    ),
    mrr: (
      <Card title="MRR" eyebrow="Multiply / scoreboard" dragLabel="MRR" {...collapseProps("mrr")}>
        <p className={styles.metric}>{formatMoney(manual.mrr.current)}</p>
        <div className={styles.inputs2}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Current MRR</span>
            <input
              className={styles.input}
              value={manual.mrr.current}
              onChange={(event) =>
                setManual((current) => ({
                  ...current,
                  mrr: { ...current.mrr, current: event.target.value }
                }))
              }
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Projected EOM</span>
            <input
              className={styles.input}
              value={manual.mrr.projected}
              onChange={(event) =>
                setManual((current) => ({
                  ...current,
                  mrr: { ...current.mrr, projected: event.target.value }
                }))
              }
            />
          </label>
        </div>
        <div className={styles.highlight}>
          <div className={styles.rowBetween}>
            <span className={styles.tinyUpper}>PCT MRR</span>
            <TrendingUp size={16} />
          </div>
          <div className={styles.highlightMetric}>{manual.mrr.momDelta}%</div>
          <p className={styles.helpText}>Using month-over-month delta for v1, with projection shown above.</p>
          <label className={styles.fieldCompact}>
            <span className={styles.fieldLabel}>MoM %</span>
            <input
              className={styles.input}
              value={manual.mrr.momDelta}
              onChange={(event) =>
                setManual((current) => ({
                  ...current,
                  mrr: { ...current.mrr, momDelta: event.target.value }
                }))
              }
            />
          </label>
        </div>
      </Card>
    ),
    hours: (
      <Card
        title="Hours by Project"
        eyebrow="Multiply / where time went"
        dragLabel="Hours by Project" {...collapseProps("hours")}
        action={
          <div className={styles.hoursToggle}>
            <button
              type="button"
              className={`${styles.toggleButton} ${hoursWindow === "week" ? styles.toggleActive : ""}`}
              onClick={() => setHoursWindow("week")}
            >
              Week
            </button>
            <button
              type="button"
              className={`${styles.toggleButton} ${hoursWindow === "month" ? styles.toggleActive : ""}`}
              onClick={() => setHoursWindow("month")}
            >
              Month
            </button>
          </div>
        }
      >
        {loadingDashboard ? (
          <div className={styles.loader}><LoaderCircle size={16} /> Loading hours</div>
        ) : dashboardError ? (
          <div className={styles.error}>{dashboardError}</div>
        ) : hoursEntries.length === 0 ? (
          <div className={styles.empty}>No tracked ClickUp hours in this window yet.</div>
        ) : (
          <div className={styles.stack}>
            {hoursEntries.map((entry) => (
              <div key={entry.label} className={styles.barRow}>
                <div className={styles.rowBetween}>
                  <span>{entry.label}</span>
                  <span className={styles.helpText}>{entry.hours}h</span>
                </div>
                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${(entry.hours / maxHours) * 100}%` }} />
                </div>
              </div>
            ))}
            <p className={styles.helpText}>
              {dashboardData?.source === "live" ? "Live ClickUp time entries grouped by list." : "Sample hour distribution."}
            </p>
          </div>
        )}
      </Card>
    ),
    calendar: (
      <Card
        title="Calendar"
        eyebrow={calendarExpanded ? "Divide / expanded schedule view" : "Divide / today + next 2 days"}
        dragLabel="Calendar" {...collapseProps("calendar")}
        className={calendarExpanded ? styles.calendarExpandedCard : undefined}
        bodyClassName={calendarExpanded ? styles.calendarExpandedBody : undefined}
        action={
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setCalendarExpanded((current) => !current)}
          >
            {calendarExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {calendarExpanded ? "Collapse" : "Expand"}
          </button>
        }
      >
        {loadingCalendar ? (
          <div className={styles.loader}><LoaderCircle size={16} /> Loading calendar</div>
        ) : calendarError ? (
          <div className={styles.error}>{calendarError}</div>
        ) : (
          <div className={`${styles.calendarGrid} ${calendarExpanded ? styles.calendarGridExpanded : ""}`}>
            {groupedDays.map((day) => (
              <div key={day.key} className={styles.dayColumn}>
                <div className={styles.rowBetween}>
                  <strong>{day.label}</strong>
                  <span className={styles.dayCount}>{day.events.length}</span>
                </div>
                <div className={styles.stack}>
                  {day.events.length === 0 ? (
                    <div className={styles.empty}>No events</div>
                  ) : (
                    day.events.map((event) => (
                      <button
                        key={event.id}
                        type="button"
                        className={`${styles.eventCard} ${styles.eventCardButton}`}
                        onClick={() => setSelectedCalendarEvent(event)}
                      >
                        <div className={styles.timeTag}>{formatEventTime(event)}</div>
                        <div className={styles.rowBetween}>
                          <p className={styles.eventTitle}>{event.title}</p>
                          {event.href ? (
                            <span className={styles.inlineLink}>
                              <ExternalLink size={12} />
                            </span>
                          ) : null}
                        </div>
                        <div className={styles.eventMeta}>
                          {event.location ? `${event.location} · ` : ""}
                          {event.calendarName}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    ),
    goals: (
      <Card title="Steps to Clear the Bottleneck" eyebrow="Add / execution path" dragLabel="Goals" {...collapseProps("goals")}>
        <div className={styles.stack}>
          {manual.goals.map((goal, index) => (
            <label key={`goal-${index}`} className={styles.goalRow}>
              <span className={styles.goalIndex}>{index + 1}</span>
              <input
                className={styles.goalInput}
                value={goal}
                onChange={(event) =>
                  setManual((current) => {
                    const nextGoals = [...current.goals] as ManualState["goals"];
                    nextGoals[index] = event.target.value;
                    return { ...current, goals: nextGoals };
                  })
                }
              />
            </label>
          ))}
        </div>
      </Card>
    ),
    upNext: (
      <Card
        title="Up Next"
        eyebrow="Add / next clearers"
        dragLabel="Up Next" {...collapseProps("upNext")}
        action={<span className={styles.badge}>{dashboardData?.source === "live" ? "Live ClickUp" : "Local only"}</span>}
      >
        {loadingDashboard ? (
          <div className={styles.loader}><LoaderCircle size={16} /> Loading tasks</div>
        ) : dashboardError ? (
          <div className={styles.error}>{dashboardError}</div>
        ) : (
          <div className={styles.stack}>
            {dashboardData?.upNext.map((task) => (
              <label key={task.id} className={styles.taskRow}>
                <input
                  className={styles.taskCheckbox}
                  type="checkbox"
                  checked={task.done}
                  onChange={() =>
                    void toggleTaskDone(task)
                  }
                />
                <div>
                  <div className={styles.rowBetween}>
                    <p className={`${styles.taskTitle} ${task.done ? styles.taskDone : ""}`}>{task.title}</p>
                    <PriorityBadge priority={task.priority} />
                  </div>
                  <div className={styles.taskMetaLine}>
                    {task.subtitle ? <span className={styles.callMeta}>{task.subtitle}</span> : null}
                    <span className={styles.callMeta}>{task.due}</span>
                    {task.href ? (
                      <a href={task.href} target="_blank" rel="noreferrer" className={styles.inlineLinkText}>
                        Open
                      </a>
                    ) : null}
                  </div>
                </div>
              </label>
            ))}
          </div>
        )}
      </Card>
    ),
    phoneCalls: (
      <Card title="Phone Calls" eyebrow="Divide / communication block" dragLabel="Phone Calls" {...collapseProps("phoneCalls")}>
        <div className={styles.callsGrid}>
          {(["toMake", "made"] as const).map((column) => (
            <div key={column} className={styles.callColumn}>
              <div className={styles.rowBetween}>
                <strong>{column === "toMake" ? "To Make" : "Made"}</strong>
                <button
                  type="button"
                  className={styles.button}
                  onClick={() =>
                    setManual((current) => ({
                      ...current,
                      phoneCalls: {
                        ...current.phoneCalls,
                        [column]: [...current.phoneCalls[column], createPhoneCallItem()]
                      }
                    }))
                  }
                >
                  <Plus size={14} />
                </button>
              </div>
              <div className={styles.stack}>
                {manual.phoneCalls[column].map((entry) => (
                  <div key={entry.id} className={styles.callItem}>
                    <div className={styles.rowBetween}>
                      <input
                        type="checkbox"
                        checked={entry.checked}
                        onChange={() =>
                          setManual((current) => ({
                            ...current,
                            phoneCalls: {
                              ...current.phoneCalls,
                              [column]: current.phoneCalls[column].map((item) =>
                                item.id === entry.id ? { ...item, checked: !item.checked } : item
                              )
                            }
                          }))
                        }
                      />
                    </div>
                    <div className={styles.stack}>
                      <input
                        className={styles.input}
                        placeholder="Name or company"
                        value={entry.name}
                        onChange={(event) =>
                          setManual((current) => ({
                            ...current,
                            phoneCalls: {
                              ...current.phoneCalls,
                              [column]: current.phoneCalls[column].map((item) =>
                                item.id === entry.id ? { ...item, name: event.target.value } : item
                              )
                            }
                          }))
                        }
                      />
                      <input
                        className={styles.input}
                        placeholder="Phone number"
                        value={entry.number}
                        onChange={(event) =>
                          setManual((current) => ({
                            ...current,
                            phoneCalls: {
                              ...current.phoneCalls,
                              [column]: current.phoneCalls[column].map((item) =>
                                item.id === entry.id ? { ...item, number: event.target.value } : item
                              )
                            }
                          }))
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    ),
    whatsImportant: (
      <Card title="What's Important" eyebrow="Execution / remove resistance" dragLabel="What's Important" {...collapseProps("whatsImportant")}>
        <div className={styles.focusPanel}>
          <div className={styles.rowBetween}>
            <strong>Self-talk / focus today</strong>
            <Target size={16} />
          </div>
          <textarea
            className={styles.focusText}
            value={manual.whatsImportant}
            onChange={(event) =>
              setManual((current) => ({
                ...current,
                whatsImportant: event.target.value
              }))
            }
          />
        </div>
      </Card>
    ),
    openSlot: (
      <Card title="Daily System Snapshot" eyebrow="4-step summary" dragLabel="Open Slot" {...collapseProps("openSlot")}>
        <div className={styles.stack}>
          <div className={styles.openIdea}>
            <span>Lens: {manual.hyperfocus.lens}</span>
            <ArrowUpRight size={15} />
          </div>
          <div className={styles.openIdea}>
            <span>Bottleneck: {manual.hyperfocus.bottleneck}</span>
            <ArrowUpRight size={15} />
          </div>
          <div className={styles.openIdea}>
            <span>Streak: {streakLabel}</span>
            <ArrowUpRight size={15} />
          </div>
          <p className={styles.helpText}>{manual.hyperfocus.multiply.dailyWin}</p>
        </div>
      </Card>
    )
  };

  const widgetLayoutClasses: Record<WidgetId, string> = {
    projects: styles.widgetMatrix,
    activeProjects: styles.widgetCollections,
    clients: styles.widgetCollections,
    mrr: styles.widgetMetric,
    hours: styles.widgetMetric,
    calendar: styles.widgetCalendar,
    goals: styles.widgetGoals,
    upNext: styles.widgetUpNext,
    phoneCalls: styles.widgetCalls,
    whatsImportant: styles.widgetImportant,
    openSlot: styles.widgetSnapshot
  };

  const todayEvents = groupedDays[0]?.events ?? [];
  const focusFields = [
    manual.hyperfocus.lens,
    manual.hyperfocus.target,
    manual.hyperfocus.bottleneck,
    manual.hyperfocus.multiply.dailyWin,
    manual.hyperfocus.divide.morning,
    manual.hyperfocus.divide.midday,
    manual.hyperfocus.divide.afternoon
  ];
  const focusCompletion = Math.round((focusFields.filter((field) => field.trim()).length / focusFields.length) * 100);

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Marketing Bull · owner workspace</p>
            <div className={styles.headerTitleRow}>
              <h1 className={styles.title}>Make the next move count.</h1>
              <span className={styles.headerDate}>{dateLabel}</span>
            </div>
            <p className={styles.headerMeta}>
              <Clock size={14} />
              <span className={styles.headerClock}>{clockLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{refreshLabel}</span>
              {saveLabel ? (
                <span className={styles.saveStatus} role="status">
                  {saveStatus === "saving" ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}
                  {saveLabel}
                </span>
              ) : null}
              {authConfigured ? null : (
                <span
                  className={styles.unprotectedChip}
                  title="No OWNER_DASHBOARD_AUTH_TOKEN is set, so anyone who can reach this address can read and edit this dashboard."
                >
                  <ShieldAlert size={13} />
                  Unprotected
                </span>
              )}
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.versionPill}>{version}</span>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                refreshAll();
              }}
              disabled={isRefreshing}
            >
              <RefreshCw size={16} className={isRefreshing ? "spin" : undefined} />
              Refresh
            </button>
          </div>
        </header>

        <section className={styles.commandDeck} aria-label="Today’s command desk">
          <div className={styles.commandMain}>
            <div className={styles.commandHeading}>
              <div>
                <p className={styles.commandEyebrow}>Today’s command desk</p>
                <h2 className={styles.commandTitle}>Set the outcome, then protect the time.</h2>
              </div>
              <span className={styles.completionPill}>{focusCompletion}% planned</span>
            </div>

            <label className={styles.commandPrimaryField}>
              <span className={styles.commandFieldLabel}>Primary outcome</span>
              <input
                className={styles.commandPrimaryInput}
                value={manual.hyperfocus.target}
                placeholder="What must be true by the end of today?"
                onChange={(event) =>
                  setManual((current) => ({
                    ...current,
                    hyperfocus: { ...current.hyperfocus, target: event.target.value }
                  }))
                }
              />
            </label>

            <div className={styles.commandFields}>
              <label className={styles.commandField}>
                <span className={styles.commandFieldLabel}>Lens</span>
                <input
                  className={styles.commandInput}
                  value={manual.hyperfocus.lens}
                  placeholder="Your focus lens"
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      hyperfocus: { ...current.hyperfocus, lens: event.target.value }
                    }))
                  }
                />
              </label>
              <label className={styles.commandField}>
                <span className={styles.commandFieldLabel}>Bottleneck to clear</span>
                <input
                  className={styles.commandInput}
                  value={manual.hyperfocus.bottleneck}
                  placeholder="The constraint worth solving"
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      hyperfocus: { ...current.hyperfocus, bottleneck: event.target.value }
                    }))
                  }
                />
              </label>
            </div>

            <div className={styles.commandSlots}>
              {(["morning", "midday", "afternoon"] as const).map((slot) => (
                <label key={slot} className={styles.commandSlot}>
                  <span className={styles.commandSlotLabel}>{slot}</span>
                  <input
                    className={styles.commandSlotInput}
                    value={manual.hyperfocus.divide[slot]}
                    placeholder="Protect this block"
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: {
                          ...current.hyperfocus,
                          divide: { ...current.hyperfocus.divide, [slot]: event.target.value }
                        }
                      }))
                    }
                  />
                </label>
              ))}
            </div>

            <div className={styles.commandFooter}>
              <div className={styles.streakBlock}>
                <span className={styles.commandFieldLabel}>Current streak</span>
                <strong>{streakLabel}</strong>
              </div>
              <label className={styles.dailyWinField}>
                <span className={styles.commandFieldLabel}>Daily win to repeat</span>
                <input
                  className={styles.commandInput}
                  value={manual.hyperfocus.multiply.dailyWin}
                  placeholder="The behavior that compounds"
                  onChange={(event) =>
                    setManual((current) => ({
                      ...current,
                      hyperfocus: {
                        ...current.hyperfocus,
                        multiply: { ...current.hyperfocus.multiply, dailyWin: event.target.value }
                      }
                    }))
                  }
                />
              </label>
            </div>
          </div>

          <aside className={styles.agendaCard}>
            <div className={styles.agendaHeader}>
              <div>
                <p className={styles.commandEyebrow}>Today’s agenda</p>
                <h2 className={styles.agendaTitle}>{todayEvents.length ? `${todayEvents.length} event${todayEvents.length === 1 ? "" : "s"}` : "Clear calendar"}</h2>
              </div>
              <span className={styles.agendaNext}>{nextEvent ? formatEventTime(nextEvent) : "Open"}</span>
            </div>
            <div className={styles.agendaList}>
              {loadingCalendar ? (
                <div className={styles.loader}><LoaderCircle size={16} /> Loading agenda</div>
              ) : calendarError ? (
                <div className={styles.error}>{calendarError}</div>
              ) : todayEvents.length === 0 ? (
                <p className={styles.agendaEmpty}>No meetings yet. Keep the important work protected.</p>
              ) : (
                todayEvents.slice(0, 4).map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    className={styles.agendaEvent}
                    onClick={() => setSelectedCalendarEvent(event)}
                  >
                    <span className={styles.agendaTime}>{formatEventTime(event)}</span>
                    <span className={styles.agendaEventContent}>
                      <strong>{event.title}</strong>
                      <span>{event.location || event.calendarName}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <button type="button" className={styles.agendaLink} onClick={openFullCalendar}>
              Open full calendar <ArrowUpRight size={14} />
            </button>
          </aside>
        </section>

        <div className={styles.kpiStrip}>
          {kpis.map((kpi) => (
            <div key={kpi.label} className={styles.kpi}>
              <p className={styles.kpiLabel}>{kpi.label}</p>
              <p className={styles.kpiValue} title={kpi.title}>
                {kpi.value}
              </p>
              <p className={styles.kpiHint}>{kpi.hint}</p>
            </div>
          ))}
        </div>

        {stateError ? <p className={styles.error}>{stateError}</p> : null}
        {taskError ? <p className={styles.error}>{taskError}</p> : null}

        {fallbackNotices.length > 0 ? (
          <div className={styles.fallbackNotice} role="status">
            <AlertTriangle size={16} className={styles.fallbackIcon} />
            <div>
              <strong>Showing sample data — these numbers are not real.</strong>
              {fallbackNotices.map((notice) => (
                <p key={notice.scope} className={styles.fallbackReason}>
                  {notice.scope}: {notice.reason}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Plan with intent</p>
            <h2 className={styles.sectionTitle}>Daily operating system</h2>
          </div>
          <p className={styles.sectionDescription}>Use the full planning canvas when you need to reset the day, remove friction, and work the constraint.</p>
        </div>

        <Card
          title="Daily Hyperfocus System"
          eyebrow="Apply the 4 steps every day"
          className={styles.systemCard}
          {...collapseProps(HYPERFOCUS_PANEL_ID)}
        >
          <div className={styles.systemGrid}>
            <div className={styles.systemStep}>
              <div className={styles.systemStepHeader}>
                <span className={styles.systemNumber}>1</span>
                <div>
                  <strong>Subtract</strong>
                  <p className={styles.helpText}>Remove friction before adding effort.</p>
                </div>
              </div>
              <div className={styles.stack}>
                {manual.hyperfocus.subtract.map((item, index) => (
                  <label key={`subtract-${index}`} className={styles.systemItem}>
                    <span className={styles.systemBullet}>-</span>
                    <input
                      className={styles.goalInput}
                      value={item}
                      onChange={(event) =>
                        setManual((current) => {
                          const subtract = [...current.hyperfocus.subtract] as ManualState["hyperfocus"]["subtract"];
                          subtract[index] = event.target.value;
                          return {
                            ...current,
                            hyperfocus: {
                              ...current.hyperfocus,
                              subtract
                            }
                          };
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.systemStep}>
              <div className={styles.systemStepHeader}>
                <span className={styles.systemNumber}>2</span>
                <div>
                  <strong>Add</strong>
                  <p className={styles.helpText}>Clarity first, then bottleneck logic.</p>
                </div>
              </div>
              <div className={styles.stack}>
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Lens</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.lens}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: { ...current.hyperfocus, lens: event.target.value }
                      }))
                    }
                  />
                </label>
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Target</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.target}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: { ...current.hyperfocus, target: event.target.value }
                      }))
                    }
                  />
                </label>
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Why</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.why}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: { ...current.hyperfocus, why: event.target.value }
                      }))
                    }
                  />
                </label>
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Bottleneck</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.bottleneck}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: { ...current.hyperfocus, bottleneck: event.target.value }
                      }))
                    }
                  />
                </label>
              </div>
            </div>

            <div className={styles.systemStep}>
              <div className={styles.systemStepHeader}>
                <span className={styles.systemNumber}>3</span>
                <div>
                  <strong>Divide</strong>
                  <p className={styles.helpText}>Give each type of work its own slot.</p>
                </div>
              </div>
              <div className={styles.stack}>
                {(["morning", "midday", "afternoon"] as const).map((slot) => (
                  <label key={slot} className={styles.fieldCompact}>
                    <span className={styles.fieldLabel}>{slot}</span>
                    <input
                      className={styles.input}
                      value={manual.hyperfocus.divide[slot]}
                      onChange={(event) =>
                        setManual((current) => ({
                          ...current,
                          hyperfocus: {
                            ...current.hyperfocus,
                            divide: {
                              ...current.hyperfocus.divide,
                              [slot]: event.target.value
                            }
                          }
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className={styles.systemStep}>
              <div className={styles.systemStepHeader}>
                <span className={styles.systemNumber}>4</span>
                <div>
                  <strong>Multiply</strong>
                  <p className={styles.helpText}>Consistency turns the process into habit.</p>
                </div>
              </div>
              <div className={styles.stack}>
                {/*
                  Read-only on purpose. This used to be a text input, which made
                  the streak a number you told yourself rather than one you
                  earned. It is now counted from the saved daily history.
                */}
                <div className={styles.loopNote}>
                  <span className={styles.fieldLabel}>Streak</span>
                  <p className={styles.highlightMetric}>{streakLabel}</p>
                  <p className={styles.helpText}>
                    Consecutive days with a daily win recorded. Counted from saved history — today
                    still counts once you fill the win in below.
                  </p>
                </div>
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Daily win to repeat</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.multiply.dailyWin}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: {
                          ...current.hyperfocus,
                          multiply: {
                            ...current.hyperfocus.multiply,
                            dailyWin: event.target.value
                          }
                        }
                      }))
                    }
                  />
                </label>
                <div className={styles.loopNote}>
                  <span className={styles.fieldLabel}>Diagnostic loop</span>
                  <p className={styles.helpText}>Lens {"->"} Goal {"->"} Bottleneck {"->"} Steps to clear it</p>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <div className={styles.workspaceHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Operate the business</p>
            <h2 className={styles.sectionTitle}>Your working dashboard</h2>
          </div>
          <p className={styles.workspaceHint}>Drag any panel to fit how you work. Your layout and collapsed panels save automatically.</p>
        </div>

        <div className={`${styles.grid} ${styles.workspaceGrid}`}>
          {widgetOrder.map((widgetId) => (
            <div
              key={widgetId}
              className={`${styles.widgetSlot} ${widgetLayoutClasses[widgetId]} ${draggingWidget === widgetId ? styles.widgetDragging : ""}`}
              ref={widgetId === "calendar" ? calendarWidgetRef : undefined}
              draggable
              onDragStart={(event) => {
                setDraggingWidget(widgetId);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", widgetId);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceId = event.dataTransfer.getData("text/plain") as WidgetId;
                setWidgetOrder((current) => moveWidget(current, sourceId, widgetId));
                setDraggingWidget(null);
              }}
              onDragEnd={() => setDraggingWidget(null)}
            >
              {widgets[widgetId]}
            </div>
          ))}
        </div>
        {dashboardData?.generatedAt ? (
          <p className={styles.footerNote}>
            Data snapshot {formatDateCompact(dashboardData.generatedAt)} at{" "}
            {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(dashboardData.generatedAt)}
          </p>
        ) : null}
      </div>
      {selectedCalendarEvent ? (
        <div className={styles.modalOverlay} onClick={() => setSelectedCalendarEvent(null)}>
          <div
            className={styles.modalCard}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Calendar event details"
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.cardEyebrow}>Calendar event</p>
                <h3 className={styles.modalTitle}>{selectedCalendarEvent.title}</h3>
              </div>
              <button
                type="button"
                className={styles.expandButton}
                onClick={() => setSelectedCalendarEvent(null)}
              >
                Close
              </button>
            </div>
            <div className={styles.modalContent}>
              <div className={styles.modalRow}>
                <span className={styles.modalLabel}>When</span>
                <span>{formatEventDateTimeRange(selectedCalendarEvent)}</span>
              </div>
              <div className={styles.modalRow}>
                <span className={styles.modalLabel}>Calendar</span>
                <span>{selectedCalendarEvent.calendarName}</span>
              </div>
              {selectedCalendarEvent.location ? (
                <div className={styles.modalRow}>
                  <span className={styles.modalLabel}>Where</span>
                  <span>{selectedCalendarEvent.location}</span>
                </div>
              ) : null}
              {selectedCalendarEvent.href ? (
                <a
                  href={selectedCalendarEvent.href}
                  target="_blank"
                  rel="noreferrer"
                  className={styles.modalLink}
                >
                  Open in Google Calendar
                  <ExternalLink size={14} />
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
