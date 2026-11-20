"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";

interface ThemeContextValue {
  choice: ThemeChoice;
  resolved: "light" | "dark";
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyThemeToDom(choice: ThemeChoice, systemDark: boolean) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  const metaVal = choice === "system" ? "light dark" : choice;
  if (meta) {
    meta.setAttribute("content", metaVal);
  }
  if (choice === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", choice);
  }
  const resolved = choice === "system" ? (systemDark ? "dark" : "light") : choice;
  document.documentElement.setAttribute("data-resolved-theme", resolved);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

const THEME_EVENT = "soundify-theme-change";

function subscribeSystemDark(cb: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

function getSystemDarkSnapshot(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getSystemDarkServerSnapshot(): boolean {
  return true;
}

function subscribeChoice(cb: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === "color-scheme") cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(THEME_EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(THEME_EVENT, cb);
  };
}

function getChoiceSnapshot(): ThemeChoice {
  try {
    const stored = localStorage.getItem("color-scheme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return "system";
}

function getChoiceServerSnapshot(): ThemeChoice {
  return "system";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const choice = useSyncExternalStore(subscribeChoice, getChoiceSnapshot, getChoiceServerSnapshot);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDarkSnapshot, getSystemDarkServerSnapshot);

  useEffect(() => {
    applyThemeToDom(choice, systemDark);
  }, [choice, systemDark]);

  const setChoice = useCallback(
    (next: ThemeChoice) => {
      try {
        if (next === "system") {
          localStorage.removeItem("color-scheme");
        } else {
          localStorage.setItem("color-scheme", next);
        }
      } catch {
        // ignore
      }
      const isSysDark = typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)").matches : systemDark;
      applyThemeToDom(next, isSysDark);
      window.dispatchEvent(new Event(THEME_EVENT));
    },
    [systemDark],
  );

  const resolved: "light" | "dark" = choice === "system" ? (systemDark ? "dark" : "light") : choice;

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved, setChoice],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
