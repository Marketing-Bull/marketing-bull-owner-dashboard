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
      streakDays: string;
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

export type DashboardData = {
  priorities: PriorityBucket[];
  hours: {
    week: HoursEntry[];
    month: HoursEntry[];
  };
  upNext: UpNextTask[];
  source?: "live" | "sample";
  generatedAt?: number;
  /** Set when a route served sample data; explains what the live fetch hit. */
  fallbackReason?: string;
};

export type CalendarSource = "upstream" | "gog" | "local-store" | "sample";

export type CalendarResponse = {
  upcomingEvents: CalendarEvent[];
  source?: CalendarSource;
  fallbackReason?: string;
};
