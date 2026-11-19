"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type PortalTheme = "light" | "dark";

const STORAGE_KEY = "portal_theme";

interface ThemeState {
  theme: PortalTheme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

function applyTheme(theme: PortalTheme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<PortalTheme>("light");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
    setTheme(stored);
    applyTheme(stored);
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next: PortalTheme = current === "dark" ? "light" : "dark";
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
