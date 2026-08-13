"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Palette } from "lucide-react";
import styles from "./theme-switcher.module.css";

export type ThemeId = "paper" | "midnight" | "contrast";

const THEME_STORAGE_KEY = "owner-dashboard-theme";
const THEME_EVENT = "owner-dashboard-theme-change";

const THEMES: Array<{ id: ThemeId; label: string; description: string }> = [
  { id: "paper", label: "Paper", description: "Warm light" },
  { id: "midnight", label: "Midnight", description: "Low-light dark" },
  { id: "contrast", label: "Contrast", description: "Maximum clarity" }
];

function isTheme(value: string | null): value is ThemeId {
  return THEMES.some((option) => option.id === value);
}

function getThemeSnapshot(): ThemeId {
  const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isTheme(savedTheme) ? savedTheme : "paper";
}

function subscribeToTheme(onChange: () => void): () => void {
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function applyTheme(theme: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "midnight" ? "dark" : "light";
}

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useSyncExternalStore<ThemeId>(subscribeToTheme, getThemeSnapshot, () => "paper");

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function selectTheme(nextTheme: ThemeId) {
    window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new Event(THEME_EVENT));
  }

  return (
    <label className={`${styles.switcher} ${compact ? styles.compact : ""}`}>
      <span className={styles.label}>{compact ? "Theme" : "Color theme"}</span>
      <span className={styles.controlWrap}>
        <Palette size={14} aria-hidden="true" className={styles.icon} />
        <select
          className={styles.select}
          value={theme}
          onChange={(event) => selectTheme(event.target.value as ThemeId)}
          aria-label="Color theme"
        >
          {THEMES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
