import type { CalendarEvent, DashboardData, ManualState } from "@/lib/types";

export const DEFAULT_MANUAL_STATE: ManualState = {
  mrr: {
    current: "42500",
    projected: "46800",
    momDelta: "8.4"
  },
  hyperfocus: {
    lens: "Work",
    target: "Keep clients, projects, tasks, time, calls, and calendar in one operating view.",
    why: "The dashboard should show the tables Marketing Bull owns and the feeds it reads.",
    bottleneck: "The next project decision is unclear.",
    subtract: [
      "Archive stale projects instead of letting them look active.",
      "Assign unassigned projects to the right client.",
      "Move non-owner tasks out of the active queue."
    ],
    divide: {
      morning: "Review clients, projects, and blockers",
      midday: "Calls, approvals, and scheduled work",
      afternoon: "Project execution and time cleanup"
    },
    multiply: {
      dailyWin: "Updated the project queue and recorded the next owner action."
    }
  },
  goals: [
    "Assign every active project to a client",
    "Mark the urgent and important flags honestly",
    "Close or move the next ClickUp task"
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
    "What matters today is keeping the client and project records honest enough to run the day from this screen."
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
  hours: {
    day: [
      { label: "Owner Dashboard", hours: 2.5 },
      { label: "Admin", hours: 0.5 }
    ],
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
