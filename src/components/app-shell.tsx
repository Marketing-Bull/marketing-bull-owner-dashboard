"use client";

/**
 * The navigation shell around every screen except /login.
 *
 * Structure follows mission-control's layout — a sectioned sidebar with every
 * module reachable in one click, active highlight, meta in the footer — with
 * this dashboard's own visual language. Time, Expenses, and Mileage are live;
 * Calendar remains an honest placeholder rather than hidden, so the shape of
 * the finished app stays visible as each phase lands.
 *
 * On desktop the sidebar is fixed; under 860px it becomes a top bar with a
 * drawer. The content region deliberately adds no padding or width limits —
 * each page keeps its own layout exactly as before the shell existed.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Car,
  Clock3,
  ExternalLink,
  FolderKanban,
  LayoutDashboard,
  ListTodo,
  Menu,
  MessageSquare,
  Receipt,
  Settings,
  Users,
  X
} from "lucide-react";
import styles from "./app-shell.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
  external?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: "Operate",
    items: [
      { href: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
      { href: "/clients", label: "Clients", icon: <Users size={16} /> },
      { href: "/projects", label: "Projects", icon: <FolderKanban size={16} /> }
    ]
  },
  {
    label: "Track",
    items: [
      { href: "/time", label: "Time", icon: <Clock3 size={16} /> },
      { href: "/expenses", label: "Expenses", icon: <Receipt size={16} /> },
      { href: "/mileage", label: "Mileage", icon: <Car size={16} /> },
      { href: "/calendar", label: "Calendar", icon: <CalendarDays size={16} />, hint: "soon" }
    ]
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: <Settings size={16} /> }]
  },
  {
    label: "External",
    items: [
      // FIXME: both are hardcoded Tailscale addresses — dead links off the
      // tailnet. Same standing note as before the shell; move to env when
      // this stops being a single-owner app on one machine.
      { href: "http://100.119.59.63:3333/tasks", label: "Tasks (ClickUp)", icon: <ListTodo size={16} />, external: true },
      { href: "http://100.82.222.18:9119/chat", label: "Hermes", icon: <MessageSquare size={16} />, external: true }
    ]
  }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <>
      <Link href="/" className={styles.brand} onClick={() => setOpen(false)}>
        <span className={styles.brandEyebrow}>Marketing Bull</span>
        <span className={styles.brandName}>Owner Dashboard</span>
      </Link>

      {SECTIONS.map((section) => (
        <div key={section.label} className={styles.section}>
          <div className={styles.sectionLabel}>{section.label}</div>
          {section.items.map((item) =>
            item.external ? (
              <a
                key={item.href}
                href={item.href}
                target="_blank"
                rel="noreferrer"
                className={styles.item}
              >
                <span className={styles.itemIcon}>{item.icon}</span>
                {item.label}
                <span className={styles.itemHint}>
                  <ExternalLink size={11} />
                </span>
              </a>
            ) : (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.item} ${isActive(pathname, item.href) ? styles.itemActive : ""}`}
                onClick={() => setOpen(false)}
              >
                <span className={styles.itemIcon}>{item.icon}</span>
                {item.label}
                {item.hint ? <span className={styles.itemHint}>{item.hint}</span> : null}
              </Link>
            )
          )}
        </div>
      ))}

      <div className={styles.footer}>
        <span>{version}</span>
      </div>
    </>
  );

  return (
    <div className={styles.shell}>
      <div className={styles.topbar}>
        <button
          type="button"
          className={styles.topbarButton}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={17} /> : <Menu size={17} />}
        </button>
        <span className={styles.topbarTitle}>Owner Dashboard</span>
      </div>

      {open ? (
        <button
          type="button"
          className={styles.scrimOpen}
          aria-label="Close menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}>{nav}</aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
