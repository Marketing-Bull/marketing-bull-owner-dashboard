import type { CalendarEvent, DashboardData, ManualState } from "@/lib/types";

export const DEFAULT_MANUAL_STATE: ManualState = {
  mrr: {
    current: "42500",
    projected: "46800",
    momDelta: "8.4"
  },
  goals: [
    "Ship the standalone owner dashboard",
    "Finalize the Medium Women's RTT page push",
    "Clear the Mission Control smoke-test/commit decision"
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
    "Turn this into the one screen that replaces the morning tab circus."
};

export const SAMPLE_DASHBOARD_DATA: DashboardData = {
  priorities: [
    {
      key: "P0",
      label: "Critical",
      projects: [
        { id: "p0-1", title: "Owner dashboard data adapter" },
        { id: "p0-2", title: "Mission Control smoke test" }
      ]
    },
    {
      key: "P1",
      label: "This week",
      projects: [
        { id: "p1-1", title: "RTT pilot page live review" },
        { id: "p1-2", title: "Calendar polish and mobile pass" }
      ]
    },
    {
      key: "P2",
      label: "Queued",
      projects: [
        { id: "p2-1", title: "ClickUp time tracking sync" },
        { id: "p2-2", title: "MRR books integration" }
      ]
    },
    {
      key: "P3",
      label: "Later",
      projects: [
        { id: "p3-1", title: "Ninth widget decision" },
        { id: "p3-2", title: "Phone list CRM preload" }
      ]
    }
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
    { id: "next-1", title: "Review today's P0 ClickUp items", due: "Today 10:30", priority: "P0", done: false },
    { id: "next-2", title: "Confirm MRR number for this month", due: "Today 12:00", priority: "P1", done: false },
    { id: "next-3", title: "Sanity-check upcoming calendar conflicts", due: "Today 2:00", priority: "P1", done: false },
    { id: "next-4", title: "Pick the RTT keeper deliverable", due: "Tomorrow", priority: "P2", done: false }
  ]
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
      calendarName: "Google Calendar"
    },
    {
      id: "event-2",
      title: "RTT landing page check",
      startMs: at(0, 13, 0),
      endMs: at(0, 13, 30),
      allDay: false,
      calendarName: "Google Calendar"
    },
    {
      id: "event-3",
      title: "Client call",
      startMs: at(1, 11, 0),
      endMs: at(1, 12, 0),
      allDay: false,
      calendarName: "Google Calendar"
    }
  ];
}
