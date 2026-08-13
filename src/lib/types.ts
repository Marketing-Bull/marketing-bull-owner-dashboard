export type PhoneCallItem = {
  id: string;
  name: string;
  number: string;
  checked: boolean;
};

export type ManualState = {
  mrr: {
    current: string;
    projected: string;
    momDelta: string;
  };
  hyperfocus: {
    lens: string;
    target: string;
    why: string;
    bottleneck: string;
    subtract: [string, string, string];
    divide: {
      morning: string;
      midday: string;
      afternoon: string;
    };
    multiply: {
      dailyWin: string;
    };
  };
  goals: [string, string, string];
  phoneCalls: {
    toMake: PhoneCallItem[];
    made: PhoneCallItem[];
  };
  whatsImportant: string;
};

/**
 * One day's frozen copy of the manual state.
 *
 * Written once per day and rewritten by later saves on the same day, so the row
 * settles on where the day ended up. Yesterday's row is never touched again.
 */
export type HistoryEntry = {
  /** Local calendar day, `YYYY-MM-DD`. */
  day: string;
  dailyWin: string;
  lens: string;
  target: string;
  bottleneck: string;
  mrrCurrent: string;
  mrrProjected: string;
  mrrMomDelta: string;
  goals: [string, string, string];
  whatsImportant: string;
  callsMade: number;
  callsPlanned: number;
};

export type CalendarEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  calendarName: string;
  location?: string;
  href?: string;
};

/**
 * Client and Project — the first entities the dashboard owns rather than
 * reads (consolidation phase 2). Column parity with the target schema; see
 * `src/lib/schema.ts` migration 002 for what each field means.
 */
export const CLIENT_STATUSES = ["active", "prospect", "on_hold"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const PAYMENT_TYPES = ["mrr", "hourly", "one-time"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PROJECT_STATUSES = ["active", "on_hold", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export type Client = {
  id: string;
  /** Row id in the retired mission-control database; null for native rows. */
  mcId: number | null;
  name: string;
  status: ClientStatus;
  paymentType: PaymentType;
  mrr: number | null;
  hourlyRate: number | null;
  projectEstCost: number | null;
  paidThroughDate: string;
  invoiceStatus: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  notes: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: string;
  mcId: number | null;
  clientId: string | null;
  name: string;
  description: string;
  hourlyRateOverride: number | null;
  status: ProjectStatus;
  notes: string;
  urgent: boolean;
  important: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
};

/**
 * A saved unit of work. `rate` is a snapshot, not a live lookup: changing a
 * client or project rate later never restates an existing entry.
 */
export type TimeEntry = {
  id: string;
  /** Row id in the retired mission-control database; null for native rows. */
  mcId: number | null;
  clientId: string | null;
  projectId: string | null;
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  hours: number;
  rate: number;
  billable: boolean;
  details: string;
  /** Legacy/timer compatibility; the native form is intentionally hours-first. */
  startTime: string | null;
  endTime: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeEntryRecentDefaults = {
  clientId: string | null;
  projectId: string | null;
  billable: boolean;
};

export type ClickUpProject = {
  id: string;
  title: string;
  subtitle?: string;
  status?: string;
  href?: string;
};

export type PriorityBucket = {
  key: "P0" | "P1" | "P2" | "P3";
  label: string;
  projects: ClickUpProject[];
};

export type HoursEntry = {
  label: string;
  hours: number;
};

export type UpNextTask = {
  id: string;
  title: string;
  subtitle?: string;
  due: string;
  priority: "P0" | "P1" | "P2" | "P3";
  done: boolean;
  href?: string;
  /** ClickUp list the task belongs to; needed to resolve its status names. */
  listId?: string;
};

export type ClickUpSyncInfo = {
  lastSyncedAt: string | null;
  lastAttemptedAt: string | null;
  stale: boolean;
  refreshed: boolean;
  error?: string;
};

export type DashboardData = {
  priorities: PriorityBucket[];
  hours: {
    week: HoursEntry[];
    month: HoursEntry[];
  };
  upNext: UpNextTask[];
  source?: "live" | "sample";
  generatedAt?: number;
  clickUpSync?: ClickUpSyncInfo;
  /** Set when a route served sample data; explains what the live fetch hit. */
  fallbackReason?: string;
};

export type CalendarSource = "upstream" | "gog" | "local-store" | "sample";

export type CalendarResponse = {
  upcomingEvents: CalendarEvent[];
  source?: CalendarSource;
  fallbackReason?: string;
};
