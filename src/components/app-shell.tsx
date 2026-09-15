"use client";

/**
 * The navigation shell around every screen except /login.
 *
 * Minimal sidebar with only Calendar and Tasks.
 */

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  ListTodo,
  Menu,
  X
} from "lucide-react";
import styles from "./app-shell.module.css";

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  hint?: string;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: "Main",
    items: [
      { href: "/calendar", label: "Calendar", icon: <CalendarDays size={16} /> },
      { href: "/tasks", label: "Tasks", icon: <ListTodo size={16} /> }
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
          {section.items.map((item) => (
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
          ))}
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