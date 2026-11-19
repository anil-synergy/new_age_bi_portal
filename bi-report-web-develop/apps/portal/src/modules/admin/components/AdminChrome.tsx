"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, MoreHorizontal, Search, X } from "lucide-react";
import { Header } from "@/modules/layout/components/Header";
import { Button } from "@/modules/shared/components/ui/button";
import { Input } from "@/modules/shared/components/ui/input";

export type Paged<T> = {
  items?: T[];
  currentPage?: number;
  totalPages?: number;
  totalItems?: number;
};

export function readPage<T>(data: Paged<T> | T[] | null | undefined): { items: T[]; page: number; totalPages: number } {
  if (Array.isArray(data)) return { items: data, page: 1, totalPages: 1 };
  const items = data?.items ?? [];
  const totalPages = Math.max(1, data?.totalPages || 1);
  return { items, page: data?.currentPage || 1, totalPages };
}

export function apiError(reason: unknown, fallback: string) {
  if (reason && typeof reason === "object" && "response" in reason) {
    const data = (reason as { response?: { data?: unknown } }).response?.data;
    if (typeof data === "string" && data.trim()) return data;
    if (data && typeof data === "object") {
      const body = data as { Message?: string; message?: string; title?: string; errors?: Record<string, string[] | string> };
      if (typeof body.Message === "string" && body.Message) return body.Message;
      if (typeof body.message === "string" && body.message) return body.message;
      const detail = body.errors
        ? Object.values(body.errors)
            .flat()
            .find((item) => typeof item === "string" && item)
        : undefined;
      if (detail) return detail;
      if (typeof body.title === "string" && body.title) return body.title;
    }
  }
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export function notifyAdminChanged() {
  window.dispatchEvent(new Event("portal:admin-changed"));
}

export function AdminScreen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <Header title={title} />
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-2 pt-14">{children}</div>
    </div>
  );
}

export type TagOption = { id: string; name: string; hint?: string; mappingId?: string };

export function TagPicker({
  label,
  options,
  selected,
  onChange,
  multiple = true,
  placeholder = "Search",
  compact = false,
}: {
  label: string;
  options: TagOption[];
  selected: TagOption[];
  onChange: (next: TagOption[]) => void;
  multiple?: boolean;
  placeholder?: string;
  /** Tighter vertical layout for admin report access columns. */
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const stripIndent = (text: string) => text.replace(/^\u00a0+/, "").trim();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((option) => !selected.some((item) => item.id === option.id))
      .filter((option) => {
        if (!q) return true;
        const label = stripIndent(option.name);
        const haystack = `${label} ${option.hint ?? ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 200);
  }, [options, query, selected]);

  useEffect(() => {
    const onPointer = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, []);

  const add = (option: TagOption) => {
    onChange(multiple ? [...selected, option] : [option]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="min-w-0">
      <p className={compact ? "mb-0.5 text-[11px] font-semibold text-slate-700" : "mb-1 text-xs font-medium text-slate-600"}>{label}</p>
      {selected.length > 0 ? (
        <div
          className={compact ? "mb-1 flex max-h-[52px] flex-wrap items-center gap-0.5 overflow-y-auto" : "flex min-h-8 flex-wrap items-center gap-1"}
        >
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex max-w-full items-center gap-0.5 truncate rounded-full bg-[#e7eef8] px-1.5 py-0.5 text-[11px] font-medium text-[#1d4e89] dark:bg-white/10 dark:text-white"
            >
              <span className="truncate">{tag.name}</span>
              <button
                type="button"
                className="shrink-0 rounded-full p-0.5 hover:bg-black/10"
                aria-label={`Remove ${tag.name}`}
                onClick={() => onChange(selected.filter((item) => item.id !== tag.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : compact ? null : (
        <div className="min-h-0" aria-hidden />
      )}
      <div className={compact ? "flex gap-1" : "mt-1 flex gap-1"}>
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden />
          <Input
            value={query}
            placeholder={placeholder}
            className={compact ? "h-8 border-slate-200 pl-8 text-xs shadow-none" : "h-8 pl-8"}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (matches[0]) add(matches[0]);
              }
            }}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          className={compact ? "h-8 shrink-0 border-slate-200 px-2.5 text-xs shadow-none" : "h-8 shrink-0 px-3"}
          onClick={() => matches[0] && add(matches[0])}
        >
          Add
        </Button>
      </div>
      {open && (
        <ul
          className={`relative z-20 mt-0.5 overflow-auto rounded-md border bg-card py-0.5 shadow-md ${compact ? "max-h-36" : "max-h-56"}`}
        >
          {matches.length === 0 ? (
            <li className="px-2 py-2 text-xs text-slate-500">
              {options.length === 0 ? "Nothing loaded — check the error message above." : "No matches for your search."}
            </li>
          ) : (
            matches.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-left text-sm hover:bg-muted"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => add(option)}
                >
                  {option.name}
                  {option.hint ? <span className="ml-2 text-xs text-slate-500">{option.hint}</span> : null}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function Flag({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  ) : (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-white">
      <X className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}

export function AdminToolbar({
  search,
  onSearch,
  searchPlaceholder,
  filter,
  onSearchClick,
  addLabel,
  onAdd,
}: {
  search: string;
  onSearch: (value: string) => void;
  searchPlaceholder: string;
  filter?: ReactNode;
  onSearchClick: () => void;
  addLabel: string;
  onAdd: () => void;
}) {
  return (
    <form
      className="mb-2 flex shrink-0 flex-wrap items-center gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSearchClick();
      }}
    >
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input className="pl-9" value={search} onChange={(event) => onSearch(event.target.value)} placeholder={searchPlaceholder} />
      </div>
      {filter}
      <Button type="submit" variant="outline" className="border-amber-400 text-amber-700 hover:bg-amber-50">
        SEARCH
      </Button>
      <Button type="button" className="ml-auto bg-amber-500 text-white hover:bg-amber-600" onClick={onAdd}>
        + {addLabel}
      </Button>
    </form>
  );
}

export function AdminPager({
  page,
  totalPages,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  totalPages: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  return (
    <div className="mt-2 flex shrink-0 items-center justify-center gap-3 text-sm">
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        PREVIOUS
      </Button>
      <span className="text-slate-600">
        {page} of {totalPages}
      </span>
      <select
        className="h-8 rounded-md border bg-background px-2 text-sm"
        value={pageSize}
        onChange={(event) => onPageSize(Number(event.target.value))}
      >
        {[20, 50, 100].map((size) => (
          <option key={size} value={size}>
            {size} rows
          </option>
        ))}
      </select>
      <Button type="button" size="sm" className="bg-indigo-500 text-white hover:bg-indigo-600" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        NEXT
      </Button>
    </div>
  );
}

export function RowMenu({
  open,
  onToggle,
  actions,
}: {
  open: boolean;
  onToggle: () => void;
  actions: { label: string; onClick: () => void }[];
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  return (
    <div>
      <button
        type="button"
        className="rounded p-1 text-muted-foreground hover:bg-muted"
        aria-label="Row actions"
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setPos({ top: rect.bottom + 4, left: rect.right });
          onToggle();
        }}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && pos && createPortal(
        <div className="fixed z-[80] min-w-[140px] -translate-x-full rounded-md border bg-card py-1 shadow-lg" style={{ top: pos.top, left: pos.left }}>
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
              onClick={action.onClick}
            >
              {action.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
