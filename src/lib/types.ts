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
};

export type ClickUpProject = {
  id: string;
  title: string;
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
  due: string;
  priority: "P0" | "P1" | "P2" | "P3";
  done: boolean;
  href?: string;
};

export type DashboardData = {
  priorities: PriorityBucket[];
  hours: {
    week: HoursEntry[];
    month: HoursEntry[];
  };
  upNext: UpNextTask[];
};
