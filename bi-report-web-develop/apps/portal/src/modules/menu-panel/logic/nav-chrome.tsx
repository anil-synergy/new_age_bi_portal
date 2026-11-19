"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePortal } from "@/context/PortalContext";
import { ENV_TAGS } from "@/lib/catalog/report-tags";
import { WaveMarkIcon } from "@/modules/shared/components/animated-icons/WaveMarkIcon";

const TAG_STORAGE_KEY = "portal.nav.activeTags";

function readStoredTags(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TAG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  } catch {
    return [];
  }
}

function writeStoredTags(tags: Set<string>) {
  try {
    window.localStorage.setItem(TAG_STORAGE_KEY, JSON.stringify(Array.from(tags)));
  } catch {
    // Private mode or a full quota: the choice still applies for this visit.
  }
}

interface NavChromeState {
  open: boolean;
  setOpen: (open: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
  activeTags: Set<string>;
  toggleTag: (tag: string) => void;
  availableTags: string[];
}

const NavChromeContext = createContext<NavChromeState | null>(null);

export function NavChromeProvider({ children }: { children: React.ReactNode }) {
  const { reports, isLoading } = usePortal();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(() => new Set());
  const [tagsHydrated, setTagsHydrated] = useState(false);

  const availableTags = useMemo(() => {
    const categoryTags = new Set<string>();
    for (const report of reports) if (report.categoryName) categoryTags.add(report.categoryName);
    return [...ENV_TAGS, ...Array.from(categoryTags).sort()];
  }, [reports]);

  useEffect(() => {
    const stored = readStoredTags();
    if (stored.length > 0) setActiveTags(new Set(stored));
    setTagsHydrated(true);
  }, []);

  useEffect(() => {
    if (!tagsHydrated || isLoading) return;
    const allowed = new Set(availableTags);
    setActiveTags((current) => {
      let changed = false;
      const next = new Set<string>();
      Array.from(current).forEach((tag) => {
        if (allowed.has(tag)) next.add(tag);
        else changed = true;
      });
      return changed ? next : current;
    });
  }, [tagsHydrated, isLoading, availableTags]);

  useEffect(() => {
    if (!tagsHydrated) return;
    writeStoredTags(activeTags);
  }, [tagsHydrated, activeTags]);

  const value = useMemo<NavChromeState>(
    () => ({
      open,
      setOpen,
      search,
      setSearch,
      activeTags,
      toggleTag: (tag: string) => {
        setActiveTags((current) => {
          const next = new Set(current);
          if (next.has(tag)) next.delete(tag);
          else next.add(tag);
          return next;
        });
      },
      availableTags,
    }),
    [open, search, activeTags, availableTags]
  );

  return <NavChromeContext.Provider value={value}>{children}</NavChromeContext.Provider>;
}

export function useNavChrome() {
  const value = useContext(NavChromeContext);
  if (!value) throw new Error("Report navigation is not available.");
  return value;
}

export function WaveMark() {
  return <WaveMarkIcon className="h-[18px] w-8" width={32} height={18} isAnimated />;
}
