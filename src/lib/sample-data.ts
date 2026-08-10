import type { CalendarEvent, DashboardData, ManualState } from "@/lib/types";

export const DEFAULT_MANUAL_STATE: ManualState = {
  mrr: {
    current: "42500",
    projected: "46800",
    momDelta: "8.4"
  },
  hyperfocus: {
    lens: "Work",
    target: "Use one screen to run the day without tab switching.",
    why: "Less drag at task start means faster decisions and cleaner follow-through.",
    bottleneck: "Too many active surfaces mean priorities get diluted before work begins.",
    subtract: [
      "Close tabs and tools that are not needed for today's bottleneck.",
      "Kill low-value admin before opening creative/client work.",
      "Remove ambiguous tasks that are really waiting on a decision."
    ],
    divide: {
      morning: "Clarity + bottleneck clearing",
      midday: "Calls, approvals, and calendar-bound work",
      afternoon: "Execution blocks and cleanup"
    },
    multiply: {
      streakDays: "5",
      dailyWin: "Start with the bottleneck before checking everything else."
    }
  },
  goals: [
    "Clear the real bottleneck, not the loudest task",
    "Convert the top live priority into a finished deliverable",
    "End the day with tomorrow already divided"
  ],
  phoneCalls: {
    toMake: [
      { id: "call-1", name: "Top lead follow-up", number: "(555) 010-2211", checked: false },
      { id: "call-2", name: "Bookkeeper", number: "(555) 010-7788", checked: false }
    ],
    made: [
      { id: "call-3", name: "Creative contractor", number: "(555) 010-1144", checked: true }
    ]
  },
  whatsImportant:
    "What matters today is clearing the single bottleneck that unlocks the rest of the queue."
};

export const SAMPLE_DASHBOARD_DATA: DashboardData = {
  priorities: [
    {
      key: "P0",
      label: "Critical",
      projects: [
        { id: "p0-1", title: "Owner dashboard data adapter", subtitle: "Infrastructure" },
        { id: "p0-2", title: "Mission Control smoke test", subtitle: "Cleanup" }
      ]
    },
    {
      key: "P1",
      label: "This week",
      projects: [
        { id: "p1-1", title: "RTT pilot page live review", subtitle: "Rock The Treatment" },
        { id: "p1-2", title: "Calendar polish and mobile pass", subtitle: "Owner dashboard" }
      ]
    },
    {
      key: "P2",
      label: "Queued",
      projects: [
        { id: "p2-1", title: "ClickUp time tracking sync", subtitle: "Integrations" },
        { id: "p2-2", title: "MRR books integration", subtitle: "Finance" }
      ]
    },
    {
      key: "P3",
      label: "Later",
      projects: [
        { id: "p3-1", title: "Ninth widget decision", subtitle: "Product" },
        { id: "p3-2", title: "Phone list CRM preload", subtitle: "CRM" }
      ]
    }
  ],
  projects: [
    { id: "proj-1", title: "RTT Mobile Site", subtitle: "Active" },
    { id: "proj-2", title: "Expert Witness Lead Campaign", subtitle: "Active" }
  ],
  clients: [
    { id: "client-1", title: "Rock The Treatment", subtitle: "Won" },
    { id: "client-2", title: "Dr. Sam R. Morhaim | Dentist", subtitle: "Won" }
  ],
  hours: {
    week: [
      { label: "Owner Dashboard", hours: 6.5 },
      { label: "RTT Minisite", hours: 4 },
      { label: "Mission Control", hours: 2.5 },
      { label: "Admin", hours: 1.5 }
    ],
    month: [
      { label: "RTT Minisite", hours: 24 },
      { label: "Owner Dashboard", hours: 18 },
      { label: "Mission Control", hours: 9 },
      { label: "Admin", hours: 6 }
    ]
  },
  upNext: [
    { id: "next-1", title: "Review today's P0 ClickUp items", subtitle: "Priority queue", due: "Today 10:30", priority: "P0", done: false },
    { id: "next-2", title: "Confirm MRR number for this month", subtitle: "Finance", due: "Today 12:00", priority: "P1", done: false },
    { id: "next-3", title: "Sanity-check upcoming calendar conflicts", subtitle: "Schedule", due: "Today 2:00", priority: "P1", done: false },
    { id: "next-4", title: "Pick the RTT keeper deliverable", subtitle: "Rock The Treatment", due: "Tomorrow", priority: "P2", done: false }
  ],
  source: "sample",
  generatedAt: Date.now()
};

export function buildSampleCalendarEvents(): CalendarEvent[] {
  const now = new Date();
  const at = (dayOffset: number, hour: number, minute: number) => {
    const date = new Date(now);
    date.setDate(now.getDate() + dayOffset);
    date.setHours(hour, minute, 0, 0);
    return date.getTime();
  };

  return [
    {
      id: "event-1",
      title: "Daily priorities review",
      startMs: at(0, 9, 30),
      endMs: at(0, 10, 0),
      allDay: false,
      calendarName: "Google Calendar",
      location: "HQ"
    },
    {
      id: "event-2",
      title: "RTT landing page check",
      startMs: at(0, 13, 0),
      endMs: at(0, 13, 30),
      allDay: false,
      calendarName: "Google Calendar",
      location: "Review"
    },
    {
      id: "event-3",
      title: "Client call",
      startMs: at(1, 11, 0),
      endMs: at(1, 12, 0),
      allDay: false,
      calendarName: "Google Calendar",
      location: "Zoom"
    },
    {
      id: "event-4",
      title: "Weekly planning",
      startMs: at(2, 10, 0),
      endMs: at(2, 11, 0),
      allDay: false,
      calendarName: "Google Calendar",
      location: "HQ"
    }
  ];
}
