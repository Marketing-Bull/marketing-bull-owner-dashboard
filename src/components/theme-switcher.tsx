"use client";

import { useEffect, useState } from "react";
import { Contrast, Moon, Sun } from "lucide-react";
import styles from "./theme-switcher.module.css";

export type ThemeId = "paper" | "midnight" | "contrast";

const THEME_STORAGE_KEY = "owner-dashboard-theme";

const THEMES: Array<{
  id: ThemeId;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  { id: "paper", label: "Paper", description: "Warm light", icon: Sun },
  { id: "midnight", label: "Midnight", description: "Low-light dark", icon: Moon },
  { id: "contrast", label: "Contrast", description: "Maximum clarity", icon: Contrast }
];

function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "midnight" ? "dark" : "light";
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<ThemeId>("paper");

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    const nextTheme = THEMES.some((option) => option.id === savedTheme) ? (savedTheme as ThemeId) : "paper";
    const frame = window.requestAnimationFrame(() => {
      setTheme(nextTheme);
      applyTheme(nextTheme);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function selectTheme(nextTheme: ThemeId) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }

  return (
    <div className={`${styles.switcher} ${compact ? styles.compact : ""}`} aria-label="Color theme">
      {compact ? <span className={styles.compactLabel}>Theme</span> : <span className={styles.label}>Theme</span>}
      <div className={styles.controls} role="group" aria-label="Select color theme">
        {THEMES.map((option) => {
          const Icon = option.icon;
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`${styles.option} ${active ? styles.optionActive : ""}`}
              onClick={() => selectTheme(option.id)}
              aria-pressed={active}
              title={`${option.label}: ${option.description}`}
            >
              <Icon size={14} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
