"use client";

/**
 * The navigation shell around every screen except /login.
 *
 * Structure follows mission-control's layout — a sectioned sidebar with every
 * module reachable in one click, active highlight, meta in the footer — with
 * this dashboard's own visual language. Tasks, Time, Expenses, and Mileage are
 * live; Calendar remains an honest placeholder rather than hidden, so the shape
 * of the finished app stays visible as each phase lands.
 *
 * On desktop the sidebar is fixed; under 860px it becomes a top bar with a
 * drawer. The content region deliberately adds no padding or width limits —
 * each page keeps its own layout exactly as before the shell existed.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  Car,
  Clock3,
  ExternalLink,
  FolderKanban,
  Gauge,
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
      { href: "/command", label: "Command Center", icon: <Gauge size={16} /> },
      { href: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
      { href: "/clients", label: "Clients", icon: <Users size={16} /> },
      { href: "/projects", label: "Projects", icon: <FolderKanban size={16} /> }
    ]
  },
  {
    label: "Track",
    items: [
      { href: "/tasks", label: "Tasks", icon: <ListTodo size={16} /> },
      { href: "/time", label: "Time", icon: <Clock3 size={16} /> },
      { href: "/expenses", label: "Expenses", icon: <Receipt size={16} /> },
      { href: "/mileage", label: "Mileage", icon: <Car size={16} /> },
      { href: "/calendar", label: "Calendar", icon: <CalendarDays size={16} />, hint: "soon" }
    ]
  },
  {
    label: "System",
    items: [{ href: "/settings", label: "Settings", icon: <Settings size={16} /> }]
  }
];

// Outbound links are configured per deployment. Each link is hidden when its
// env var is unset, and the External section is hidden when none are set.
// NEXT_PUBLIC_* values are inlined at build time, so they must be referenced
// directly (no dynamic lookup) and a rebuild is needed after changing them.
const EXTERNAL_ITEMS: NavItem[] = [
  {
    href: process.env.NEXT_PUBLIC_EXTERNAL_TASKS_URL?.trim() ?? "",
    label: "Mission Control tasks",
    icon: <ListTodo size={16} />,
    external: true
  },
  {
    href: process.env.NEXT_PUBLIC_HERMES_URL?.trim() ?? "",
    label: "Hermes",
    icon: <MessageSquare size={16} />,
    external: true
  }
].filter((item) => item.href.length > 0);

if (EXTERNAL_ITEMS.length > 0) {
  SECTIONS.push({ label: "External", items: EXTERNAL_ITEMS });
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ version, children }: { version: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 860px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!isMobile) {
      wasOpen.current = false;
      return;
    }
    if (open) {
      sidebarRef.current?.querySelector<HTMLElement>("a")?.focus();
    } else if (wasOpen.current) {
      menuButtonRef.current?.focus();
    }
    wasOpen.current = open;
  }, [isMobile, open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isMobile, open]);

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
          ref={menuButtonRef}
          type="button"
          className={styles.topbarButton}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="app-navigation"
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

      <aside
        ref={sidebarRef}
        id="app-navigation"
        inert={isMobile && !open}
        className={`${styles.sidebar} ${open ? styles.sidebarOpen : ""}`}
      >
        {nav}
      </aside>

      <div className={styles.content}>{children}</div>
    </div>
  );
}
