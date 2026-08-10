"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Grip,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp
} from "lucide-react";
import styles from "./owner-dashboard.module.css";
import { DEFAULT_WIDGET_ORDER, type WidgetId } from "@/lib/dashboard-layout";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type {
  CalendarEvent,
  DashboardData,
  ManualState,
  PhoneCallItem,
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

function formatDayLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  }).format(date);
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

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
  children
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  dragLabel?: string;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.card} ${className || ""}`}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.cardEyebrow}>{eyebrow}</p>
          <h2 className={styles.cardTitle}>{title}</h2>
        </div>
        <div className={styles.cardActions}>
          {action}
          {dragLabel ? (
            <span className={styles.dragHandle} title={`Drag to move ${dragLabel}`}>
              <Grip size={14} />
            </span>
          ) : null}
        </div>
      </div>
      <div className={`${styles.cardBody} ${bodyClassName || ""}`}>{children}</div>
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

export function OwnerDashboard() {
  const [manual, setManual] = useState<ManualState>(DEFAULT_MANUAL_STATE);
  const [widgetOrder, setWidgetOrder] = useState<WidgetId[]>([...DEFAULT_WIDGET_ORDER]);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [loadingState, setLoadingState] = useState(true);
  const [hoursWindow, setHoursWindow] = useState<"week" | "month">("week");
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null);
  const [draggingWidget, setDraggingWidget] = useState<WidgetId | null>(null);
  const hasLoadedStateRef = useRef(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchDashboardState() {
    setStateError(null);
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "State fetch failed");
      }
      setManual((json?.manual as ManualState) || DEFAULT_MANUAL_STATE);
      setWidgetOrder(Array.isArray(json?.widgetOrder) ? (json.widgetOrder as WidgetId[]) : [...DEFAULT_WIDGET_ORDER]);
      hasLoadedStateRef.current = true;
    } catch (error) {
      setStateError(error instanceof Error ? error.message : String(error));
      hasLoadedStateRef.current = true;
    } finally {
      setLoadingState(false);
    }
  }

  async function saveDashboardState(nextManual: ManualState, nextWidgetOrder: WidgetId[]) {
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          manual: nextManual,
          widgetOrder: nextWidgetOrder
        })
      });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "State save failed");
      }
      setStateError(null);
    } catch (error) {
      setStateError(error instanceof Error ? error.message : String(error));
    }
  }

  async function fetchDashboardData() {
    setDashboardError(null);
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Dashboard fetch failed");
      }
      setDashboardData(json as DashboardData);
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
      const json = await response.json();
      if (!response.ok) {
        throw new Error(json?.error || "Calendar fetch failed");
      }
      setCalendarEvents(Array.isArray(json?.upcomingEvents) ? json.upcomingEvents : []);
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

  useEffect(() => {
    if (!hasLoadedStateRef.current) return;
    if (loadingState) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(() => {
      void saveDashboardState(manual, widgetOrder);
    }, 350);

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [loadingState, manual, widgetOrder]);

  function refreshAll() {
    setLoadingDashboard(true);
    setLoadingCalendar(true);
    setLoadingState(true);
    void Promise.all([fetchDashboardState(), fetchDashboardData(), fetchCalendarData()]);
  }

  const groupedDays = useMemo(
    () =>
      Array.from({ length: 3 }, (_, offset) => {
        const date = new Date();
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() + offset);
        const key = dayKey(date);
        return {
          key,
          label: formatDayLabel(date),
          events: calendarEvents.filter((event) => dayKey(new Date(event.startMs)) === key)
        };
      }),
    [calendarEvents]
  );

  const hoursEntries = dashboardData?.hours[hoursWindow] ?? [];
  const maxHours = Math.max(...hoursEntries.map((entry) => entry.hours), 1);

  const widgets: Record<WidgetId, React.ReactNode> = {
    projects: (
      <Card
        title="Projects"
        eyebrow="Add / prioritization"
        dragLabel="Projects"
        action={<span className={styles.badge}>{dashboardData?.source === "live" ? "Live ClickUp" : "Sample"}</span>}
      >
        {loadingDashboard ? (
          <div className={styles.loader}><LoaderCircle size={16} /> Loading projects</div>
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
    mrr: (
      <Card title="MRR" eyebrow="Multiply / scoreboard" dragLabel="MRR">
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
        dragLabel="Hours by Project"
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
        dragLabel="Calendar"
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
      <Card title="Steps to Clear the Bottleneck" eyebrow="Add / execution path" dragLabel="Goals">
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
        dragLabel="Up Next"
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
                    setDashboardData((current) =>
                      current
                        ? {
                            ...current,
                            upNext: current.upNext.map((entry) =>
                              entry.id === task.id ? { ...entry, done: !entry.done } : entry
                            )
                          }
                        : current
                    )
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
      <Card title="Phone Calls" eyebrow="Divide / communication block" dragLabel="Phone Calls">
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
      <Card title="What's Important" eyebrow="Execution / remove resistance" dragLabel="What's Important">
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
      <Card title="Daily System Snapshot" eyebrow="4-step summary" dragLabel="Open Slot">
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
            <span>Streak: {manual.hyperfocus.multiply.streakDays} days</span>
            <ArrowUpRight size={15} />
          </div>
          <p className={styles.helpText}>{manual.hyperfocus.multiply.dailyWin}</p>
        </div>
      </Card>
    )
  };

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / Owner view</p>
            <h1 className={styles.title}>See the business in 30 seconds.</h1>
            <p className={styles.subtitle}>
              Standalone owner dashboard only. Lean shell, live ClickUp/calendar adapters, and a daily `Subtract / Add / Divide / Multiply` operating layer.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                refreshAll();
              }}
              disabled={loadingDashboard || loadingCalendar || loadingState}
            >
              <RefreshCw
                size={16}
                className={loadingDashboard || loadingCalendar || loadingState ? "spin" : undefined}
              />
              Refresh
            </button>
            {lastRefreshed ? (
              <span className={styles.helpText}>
                Refreshed{" "}
                {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(
                  lastRefreshed
                )}
              </span>
            ) : null}
          </div>
        </header>

        <div className={styles.pills}>
          <span className={styles.pill}>
            <Sparkles size={14} />
            {loadingState ? "Loading SQLite state" : "SQLite-backed shared state"}
          </span>
          <span className={styles.pill}>
            <Grip size={14} />
            Drag to rearrange widgets
          </span>
          <span className={styles.pill}>
            <Target size={14} />
            Bottleneck-first workflow
          </span>
          <a
            href="http://100.119.59.63:3333/tasks"
            target="_blank"
            rel="noreferrer"
            className={`${styles.pill} ${styles.pillLink}`}
          >
            <ExternalLink size={14} />
            Tasks
          </a>
        </div>

        {stateError ? <p className={styles.error}>{stateError}</p> : null}

        <Card title="Daily Hyperfocus System" eyebrow="Apply the 4 steps every day" className={styles.systemCard}>
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
                <label className={styles.fieldCompact}>
                  <span className={styles.fieldLabel}>Streak days</span>
                  <input
                    className={styles.input}
                    value={manual.hyperfocus.multiply.streakDays}
                    onChange={(event) =>
                      setManual((current) => ({
                        ...current,
                        hyperfocus: {
                          ...current.hyperfocus,
                          multiply: {
                            ...current.hyperfocus.multiply,
                            streakDays: event.target.value
                          }
                        }
                      }))
                    }
                  />
                </label>
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

        <div className={styles.grid}>
          {widgetOrder.map((widgetId) => (
            <div
              key={widgetId}
              className={`${styles.widgetSlot} ${draggingWidget === widgetId ? styles.widgetDragging : ""}`}
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
