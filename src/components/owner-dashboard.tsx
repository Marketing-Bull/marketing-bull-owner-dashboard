"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Grip,
  LoaderCircle,
  RefreshCw,
  ShieldAlert
} from "lucide-react";
import styles from "./owner-dashboard.module.css";
import { buildDayColumns } from "@/lib/calendar-days";
import { normalizeDashboardData } from "@/lib/dashboard-data";
import {
  serializeState
} from "@/lib/dashboard-save";
import {
  DEFAULT_WIDGET_ORDER,
  isCollapsibleId,
  type CollapsibleId,
  type WidgetId
} from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type {
  CalendarEvent,
  DashboardData,
  ManualState,
  UpNextTask
} from "@//lib/types";

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

const CALENDAR_DAY_COUNT = 3;

function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
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
  action,
  dragLabel,
  className,
  bodyClassName,
  collapsed = false,
  onToggleCollapse,
  children
}: {
  title: string;
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
        <div className={styles.cardTitleWrap}>
          <h2 className={styles.cardTitle}>{title}</h2>
        </div>
        <div className={styles.cardActions}>
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

export function OwnerDashboard({ version }: { version: string }) {
  const [manual] = useState<ManualState>(DEFAULT_MANUAL_STATE);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>([...DEFAULT_WIDGET_ORDER]);
  const [collapsed, setCollapsed] = useState<CollapsibleId[]>([]);
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
  const hasLoadedStateRef = useRef(false);
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
      const loadedOrder = Array.isArray(json?.widgetOrder)
        ? (json.widgetOrder as WidgetId[])
        : [...DEFAULT_WIDGET_ORDER];
      const loadedCollapsed = Array.isArray(json?.collapsed) ? json.collapsed.filter(isCollapsibleId) : [];

      setWidgetOrder(loadedOrder);
      setCollapsed(loadedCollapsed);
      setAuthConfigured(json?.authConfigured !== false);
      savedSnapshotRef.current = serializeState({
        manual,
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

  async function fetchDashboardData() {
    setDashboardError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (redirectedToLogin(response)) return;
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Dashboard fetch failed");
      }
      setDashboardData(normalizeDashboardData(json));
      setLastRefreshed(Date.now());
    } catch (error) {
      setDashboardError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingDashboard(false);
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
      await Promise.all([fetchDashboardState(), fetchDashboardData(), fetchCalendarData()]);
    };
    void run();
  }, []);

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

  function collapseProps(id: CollapsibleId) {
    return {
      collapsed: collapsed.includes(id),
      onToggleCollapse: () => toggleCollapsed(id)
    };
  }

  function refreshAll() {
    setLoadingDashboard(true);
    setLoadingCalendar(true);
    setLoadingState(true);
    void (async () => {
      await Promise.all([fetchDashboardState(), fetchDashboardData(), fetchCalendarData()]);
    })();
  }

  const dayStartMs = now === null ? null : new Date(now).setHours(0, 0, 0, 0);
  const groupedDays = useMemo(
    () => (dayStartMs === null ? [] : buildDayColumns(calendarEvents, CALENDAR_DAY_COUNT, new Date(dayStartMs))),
    [calendarEvents, dayStartMs]
  );

  const isRefreshing = loadingDashboard || loadingCalendar || loadingState;

  const dateLabel = now
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(now)
    : "Today";
  const clockLabel = now ? formatClock(now) : "--:--";
  const refreshLabel = isRefreshing
    ? "Refreshing…"
    : lastRefreshed
      ? `Refreshed ${formatClock(lastRefreshed)}`
      : "Not refreshed yet";

  const fallbackNotices = [
    dashboardData?.fallbackReason ? { scope: "ClickUp", reason: dashboardData.fallbackReason } : null,
    calendarFallbackReason ? { scope: "Calendar", reason: calendarFallbackReason } : null
  ].filter((notice): notice is { scope: string; reason: string } => notice !== null);

  const widgets: Record<WidgetId, React.ReactNode> = {
    calendar: (
      <Card
        title="Calendar"
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
    upNext: (
      <Card
        title="ClickUp Tasks"
        dragLabel="ClickUp Tasks" {...collapseProps("upNext")}
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
                  onChange={() => void toggleTaskDone(task)}
                />
                <div className={styles.taskContent}>
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
    )
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.headerIntro}>
            <p className={styles.eyebrow}>Marketing Bull · owner workspace</p>
            <div className={styles.headerTitleRow}>
              <h1 className={styles.title}>{dateLabel}</h1>
              <span className={styles.headerDate}>{clockLabel}</span>
            </div>
            <p className={styles.headerMeta}>
              <Clock size={14} />
              <span>{refreshLabel}</span>
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
              onClick={() => refreshAll()}
              disabled={isRefreshing}
            >
              <RefreshCw size={16} className={isRefreshing ? "spin" : undefined} />
              Refresh
            </button>
          </div>
        </header>

        {stateError ? <p className={styles.error}>{stateError}</p> : null}
        {taskError ? <p className={styles.error}>{taskError}</p> : null}

        {fallbackNotices.length > 0 ? (
          <div className={styles.fallbackNotice} role="status">
            {fallbackNotices.map((notice) => (
              <p key={notice.scope} className={styles.fallbackReason}>
                {notice.scope}: {notice.reason}
              </p>
            ))}
          </div>
        ) : null}

        <div className={`${styles.grid} ${styles.workspaceGrid}`}>
          {widgetOrder.map((widgetId) => (
            <div
              key={widgetId}
              className={`${styles.widgetSlot} ${widgetId === "calendar" ? styles.widgetCalendar : styles.widgetUpNext} ${draggingWidget === widgetId ? styles.widgetDragging : ""}`}
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
                <p className={styles.modalLabel}>Event</p>
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