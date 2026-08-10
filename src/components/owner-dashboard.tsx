"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Grip,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp
} from "lucide-react";
import styles from "./owner-dashboard.module.css";
import { DEFAULT_MANUAL_STATE } from "@/lib/sample-data";
import type {
  CalendarEvent,
  DashboardData,
  ManualState,
  PhoneCallItem,
  UpNextTask
} from "@/lib/types";

const STORAGE_KEY = "marketing-bull-owner-dashboard-v1";

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

function readStoredManualState(): ManualState {
  if (typeof window === "undefined") return DEFAULT_MANUAL_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_MANUAL_STATE;
    return {
      ...DEFAULT_MANUAL_STATE,
      ...JSON.parse(raw)
    } as ManualState;
  } catch {
    return DEFAULT_MANUAL_STATE;
  }
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
  children
}: {
  title: string;
  eyebrow: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <p className={styles.cardEyebrow}>{eyebrow}</p>
          <h2 className={styles.cardTitle}>{title}</h2>
        </div>
        {action}
      </div>
      <div className={styles.cardBody}>{children}</div>
    </section>
  );
}

export function OwnerDashboard() {
  const [manual, setManual] = useState<ManualState>(() => readStoredManualState());
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [loadingCalendar, setLoadingCalendar] = useState(true);
  const [hoursWindow, setHoursWindow] = useState<"week" | "month">("week");
  const [lastRefreshed, setLastRefreshed] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(manual));
    } catch {
      // Ignore storage errors to keep the dashboard usable.
    }
  }, [manual]);

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
      await Promise.all([fetchDashboardData(), fetchCalendarData()]);
    };
    void run();
  }, []);

  function refreshAll() {
    setLoadingDashboard(true);
    setLoadingCalendar(true);
    void Promise.all([fetchDashboardData(), fetchCalendarData()]);
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

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Marketing Bull / Owner view</p>
            <h1 className={styles.title}>See the business in 30 seconds.</h1>
            <p className={styles.subtitle}>
              Standalone version of the owner dashboard only. No Mission Control shell, no agent tooling,
              just the daily screen with small adapter routes for calendar and work data.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                refreshAll();
              }}
              disabled={loadingDashboard || loadingCalendar}
            >
              <RefreshCw size={16} className={loadingDashboard || loadingCalendar ? "spin" : undefined} />
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
            Manual widgets persist locally
          </span>
          <span className={styles.pill}>
            <Grip size={14} />
            Adapter routes keep the project small
          </span>
          <span className={styles.pill}>
            <Target size={14} />
            Ready for ClickUp and calendar wiring
          </span>
        </div>

        <div className={styles.grid}>
          <Card title="Projects" eyebrow="Priority Quadrant" action={<span className={styles.badge}>ClickUp next</span>}>
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
                          {project.title}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="MRR" eyebrow="Manual v1">
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

          <Card
            title="Hours by Project"
            eyebrow="Current focus"
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
                <p className={styles.helpText}>Still sample data until the ClickUp time adapter replaces this route.</p>
              </div>
            )}
          </Card>

          <Card title="Calendar" eyebrow="Today + next 2 days">
            {loadingCalendar ? (
              <div className={styles.loader}><LoaderCircle size={16} /> Loading calendar</div>
            ) : calendarError ? (
              <div className={styles.error}>{calendarError}</div>
            ) : (
              <div className={styles.calendarGrid}>
                {groupedDays.map((day) => (
                  <div key={day.key} className={styles.dayColumn}>
                    <div className={styles.rowBetween}>
                      <strong>{day.label}</strong>
                    </div>
                    <div className={styles.stack}>
                      {day.events.length === 0 ? (
                        <div className={styles.empty}>No events</div>
                      ) : (
                        day.events.map((event) => (
                          <div key={event.id} className={styles.eventCard}>
                            <div className={styles.timeTag}>{formatEventTime(event)}</div>
                            <p className={styles.eventTitle}>{event.title}</p>
                            <div className={styles.eventMeta}>{event.calendarName}</div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Goals" eyebrow="Exactly 3">
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

          <Card title="Up Next" eyebrow="Queue" action={<span className={styles.badge}>Local for now</span>}>
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
                        <span className={styles.callMeta}>{task.due}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </Card>

          <Card title="Phone Calls" eyebrow="To Make / Made">
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

          <Card title="What's Important" eyebrow="The one thing">
            <div className={styles.focusPanel}>
              <div className={styles.rowBetween}>
                <strong>Focus today</strong>
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

          <Card title="Open Slot" eyebrow="Ninth widget">
            <div className={styles.stack}>
              {[
                "Overdue invoices / AR snapshot",
                "Ad spend today across Google + Meta",
                "New leads this week"
              ].map((idea) => (
                <div key={idea} className={styles.openIdea}>
                  <span>{idea}</span>
                  <ArrowUpRight size={15} />
                </div>
              ))}
              <p className={styles.helpText}>
                Leaving this intentionally open keeps the sketch&apos;s breathing room until one metric earns the spot.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
