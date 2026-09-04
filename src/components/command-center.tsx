"use client";

/**
 * Command Center — the screen that answers "where does the business stand?"
 * without anybody typing a number into it.
 *
 * The original dashboard is a set of boxes to fill in: MRR, goals, the daily
 * win, the phone list. It ages the moment it is saved. This one owns no state
 * at all. Every figure is computed by `@/lib/command-center` from the ledgers
 * the app now owns — clients, projects, time, expenses, recurring costs,
 * mileage, the chart of accounts — and the only interactive control is the
 * period the whole page is measured over.
 *
 * Reading order is deliberate, and it is the order an owner actually asks:
 *   1. What did I make?          (headline band)
 *   2. What is wrong right now?  (attention)
 *   3. Where is it heading?      (12-month cash flow)
 *   4. Who is it coming from?    (clients)
 *   5. Where did the hours go?   (projects, cadence)
 *   6. What do I owe the IRS?    (deductions)
 *
 * ClickUp and Calendar are fetched separately and on purpose: they are the two
 * feeds that can be down, and an outage on either must not take the money with
 * it. Each degrades inside its own panel.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Car,
  CircleAlert,
  Clock3,
  ExternalLink,
  Flame,
  LoaderCircle,
  Minus,
  Plus,
  Receipt,
  RefreshCw,
  ShieldAlert,
  Table2,
  Users
} from "lucide-react";
import styles from "./command-center.module.css";
import { dayKey } from "@/lib/calendar-days";
import type {
  ActivityItem,
  AttentionItem,
  AttentionSeverity,
  ClientRollup,
  CommandCenterPayload,
  CommandPeriodKey,
  TrendPoint
} from "@/lib/command-center";
import type { CalendarEvent } from "@/lib/types";

/**
 * Period options live here rather than being imported from the lib module: the
 * lib is a server module (it opens SQLite), and importing a value from it would
 * drag that graph into the browser bundle. Types are erased, so those still
 * come from the one place they are defined.
 */
const PERIOD_OPTIONS: Array<{ key: CommandPeriodKey; label: string; short: string }> = [
  { key: "mtd", label: "Month to date", short: "MTD" },
  { key: "last-month", label: "Last month", short: "Last mo" },
  { key: "qtd", label: "Quarter to date", short: "QTD" },
  { key: "ytd", label: "Year to date", short: "YTD" }
];

const PERIOD_STORAGE_KEY = "command-center.period";

function isPeriodKey(value: unknown): value is CommandPeriodKey {
  return PERIOD_OPTIONS.some((option) => option.key === value);
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const currencyCents = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function money(value: number): string {
  return currency.format(value);
}

/** Axis and chip figures: $12.4k reads faster than $12,400 at 11px. */
function compactMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`;
  return `${value < 0 ? "-" : ""}$${Math.round(abs)}`;
}

function hoursLabel(value: number): string {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)}h`;
}

function percent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/**
 * A ratio that has outgrown a percentage.
 *
 * Retainers covering fixed costs 35 times over is the healthy case, and "3478%"
 * is unreadable at a glance where "35x" is not.
 */
function formatMultiple(value: number): string {
  return `${value.toFixed(value < 10 ? 1 : 0)}x`;
}

function formatDay(day: string | null): string {
  if (!day) return "never";
  const [year, month, date] = day.split("-").map(Number);
  if (!Number.isFinite(year)) return day;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
    new Date(year, month - 1, date)
  );
}

function formatLongDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  if (!Number.isFinite(year)) return day;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(year, month - 1, date));
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(timestamp);
}

function formatSync(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(ms);
}

/** ClickUp's priority vocabulary onto the chip styles the old feed used. */
function priorityClass(priority: string | null): string {
  switch ((priority ?? "").toLowerCase()) {
    case "urgent":
      return "p0";
    case "high":
      return "p1";
    case "normal":
      return "p2";
    default:
      return "p3";
  }
}

function priorityLabel(priority: string | null): string {
  const value = (priority ?? "").toLowerCase();
  if (value === "urgent") return "P0";
  if (value === "high") return "P1";
  if (value === "normal") return "P2";
  if (value === "low") return "P3";
  return "—";
}

/**
 * A due date relative to the moment the payload was computed.
 *
 * `nowMs` is the payload's own timestamp rather than `Date.now()`, so the list
 * and the server's overdue count draw the line in the same place — a task due
 * at 9am is overdue at 3pm on both, not "today" on one and overdue on the other.
 */
function describeDue(
  dueMs: number | null,
  today: string,
  nowMs: number
): { label: string; tone: "overdue" | "today" | "later" | "none" } {
  if (dueMs === null) return { label: "No due date", tone: "none" };
  const dueDay = dayKey(new Date(dueMs));
  if (dueDay < today) return { label: `Overdue · ${formatDay(dueDay)}`, tone: "overdue" };
  if (dueDay === today) {
    return dueMs < nowMs
      ? { label: `Overdue · ${formatClock(dueMs)}`, tone: "overdue" }
      : { label: `Today ${formatClock(dueMs)}`, tone: "today" };
  }
  if (dueDay === shiftBack(today, -1)) return { label: "Tomorrow", tone: "later" };
  return { label: formatDay(dueDay), tone: "later" };
}

/** The proxy answers unauthenticated API calls with JSON, so redirect here. */
function redirectedToLogin(response: Response): boolean {
  if (response.status !== 401) return false;
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  return true;
}

function ratio(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * A signed change against the comparison window.
 *
 * `goodWhenUp` is explicit because half these tiles invert: spending more is not
 * an improvement, and colouring it green because the bar got taller is how
 * dashboards start lying. The arrow carries the direction so the colour is
 * never the only signal.
 */
function Delta({
  current,
  previous,
  goodWhenUp = true,
  format = compactMoney
}: {
  current: number;
  previous: number;
  goodWhenUp?: boolean;
  format?: (value: number) => string;
}) {
  const change = current - previous;
  const share = ratio(current, previous);

  if (previous === 0 && current === 0) {
    return <span className={`${styles.delta} ${styles.deltaFlat}`}>no change</span>;
  }

  const flat = Math.abs(change) < 0.005;
  const positive = change > 0;
  const good = flat ? null : positive === goodWhenUp;
  const Icon = flat ? Minus : positive ? ArrowUpRight : ArrowDownRight;

  return (
    <span
      className={`${styles.delta} ${flat ? styles.deltaFlat : good ? styles.deltaGood : styles.deltaBad}`}
    >
      <Icon size={13} aria-hidden="true" />
      {share === null ? format(Math.abs(change)) : `${Math.abs(share * 100).toFixed(0)}%`}
    </span>
  );
}

function StatTile({
  label,
  value,
  meta,
  delta
}: {
  label: string;
  value: string;
  meta?: React.ReactNode;
  delta?: React.ReactNode;
}) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileLabel}>{label}</span>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileMeta}>
        {delta}
        {meta ? <span className={styles.tileMetaText}>{meta}</span> : null}
      </span>
    </div>
  );
}

function Card({
  title,
  subtitle,
  action,
  className,
  children
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`${styles.card} ${className || ""}`}>
      <header className={styles.cardHeader}>
        <div>
          <h2 className={styles.cardTitle}>{title}</h2>
          {subtitle ? <p className={styles.cardSubtitle}>{subtitle}</p> : null}
        </div>
        {action ? <div className={styles.cardAction}>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------------- */
/* Cash flow                                                                  */
/* ------------------------------------------------------------------------- */

const CHART = { width: 760, height: 250, top: 16, right: 10, bottom: 30, left: 52 };

/** Rounds an axis ceiling to a number a human would have picked. */
function niceCeil(value: number): number {
  if (value <= 0) return 1000;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Column with a 4px rounded cap and square feet on the baseline. */
function columnPath(x: number, y: number, width: number, height: number): string {
  const radius = Math.min(4, width / 2, Math.max(height, 0));
  const bottom = y + height;
  if (height <= 0.5) return "";
  return [
    `M${x},${bottom}`,
    `L${x},${y + radius}`,
    `Q${x},${y} ${x + radius},${y}`,
    `L${x + width - radius},${y}`,
    `Q${x + width},${y} ${x + width},${y + radius}`,
    `L${x + width},${bottom}`,
    "Z"
  ].join(" ");
}

function CashFlow({ trend, periodLabel }: { trend: TrendPoint[]; periodLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const max = niceCeil(Math.max(1, ...trend.map((point) => Math.max(point.income, point.expenses))));
  const plotWidth = CHART.width - CHART.left - CHART.right;
  const plotHeight = CHART.height - CHART.top - CHART.bottom;
  const band = plotWidth / Math.max(trend.length, 1);
  // Two columns per month with a 2px surface gap between them; capped at 20 so
  // a short series does not turn into slabs.
  const columnWidth = Math.min(20, (band - 14) / 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((step) => step * max);
  const scale = (value: number) => plotHeight - (value / max) * plotHeight;

  const totals = trend.reduce(
    (sum, point) => ({ income: sum.income + point.income, expenses: sum.expenses + point.expenses }),
    { income: 0, expenses: 0 }
  );
  const active = hover === null ? null : trend[hover];

  return (
    <Card
      title="Cash flow"
      subtitle={`Money in and out, last 12 months · ${compactMoney(totals.income - totals.expenses)} net`}
      action={
        <button
          type="button"
          className={styles.ghostButton}
          onClick={() => setAsTable((value) => !value)}
          aria-pressed={asTable}
        >
          <Table2 size={14} aria-hidden="true" />
          {asTable ? "Chart" : "Table"}
        </button>
      }
    >
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchIncome}`} aria-hidden="true" />
          Income
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.swatchExpense}`} aria-hidden="true" />
          Expenses
        </span>
        <span className={styles.legendNote}>Period shown above: {periodLabel}</span>
      </div>

      {asTable ? (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col" className={styles.numeric}>
                  Income
                </th>
                <th scope="col" className={styles.numeric}>
                  Expenses
                </th>
                <th scope="col" className={styles.numeric}>
                  Net
                </th>
                <th scope="col" className={styles.numeric}>
                  Hours
                </th>
              </tr>
            </thead>
            <tbody>
              {trend.map((point) => (
                <tr key={point.month}>
                  <th scope="row">{point.month}</th>
                  <td className={styles.numeric}>{money(point.income)}</td>
                  <td className={styles.numeric}>{money(point.expenses)}</td>
                  <td className={styles.numeric}>{money(point.net)}</td>
                  <td className={styles.numeric}>{point.hours.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.chartWrap}>
          <svg
            viewBox={`0 0 ${CHART.width} ${CHART.height}`}
            className={styles.chart}
            role="img"
            aria-label={`Monthly income and expenses for the last 12 months. Income totals ${money(totals.income)}, expenses ${money(totals.expenses)}. Switch to the table view for exact figures.`}
          >
            <g transform={`translate(${CHART.left} ${CHART.top})`}>
              {ticks.map((tick) => (
                <g key={tick}>
                  <line
                    x1={0}
                    x2={plotWidth}
                    y1={scale(tick)}
                    y2={scale(tick)}
                    className={tick === 0 ? styles.axisLine : styles.gridLine}
                  />
                  <text x={-10} y={scale(tick) + 4} className={styles.axisText} textAnchor="end">
                    {tick === 0 ? "0" : compactMoney(tick)}
                  </text>
                </g>
              ))}

              {trend.map((point, index) => {
                const groupWidth = columnWidth * 2 + 2;
                const left = index * band + (band - groupWidth) / 2;
                const incomeHeight = plotHeight - scale(point.income);
                const expenseHeight = plotHeight - scale(point.expenses);
                const isLast = index === trend.length - 1;
                const isHovered = hover === index;

                return (
                  <g key={point.month}>
                    {isHovered ? (
                      <rect
                        x={index * band}
                        y={-CHART.top + 4}
                        width={band}
                        height={plotHeight + CHART.top - 4}
                        className={styles.hoverBand}
                      />
                    ) : null}
                    <path
                      d={columnPath(left, scale(point.income), columnWidth, incomeHeight)}
                      className={styles.barIncome}
                    />
                    <path
                      d={columnPath(left + columnWidth + 2, scale(point.expenses), columnWidth, expenseHeight)}
                      className={styles.barExpense}
                    />
                    {/* Direct labels only on the current month: a number on every
                        column is noise, and the axis carries the rest. */}
                    {isLast && point.income > 0 ? (
                      <text
                        x={left + columnWidth / 2}
                        y={scale(point.income) - 6}
                        className={styles.barLabel}
                        textAnchor="middle"
                      >
                        {compactMoney(point.income)}
                      </text>
                    ) : null}
                    {isLast && point.expenses > 0 ? (
                      <text
                        x={left + columnWidth * 1.5 + 2}
                        y={scale(point.expenses) - 6}
                        className={styles.barLabel}
                        textAnchor="middle"
                      >
                        {compactMoney(point.expenses)}
                      </text>
                    ) : null}
                    <text
                      x={index * band + band / 2}
                      y={plotHeight + 18}
                      className={`${styles.axisText} ${isLast ? styles.axisTextCurrent : ""}`}
                      textAnchor="middle"
                    >
                      {point.label}
                    </text>
                    {/* Hit target spans the whole band, not just the columns. */}
                    <rect
                      x={index * band}
                      y={-CHART.top}
                      width={band}
                      height={plotHeight + CHART.top}
                      fill="transparent"
                      onMouseEnter={() => setHover(index)}
                      onMouseLeave={() => setHover((value) => (value === index ? null : value))}
                    />
                  </g>
                );
              })}
            </g>
          </svg>

          {active ? (
            <div
              className={styles.tooltip}
              style={{
                left: `${((CHART.left + (hover ?? 0) * band + band / 2) / CHART.width) * 100}%`,
                transform: (hover ?? 0) > trend.length - 4 ? "translate(-90%, 0)" : "translate(-10%, 0)"
              }}
              role="status"
            >
              <strong>{active.month}</strong>
              <span>
                <span className={`${styles.swatch} ${styles.swatchIncome}`} aria-hidden="true" /> In{" "}
                {money(active.income)}
              </span>
              <span>
                <span className={`${styles.swatch} ${styles.swatchExpense}`} aria-hidden="true" /> Out{" "}
                {money(active.expenses)}
              </span>
              <span className={styles.tooltipNet}>
                Net {money(active.net)} · {active.hours.toFixed(1)}h
              </span>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Attention                                                                  */
/* ------------------------------------------------------------------------- */

const SEVERITY_META: Record<AttentionSeverity, { label: string; icon: typeof AlertTriangle }> = {
  critical: { label: "Costing money", icon: ShieldAlert },
  serious: { label: "Slipping", icon: AlertTriangle },
  warning: { label: "Tidy up", icon: CircleAlert }
};

function AttentionPanel({ items }: { items: AttentionItem[] }) {
  return (
    <Card
      title="Needs attention"
      subtitle={items.length === 0 ? "Nothing is flagged" : `${items.length} open`}
      className={styles.attentionCard}
    >
      {items.length === 0 ? (
        <p className={styles.emptyState}>
          No client is past paid-through, every billable hour has a rate, and this year&apos;s expenses are
          categorized. Nothing here is a good result, not an empty panel.
        </p>
      ) : (
        <ul className={styles.attentionList}>
          {items.map((item) => {
            const meta = SEVERITY_META[item.severity];
            const Icon = meta.icon;
            return (
              <li key={item.id} className={`${styles.attentionItem} ${styles[item.severity]}`}>
                <span className={styles.attentionIcon}>
                  <Icon size={15} aria-hidden="true" />
                </span>
                <div className={styles.attentionBody}>
                  <span className={styles.attentionSeverity}>{meta.label}</span>
                  <strong className={styles.attentionTitle}>{item.title}</strong>
                  <p className={styles.attentionDetail}>{item.detail}</p>
                  <Link href={item.href} className={styles.attentionAction}>
                    {item.actionLabel}
                    <ArrowRight size={13} aria-hidden="true" />
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Clients                                                                    */
/* ------------------------------------------------------------------------- */

function coverageState(coverage: number): "over" | "watch" | "ok" {
  if (coverage > 1.25) return "over";
  if (coverage > 1) return "watch";
  return "ok";
}

function ClientPanel({
  clients,
  today,
  monthlyWindow
}: {
  clients: ClientRollup[];
  today: string;
  monthlyWindow: boolean;
}) {
  // Worked-on clients first, then the retainer book, then the rest: a client
  // with no activity and no MRR is the least useful row on the screen.
  const ranked = useMemo(
    () =>
      [...clients]
        .filter((client) => client.status !== "on_hold")
        .sort(
          (a, b) =>
            b.billableValue - a.billableValue ||
            b.hours - a.hours ||
            (b.mrr ?? 0) - (a.mrr ?? 0) ||
            a.name.localeCompare(b.name)
        )
        .slice(0, 8),
    [clients]
  );

  return (
    <Card
      title="Clients"
      subtitle={`${clients.filter((client) => client.status === "active").length} active · top 8 by delivered value`}
      action={
        <Link href="/clients" className={styles.ghostButton}>
          All clients
          <ArrowRight size={13} aria-hidden="true" />
        </Link>
      }
    >
      {ranked.length === 0 ? (
        <p className={styles.emptyState}>No clients yet. Add one and this table fills itself in.</p>
      ) : (
        <div className={styles.tableScroll}>
          <table className={styles.dataTable}>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Engagement</th>
                <th scope="col" className={styles.numeric}>
                  Hours
                </th>
                <th scope="col" className={styles.numeric}>
                  Delivered
                </th>
                {monthlyWindow ? <th scope="col">Retainer coverage</th> : null}
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((client) => {
                const stale =
                  !client.lastActivity ||
                  (client.status === "active" && client.lastActivity < shiftBack(today, 30));
                return (
                  <tr key={client.id}>
                    <th scope="row">
                      <span className={styles.clientName}>{client.name}</span>
                      <span className={`${styles.statusChip} ${styles[`status_${client.status}`] || ""}`}>
                        {client.status.replace("_", " ")}
                      </span>
                    </th>
                    <td>
                      <span className={styles.subtle}>
                        {client.paymentType === "mrr" && client.mrr
                          ? `${money(client.mrr)}/mo`
                          : client.hourlyRate
                            ? `${money(client.hourlyRate)}/hr`
                            : client.paymentType.replace("-", " ")}
                      </span>
                    </td>
                    <td className={styles.numeric}>{client.hours ? client.hours.toFixed(1) : "—"}</td>
                    <td className={styles.numeric}>{client.billableValue ? money(client.billableValue) : "—"}</td>
                    {monthlyWindow ? (
                      <td>
                        {client.retainerCoverage === null ? (
                          <span className={styles.subtle}>{client.mrr ? "no hours logged" : "not a retainer"}</span>
                        ) : (
                          <span className={styles.meterWrap}>
                            <span
                              className={`${styles.meter} ${styles[`meter_${coverageState(client.retainerCoverage)}`]}`}
                            >
                              <span
                                className={styles.meterFill}
                                style={{ width: `${Math.min(client.retainerCoverage, 2) * 50}%` }}
                              />
                            </span>
                            <span className={styles.meterValue}>{percent(client.retainerCoverage)}</span>
                          </span>
                        )}
                      </td>
                    ) : null}
                    <td>
                      <span className={stale ? styles.staleDate : styles.subtle}>
                        {formatDay(client.lastActivity)}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {monthlyWindow ? (
        <p className={styles.footnote}>
          Retainer coverage is the month&apos;s billable work valued at its frozen rate, against what the retainer
          bills. Over 100% means the month cost more to deliver than it collects.
        </p>
      ) : null}
    </Card>
  );
}

/** Local `YYYY-MM-DD` arithmetic for the staleness highlight only. */
function shiftBack(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  const anchor = new Date(year, month - 1, date, 12);
  anchor.setDate(anchor.getDate() - days);
  return dayKey(anchor);
}

const ACTIVITY_META: Record<ActivityItem["kind"], { label: string; icon: typeof Clock3 }> = {
  time: { label: "Time", icon: Clock3 },
  expense: { label: "Expense", icon: Receipt },
  income: { label: "Income", icon: ArrowUpRight },
  mileage: { label: "Trip", icon: Car }
};

function ActivityPanel({ items }: { items: ActivityItem[] }) {
  return (
    <Card title="Latest records" subtitle="The last eight rows written to any ledger">
      {items.length === 0 ? (
        <p className={styles.emptyState}>Nothing recorded yet. Every panel above fills in from these rows.</p>
      ) : (
        <ul className={styles.activityList}>
          {items.map((item) => {
            const meta = ACTIVITY_META[item.kind];
            const Icon = meta.icon;
            return (
              <li key={item.id}>
                <Link href={item.href} className={styles.activityRow}>
                  <span className={`${styles.activityKind} ${styles[`kind_${item.kind}`]}`}>
                    <Icon size={13} aria-hidden="true" />
                    {meta.label}
                  </span>
                  <span className={styles.activityBody}>
                    <span className={styles.activityTitle}>{item.title}</span>
                    <span className={styles.subtle}>{item.subtitle}</span>
                  </span>
                  <span className={styles.activityValue}>
                    {item.kind === "expense" ? `-${money(item.amount)}` : money(item.amount)}
                    <span className={styles.subtle}>
                      {item.quantity === null
                        ? formatDay(item.date)
                        : `${item.quantity.toFixed(1)}${item.kind === "time" ? "h" : " mi"} · ${formatDay(item.date)}`}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------------- */
/* Screen                                                                     */
/* ------------------------------------------------------------------------- */

type Feed = {
  events: CalendarEvent[];
  calendarError: string | null;
  /** Set when the Tasks endpoint itself could not be reached — not when ClickUp failed. */
  taskError: string | null;
};

const EMPTY_FEED: Feed = { events: [], calendarError: null, taskError: null };

export function CommandCenter() {
  const [period, setPeriod] = useState<CommandPeriodKey>("mtd");
  const [data, setData] = useState<CommandCenterPayload | null>(null);
  const [feed, setFeed] = useState<Feed>(EMPTY_FEED);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** First read fills the screen; later ones refresh it under the old figures. */
  const loadedOnce = useRef(false);
  /**
   * Monotonic request id. A response that is not from the newest request is
   * dropped: the refresh-triggered reload has no abort signal, and without this
   * a slow one could land after a period change and overwrite the newer
   * period's figures under the wrong label.
   */
  const loadSequence = useRef(0);

  // The chosen period is a preference, not shared state: it belongs to this
  // browser, so it stays out of the database the old dashboard writes to.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(PERIOD_STORAGE_KEY);
      if (isPeriodKey(saved)) setPeriod(saved);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const load = useCallback(async (nextPeriod: CommandPeriodKey, signal?: AbortSignal) => {
    const sequence = ++loadSequence.current;
    if (loadedOnce.current) setRefreshing(true);
    else setLoading(true);

    try {
      const response = await fetch(`/api/command?period=${nextPeriod}`, { cache: "no-store", signal });
      if (redirectedToLogin(response)) return;
      const json = await response.json().catch(() => null);
      if (sequence !== loadSequence.current) return;
      if (!response.ok) {
        throw new Error(json?.error || `The command feed answered ${response.status}.`);
      }
      setData(json as CommandCenterPayload);
      setError(null);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      if (sequence !== loadSequence.current) return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      loadedOnce.current = true;
      if (sequence === loadSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(period, controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [period, load]);

  /**
   * The two feeds that can be down, fetched apart from the money figures.
   *
   * The Tasks call reads one row and ignores it: its job is the side effect.
   * `/api/tasks` refreshes the ClickUp cache when it is stale, and the command
   * payload is computed from that cache — so when it reports a refresh, the
   * command feed is read again and the task counts and overdue rule catch up.
   */
  const loadFeeds = useCallback(async (): Promise<{ refreshed: boolean }> => {
    const [tasks, calendar] = await Promise.allSettled([
      fetch("/api/tasks?pageSize=1&sort=due&direction=asc", { cache: "no-store" }),
      fetch("/api/calendar", { cache: "no-store" })
    ]);

    const next: Feed = { ...EMPTY_FEED };
    let refreshed = false;

    if (tasks.status === "fulfilled" && tasks.value.ok) {
      const payload = (await tasks.value.json().catch(() => ({}))) as {
        sync?: { refreshed?: boolean };
        syncError?: string | null;
      };
      refreshed = Boolean(payload.sync?.refreshed);
      // The command payload may have read the sync row before this attempt
      // ran, so a refresh that has just failed is only visible from here.
      if (payload.syncError) {
        next.taskError = `ClickUp refresh failed: ${payload.syncError.replace(/[.\s]+$/, "")}.`;
      }
    } else {
      next.taskError = "The task list could not be refreshed; showing the last cached copy.";
    }

    if (calendar.status === "fulfilled" && calendar.value.ok) {
      const payload = (await calendar.value.json()) as { upcomingEvents?: CalendarEvent[] };
      next.events = Array.isArray(payload.upcomingEvents) ? payload.upcomingEvents : [];
    } else {
      next.calendarError = "Calendar is not answering right now.";
    }

    setFeed(next);
    return { refreshed };
  }, []);

  /** The current period, readable from async callbacks without re-creating them. */
  const periodRef = useRef(period);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFeeds().then(({ refreshed }) => {
        if (refreshed) void load(periodRef.current);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFeeds, load]);

  const choosePeriod = (next: CommandPeriodKey) => {
    setPeriod(next);
    window.localStorage.setItem(PERIOD_STORAGE_KEY, next);
  };

  const todayEvents = useMemo(() => {
    if (!data) return [];
    return feed.events.filter((event) => dayKey(new Date(event.startMs)) === data.today).slice(0, 4);
  }, [feed.events, data]);

  if (loading && !data) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.loading}>
            <LoaderCircle size={18} className="spin" aria-hidden="true" />
            Reading the ledgers…
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.errorBox}>
            <ShieldAlert size={18} aria-hidden="true" />
            <div>
              <strong>The command feed could not be read.</strong>
              <p>{error}</p>
              <button type="button" className={styles.primaryButton} onClick={() => void load(period)}>
                Try again
              </button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const { money: cash, work, reimbursable, cadence, tax, tasks, period: window_, totals } = data;
  const generatedAtMs = Date.parse(data.generatedAt);
  const monthlyWindow = window_.key === "mtd" || window_.key === "last-month";
  const topProjects = data.projects.filter((project) => project.hours > 0).slice(0, 6);
  const maxProjectHours = Math.max(1, ...topProjects.map((project) => project.hours));

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.pageHeader}>
          <div>
            <p className={styles.eyebrow}>{formatLongDay(data.today)}</p>
            <h1 className={styles.pageTitle}>Command Center</h1>
            <p className={styles.pageSubtitle}>
              Every number below is computed from {totals.timeEntries.toLocaleString()} time entries,{" "}
              {totals.expenseRecords.toLocaleString()} financial records, and {totals.mileageEntries.toLocaleString()}{" "}
              trips. Nothing here is typed in.
            </p>
          </div>

          <div className={styles.headerControls}>
            <div className={styles.segmented} role="group" aria-label="Reporting period">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`${styles.segment} ${option.key === period ? styles.segmentActive : ""}`}
                  aria-pressed={option.key === period}
                  onClick={() => choosePeriod(option.key)}
                  title={option.label}
                >
                  {option.short}
                </button>
              ))}
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => {
                void load(period);
                void loadFeeds().then(({ refreshed }) => {
                  if (refreshed) void load(period);
                });
              }}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={15} className={refreshing ? "spin" : undefined} aria-hidden="true" />
            </button>
          </div>
        </header>

        {error ? (
          <p className={styles.staleNotice}>
            Showing the last good read — the refresh failed: {error}
          </p>
        ) : null}

        <section className={styles.headline} aria-label="Headline figures">
          <div className={styles.hero}>
            <span className={styles.heroLabel}>
              Net · {window_.label}
              <span className={styles.heroRange}>
                {formatDay(window_.from)} – {formatDay(window_.to)}
              </span>
            </span>
            <strong className={`${styles.heroValue} ${cash.net < 0 ? styles.heroNegative : ""}`}>
              {money(cash.net)}
            </strong>
            <span className={styles.heroMeta}>
              <Delta current={cash.net} previous={cash.previousNet} />
              <span className={styles.tileMetaText}>
                {window_.comparisonLabel}
                {cash.margin === null ? "" : ` · ${percent(cash.margin)} margin`}
              </span>
            </span>
          </div>

          <div className={styles.tiles}>
            <StatTile
              label="Money in"
              value={money(cash.income)}
              delta={<Delta current={cash.income} previous={cash.previousIncome} />}
              meta="recorded income"
            />
            <StatTile
              label="Money out"
              value={money(cash.expenses)}
              delta={<Delta current={cash.expenses} previous={cash.previousExpenses} goodWhenUp={false} />}
              meta="recorded spend"
            />
            <StatTile
              label="Committed MRR"
              value={money(cash.committedMrr)}
              meta={
                <>
                  {`${cash.mrrClients} retainer ${cash.mrrClients === 1 ? "client" : "clients"} · ${
                    cash.fixedCoverage === null
                      ? "no recurring costs recorded"
                      : `covers ${money(cash.fixedMonthlyCost)}/mo fixed ${formatMultiple(cash.fixedCoverage)}`
                  }`}
                  {cash.mrrGap !== null && cash.typedMrr !== null ? (
                    <span className={styles.mismatch}>
                      <AlertTriangle size={11} aria-hidden="true" />
                      typed figure says {money(cash.typedMrr)}
                    </span>
                  ) : null}
                </>
              }
            />
            <StatTile
              label="Work delivered"
              value={money(work.billableValue)}
              delta={<Delta current={work.billableValue} previous={work.previousBillableValue} />}
              meta={`${hoursLabel(work.hours)} logged · ${
                work.blendedRate === null ? "—" : `${currencyCents.format(work.blendedRate)}/hr blended`
              }`}
            />
            <StatTile
              label="Reimbursables"
              value={money(reimbursable.total)}
              meta={`${money(reimbursable.expenses)} spend · ${reimbursable.mileageMiles.toFixed(
                0
              )} mi at ${currencyCents.format(reimbursable.mileageRate)}`}
            />
          </div>
        </section>

        <div className={styles.grid}>
          <div className={styles.mainColumn}>
            <CashFlow trend={data.trend} periodLabel={window_.label} />

            <ClientPanel clients={data.clients} today={data.today} monthlyWindow={monthlyWindow} />

            <Card
              title="Where the hours went"
              subtitle={`${hoursLabel(work.hours)} across ${work.entries} ${
                work.entries === 1 ? "entry" : "entries"
              } · ${work.daysWorked} ${work.daysWorked === 1 ? "day" : "days"} worked`}
              action={
                <Link href="/time" className={styles.ghostButton}>
                  Time ledger
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              {topProjects.length === 0 ? (
                <p className={styles.emptyState}>
                  No hours logged in this period. The ledger is the only place these come from.
                </p>
              ) : (
                <ul className={styles.barList}>
                  {topProjects.map((project) => (
                    <li key={project.id} className={styles.barRow}>
                      <div className={styles.barLabelWrap}>
                        <span className={styles.barName}>{project.name}</span>
                        {project.clientName ? (
                          <span className={styles.subtle}>{project.clientName}</span>
                        ) : (
                          <span className={styles.subtle}>Unassigned</span>
                        )}
                      </div>
                      <div className={styles.barTrack}>
                        <span
                          className={styles.barFill}
                          style={{ width: `${(project.hours / maxProjectHours) * 100}%` }}
                        />
                      </div>
                      <span className={styles.barValue}>
                        {project.hours.toFixed(1)}h
                        <span className={styles.subtle}>{money(project.billableValue)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              <div className={styles.statRow}>
                <div>
                  <span className={styles.statLabel}>Billable share</span>
                  <strong>{work.hours === 0 ? "—" : percent(work.billableHours / work.hours)}</strong>
                </div>
                <div>
                  <span className={styles.statLabel}>Average day</span>
                  <strong>{work.daysWorked === 0 ? "—" : hoursLabel(work.hours / work.daysWorked)}</strong>
                </div>
                <div>
                  <span className={styles.statLabel}>Logged 14 days</span>
                  <strong>{cadence.loggedDaysLast14}/14</strong>
                </div>
                <div>
                  <span className={styles.statLabel}>Active projects</span>
                  <strong>{totals.activeProjects}</strong>
                </div>
              </div>
            </Card>

            <ActivityPanel items={data.activity} />
          </div>

          <div className={styles.sideColumn}>
            <AttentionPanel items={data.attention} />

            <Card title="Today" subtitle={`${hoursLabel(cadence.hoursToday)} logged · ${hoursLabel(cadence.hoursThisWeek)} this week`}>
              <div className={styles.todayStrip}>
                <span className={styles.streak}>
                  <Flame size={14} aria-hidden="true" />
                  {cadence.streakDays} day {cadence.streakDays === 1 ? "streak" : "streak"} of logged time
                </span>
              </div>

              <h3 className={styles.subHeading}>
                <CalendarDays size={13} aria-hidden="true" /> Calendar
              </h3>
              {feed.calendarError ? (
                <p className={styles.feedError}>{feed.calendarError}</p>
              ) : todayEvents.length === 0 ? (
                <p className={styles.emptyState}>Nothing on the calendar today.</p>
              ) : (
                <ul className={styles.feedList}>
                  {todayEvents.map((event) => (
                    <li key={event.id}>
                      <span className={styles.feedTime}>
                        {event.allDay ? "All day" : formatClock(event.startMs)}
                      </span>
                      <span className={styles.feedTitle}>{event.title}</span>
                    </li>
                  ))}
                </ul>
              )}

              <h3 className={styles.subHeading}>
                <Clock3 size={13} aria-hidden="true" /> Tasks
                <Link href="/tasks" className={styles.subHeadingLink}>
                  {tasks.open} open
                  <ArrowRight size={11} aria-hidden="true" />
                </Link>
              </h3>
              <div className={styles.taskCounts}>
                <Link
                  href="/tasks?overdue=true&sort=due&direction=asc"
                  className={`${styles.taskCount} ${tasks.overdue > 0 ? styles.taskCountBad : ""}`}
                >
                  {tasks.overdue} overdue
                </Link>
                <Link href={`/tasks?dueFrom=${data.today}&dueTo=${data.today}`} className={styles.taskCount}>
                  {tasks.dueToday} due today
                </Link>
                <span className={styles.taskCount}>{tasks.dueSoon} next 7 days</span>
              </div>
              {feed.taskError || tasks.syncError || tasks.stale ? (
                <p className={styles.feedNotice}>
                  {feed.taskError ??
                    (tasks.syncError ? `ClickUp sync failed: ${tasks.syncError}.` : "The task cache is stale.")}
                  {tasks.lastSyncedAt ? ` Last synced ${formatSync(tasks.lastSyncedAt)}.` : " Never synced."}
                </p>
              ) : null}
              {tasks.next.length === 0 ? (
                <p className={styles.emptyState}>No open assigned tasks in the cache.</p>
              ) : (
                <ul className={styles.feedList}>
                  {tasks.next.map((task) => {
                    const due = describeDue(task.dueDate, data.today, generatedAtMs);
                    return (
                      <li key={task.id}>
                        <span className={`${styles.priority} ${styles[priorityClass(task.priority)]}`}>
                          {priorityLabel(task.priority)}
                        </span>
                        <span className={styles.feedTitle}>
                          <Link href={`/tasks?id=${encodeURIComponent(task.id)}`}>{task.name}</Link>
                        </span>
                        {/* Outside the ellipsized span, so a long title never clips the link away. */}
                        {task.url ? (
                          <a
                            href={task.url}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.externalMini}
                            aria-label="Open in ClickUp"
                            title="Open in ClickUp"
                          >
                            <ExternalLink size={11} aria-hidden="true" />
                          </a>
                        ) : null}
                        <span
                          className={`${styles.feedTime} ${
                            due.tone === "overdue" ? styles.dueOverdue : due.tone === "today" ? styles.dueToday : ""
                          }`}
                        >
                          {due.label}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className={styles.quickActions}>
                <Link href="/time" className={styles.primaryButton}>
                  <Plus size={14} aria-hidden="true" /> Log time
                </Link>
                <Link href="/expenses" className={styles.secondaryButton}>
                  <Receipt size={14} aria-hidden="true" /> Expense
                </Link>
                <Link href="/mileage" className={styles.secondaryButton}>
                  <Car size={14} aria-hidden="true" /> Trip
                </Link>
                <Link href="/clients" className={styles.secondaryButton}>
                  <Users size={14} aria-hidden="true" /> Clients
                </Link>
              </div>
            </Card>

            <Card
              title={`Deductions ${tax.year}`}
              subtitle="Calendar year, whatever period is selected above"
              action={
                <Link href="/expenses" className={styles.ghostButton}>
                  Expenses
                  <ArrowRight size={13} aria-hidden="true" />
                </Link>
              }
            >
              <div className={styles.taxRow}>
                <div>
                  <span className={styles.statLabel}>Income</span>
                  <strong>{money(tax.income)}</strong>
                </div>
                <div>
                  <span className={styles.statLabel}>Deductible spend</span>
                  <strong>{money(tax.deductible)}</strong>
                </div>
                <div>
                  <span className={styles.statLabel}>Mileage</span>
                  <strong>{money(tax.mileageDeduction)}</strong>
                  <span className={styles.subtle}>
                    {tax.mileageMiles.toLocaleString()} mi × {currencyCents.format(tax.mileageRate)}
                  </span>
                </div>
              </div>

              {tax.lines.length > 0 ? (
                <ul className={styles.lineList}>
                  {tax.lines.map((line) => (
                    <li key={`${line.line}-${line.category}`}>
                      <span className={styles.lineCategory}>{line.category}</span>
                      <span className={styles.subtle}>{line.line}</span>
                      <span className={styles.lineAmount}>{money(line.amount)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyState}>No expenses recorded this year yet.</p>
              )}

              {tax.uncategorizedCount > 0 ? (
                <p className={styles.footnote}>
                  {tax.uncategorizedCount.toLocaleString()} records ({money(tax.uncategorizedAmount)}) still have no
                  account code, so the lines above are incomplete.
                </p>
              ) : null}
            </Card>
          </div>
        </div>

        <footer className={styles.pageFooter}>
          <span>
            Read at {new Date(data.generatedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} ·{" "}
            {window_.label}: {window_.from} → {window_.to}
          </span>
          <Link href="/" className={styles.ghostButton}>
            Classic dashboard
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </footer>
      </div>
    </main>
  );
}
