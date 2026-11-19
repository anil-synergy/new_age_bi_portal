"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Box, PinOff, Settings2, X } from "lucide-react";
import { PencilIcon } from "@/modules/shared/components/animated-icons/PencilIcon";
import { cn } from "@/lib/utils";
import { PinIcon } from "@/modules/shared/components/animated-icons/PinIcon";
import type { ChartPayload, KpiPayload, MatrixPayload, NoteStyle, TablePayload } from "@/types";
import { ChatChart } from "@/modules/smart-chatbot/components/ChatChart";
import { ChatMatrixVisual, ChatTableVisual } from "@/modules/smart-chatbot/components/ChatDataVisual";
import { ChatKpi } from "@/modules/smart-chatbot/components/ChatKpi";
import { useTheme } from "@/modules/shared/providers/ThemeProvider";
import { useSmartConversationOptional } from "@/modules/smart-chatbot/hooks/useSmartConversation";
import { VisualEditPrompt } from "./VisualEditPrompt";
import { NoteEditor, NoteStyleControls } from "./note-card";

const STORAGE_KEY = "smart-visual-box";
const CARD_GAP = 16;
/** Pressing on these never starts a drag (they keep their own click behaviour). */
const DRAG_SKIP = "button, a, input, textarea, select, label, summary, details, [data-no-drag]";

export interface BoxVisual {
  id: string;
  title: string;
  createdAt: number;
  chartData?: ChartPayload;
  kpiData?: KpiPayload;
  kpis?: KpiPayload[];
  tableData?: TablePayload;
  matrixData?: MatrixPayload;
  /** A note created by N.O.V.A.: editable in the box and on the home screen. */
  noteData?: { text: string; style: NoteStyle };
  onHome: boolean;
  width?: number;
  height?: number;
  /** Where the card sits on the home board (set by dragging). Unset = automatic grid slot. */
  pos?: { x: number; y: number };
  /** Last SMART question used to create this visual (for edit / regenerate). */
  sourceQuestion?: string;
}

interface VisualBoxContextValue {
  items: BoxVisual[];
  open: boolean;
  setOpen: (open: boolean) => void;
  save: (visual: Omit<BoxVisual, "createdAt" | "onHome"> & { onHome?: boolean }) => void;
  pinHome: (id: string) => void;
  unpinHome: (id: string) => void;
  resize: (id: string, width: number, height: number) => void;
  rename: (id: string, title: string) => void;
  updateNote: (id: string, patch: { text?: string; style?: Partial<NoteStyle> }) => void;
  moveItem: (id: string, pos: { x: number; y: number }) => void;
  remove: (id: string) => void;
}

const VisualBoxContext = createContext<VisualBoxContextValue | null>(null);

function loadItems(): BoxVisual[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as BoxVisual[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function VisualBoxProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<BoxVisual[]>([]);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setItems(loadItems());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items, ready]);

  const save = useCallback((visual: Omit<BoxVisual, "createdAt" | "onHome"> & { onHome?: boolean }) => {
    setItems((prev) => {
      const existing = prev.find((item) => item.id === visual.id);
      const next: BoxVisual = {
        ...visual,
        createdAt: existing?.createdAt ?? Date.now(),
        onHome: visual.onHome ?? existing?.onHome ?? false,
        width: visual.width ?? existing?.width,
        height: visual.height ?? existing?.height,
        pos: visual.pos ?? existing?.pos,
      };
      const without = prev.filter((item) => item.id !== visual.id);
      return [next, ...without].slice(0, 40);
    });
  }, []);

  const pinHome = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, onHome: true } : item)));
  }, []);

  const unpinHome = useCallback((id: string) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, onHome: false } : item)));
  }, []);

  const resize = useCallback((id: string, width: number, height: number) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, width, height } : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const rename = useCallback((id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, title: trimmed } : item)));
  }, []);

  // Notes: text and style changes go into the box item, so the box and the home screen show them at once.
  const updateNote = useCallback((id: string, patch: { text?: string; style?: Partial<NoteStyle> }) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id && item.noteData
          ? {
              ...item,
              noteData: {
                text: patch.text ?? item.noteData.text,
                style: { ...item.noteData.style, ...(patch.style ?? {}) },
              },
            }
          : item,
      ),
    );
  }, []);

  const moveItem = useCallback((id: string, pos: { x: number; y: number }) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, pos: { x: Math.round(pos.x), y: Math.round(pos.y) } } : item)));
  }, []);

  const value = useMemo(
    () => ({ items, open, setOpen, save, pinHome, unpinHome, resize, rename, updateNote, moveItem, remove }),
    [items, open, save, pinHome, unpinHome, resize, rename, updateNote, moveItem, remove]
  );

  return <VisualBoxContext.Provider value={value}>{children}</VisualBoxContext.Provider>;
}

export function useVisualBox() {
  const ctx = useContext(VisualBoxContext);
  if (!ctx) throw new Error("useVisualBox must be used within VisualBoxProvider");
  return ctx;
}

function BoxNote({ item, fill }: { item: BoxVisual; fill: boolean }) {
  const { updateNote } = useVisualBox();
  const note = item.noteData;
  if (!note) return null;
  return <NoteEditor text={note.text} style={note.style} fill={fill} onText={(text) => updateNote(item.id, { text })} />;
}

export function VisualPreview({ item, fill = false, pinnedHome = false }: { item: BoxVisual; fill?: boolean; pinnedHome?: boolean }) {
  const { theme } = useTheme();
  const pinnedLabelColor = pinnedHome ? (theme === "dark" ? "#ffffff" : "#333869") : undefined;
  if (item.noteData) return <BoxNote item={item} fill={fill} />;
  if (item.chartData) return <ChatChart data={item.chartData} fill={fill} labelColor={pinnedLabelColor} />;
  if (item.tableData) return <ChatTableVisual table={item.tableData} fill={fill} />;
  if (item.matrixData) return <ChatMatrixVisual matrix={item.matrixData} fill={fill} />;
  if (item.kpis?.length) {
    return (
      <div className="grid grid-cols-1 gap-2">
        {item.kpis.map((kpi) => (
          <ChatKpi key={kpi.label} data={kpi} />
        ))}
      </div>
    );
  }
  if (item.kpiData) return <ChatKpi data={item.kpiData} />;
  return null;
}

function VisualTitleEditor({
  title,
  onSave,
  className,
  inputClassName,
  multiline = false,
}: {
  title: string;
  onSave: (next: string) => void;
  className?: string;
  inputClassName?: string;
  multiline?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed) onSave(trimmed);
    else setDraft(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        type="text"
        value={draft}
        autoFocus
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            setDraft(title);
            setEditing(false);
          }
        }}
        className={cn(
          "pinned-visual-card__title-input w-full min-w-0 rounded-md border px-2 py-0.5 text-inherit focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--smart-chrome-indigo,#333869)]",
          inputClassName,
        )}
        aria-label="Edit visual title"
      />
    );
  }

  return (
    <button
      type="button"
      className={cn(
        "min-w-0 w-full cursor-text text-left font-semibold focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--smart-chrome-indigo,#333869)]",
        multiline ? "whitespace-pre-line" : "truncate",
        className,
      )}
      title="Click to edit title"
      onClick={() => setEditing(true)}
    >
      {title}
    </button>
  );
}

type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** Cards keep their top-left corner where the user dropped them, so only the right and bottom edges resize. */
const RESIZE_HIT: Partial<Record<ResizeEdge, string>> = {
  s: "bottom-0 left-2 right-2 h-2 cursor-ns-resize",
  e: "top-2 bottom-2 right-0 w-2 cursor-ew-resize",
  se: "bottom-0 right-0 h-3 w-3 cursor-nwse-resize",
};

function VisualResizeHandles({
  onResizeStart,
}: {
  onResizeStart: (edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <>
      {(Object.keys(RESIZE_HIT) as ResizeEdge[]).map((edge) => (
        <div
          key={edge}
          aria-hidden
          data-no-drag
          className={cn("absolute z-20 touch-none bg-transparent", RESIZE_HIT[edge])}
          onPointerDown={(event) => onResizeStart(edge, event)}
        />
      ))}
    </>
  );
}

export function defaultFrame(item: BoxVisual): { w: number; h: number } {
  if (item.noteData) return { w: 300, h: 240 };
  if (item.chartData) {
    const labels = Math.max(1, item.chartData.labels.length);
    const w = Math.min(640, Math.max(280, labels * 16 + 72));
    const h = item.chartData.type === "pie" ? Math.min(380, w + 48) : Math.min(320, 200 + labels * 4);
    return { w, h };
  }
  const count = Math.max(1, item.kpis?.length ?? (item.kpiData ? 1 : 1));
  return { w: 260, h: Math.min(360, 84 * count + 28) };
}

/** Size of a card: the size the user set, or the default for its content. */
function frameOf(item: BoxVisual): { w: number; h: number } {
  return item.width && item.height ? { w: item.width, h: item.height } : defaultFrame(item);
}

/** Grid slots for cards that were never moved, in pinned order, wrapped to the board width. */
function autoSlots(items: BoxVisual[], boardWidth: number): Map<string, { x: number; y: number }> {
  const slots = new Map<string, { x: number; y: number }>();
  let x = CARD_GAP;
  let y = CARD_GAP;
  let rowHeight = 0;
  for (const item of items) {
    const frame = frameOf(item);
    if (x > CARD_GAP && x + frame.w > boardWidth - CARD_GAP) {
      x = CARD_GAP;
      y += rowHeight + CARD_GAP;
      rowHeight = 0;
    }
    slots.set(item.id, { x, y });
    x += frame.w + CARD_GAP;
    rowHeight = Math.max(rowHeight, frame.h);
  }
  return slots;
}

function PinnedVisualCard({ item, pos, boardWidth }: { item: BoxVisual; pos: { x: number; y: number }; boardWidth: number }) {
  const { unpinHome, resize, rename, moveItem, updateNote } = useVisualBox();
  const smart = useSmartConversationOptional();
  const cardRef = useRef<HTMLElement>(null);
  const natural = frameOf(item);
  const [live, setLive] = useState<{ w: number; h: number } | null>(null);
  const [dragAt, setDragAt] = useState<{ x: number; y: number } | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [styleOpen, setStyleOpen] = useState(false);
  const frame = live ?? natural;
  const at = dragAt ?? pos;

  function startDrag(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest(DRAG_SKIP)) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const origin = at;
    const clampX = (x: number) => Math.min(Math.max(0, x), Math.max(0, boardWidth - frame.w));
    const next = (ev: PointerEvent) => ({
      x: clampX(origin.x + ev.clientX - startX),
      y: Math.max(0, origin.y + ev.clientY - startY),
    });
    const move = (ev: PointerEvent) => setDragAt(next(ev));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const end = next(ev);
      setDragAt(null);
      if (end.x !== origin.x || end.y !== origin.y) moveItem(item.id, end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const originX = event.clientX;
    const originY = event.clientY;
    const start = frame;
    const scrollRoot = cardRef.current?.closest(".pinned-home-board");
    const bounds = scrollRoot?.getBoundingClientRect() ?? cardRef.current?.parentElement?.getBoundingClientRect();
    const maxW = Math.max(220, bounds?.width ?? 960);
    const maxH = Math.max(140, bounds?.height ?? 640);
    const clampFrame = (dx: number, dy: number) => {
      let w = start.w;
      let h = start.h;
      if (edge.includes("e")) w = start.w + dx;
      if (edge.includes("s")) h = start.h + dy;
      return {
        w: Math.round(Math.min(maxW, Math.max(220, w))),
        h: Math.round(Math.min(maxH, Math.max(140, h))),
      };
    };
    const move = (ev: PointerEvent) => setLive(clampFrame(ev.clientX - originX, ev.clientY - originY));
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const next = clampFrame(ev.clientX - originX, ev.clientY - originY);
      setLive(null);
      resize(item.id, next.w, next.h);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const canEdit = Boolean(item.chartData && smart?.openWithPrompt);

  return (
    <>
      <article
        ref={cardRef}
        onPointerDown={startDrag}
        title="Drag to move"
        style={{ left: at.x, top: at.y, width: frame.w, height: frame.h, maxWidth: "100%" }}
        className="pinned-visual-card group/card absolute cursor-grab select-none touch-none overflow-visible rounded-[18px] text-sm active:cursor-grabbing"
      >
        <div className="pinned-visual-card__inner flex h-full min-h-0 flex-col pb-0 pt-1">
          <VisualTitleEditor
            title={item.title}
            onSave={(next) => rename(item.id, next)}
            className="pinned-visual-card__title shrink-0 px-2 pr-24 text-xs tracking-wide"
          />
          <div className="pinned-visual-card__content pinned-visual-card__copy mt-1 min-h-0 min-w-0 flex-1 overflow-hidden rounded-none border-0 p-0">
            <VisualPreview item={item} fill pinnedHome />
          </div>
        </div>
        <div className="pointer-events-none absolute right-0 top-0 z-30 flex gap-1 p-1.5 opacity-0 transition-opacity group-hover/card:pointer-events-auto group-hover/card:opacity-100">
          {canEdit && (
            <button
              type="button"
              aria-label="Edit visual colors and regenerate"
              title="Edit visual (opens SMART)"
              className="rounded-md bg-transparent p-1 text-slate-600 shadow-none hover:bg-transparent dark:text-white"
              onClick={() => setEditOpen(true)}
            >
              <PencilIcon size={14} isAnimated className="portal-animated-icon" color="currentColor" />
            </button>
          )}
          {item.noteData && (
            <button
              type="button"
              aria-label="Note settings"
              title="Note settings"
              aria-expanded={styleOpen}
              className="rounded-md bg-transparent p-1 text-slate-600 shadow-none hover:bg-transparent dark:text-white"
              onClick={() => setStyleOpen((open) => !open)}
            >
              <Settings2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Unpin from home"
            title="Unpin from home"
            className="rounded-md bg-transparent p-1 text-slate-600 shadow-none hover:bg-transparent dark:text-white"
            onClick={() => unpinHome(item.id)}
          >
            <PinOff className="h-3.5 w-3.5" />
          </button>
        </div>
        {item.noteData && styleOpen && (
          <div
            data-no-drag
            role="dialog"
            aria-label="Note settings"
            className="absolute right-1 top-9 z-40 w-64 rounded-lg border border-black/10 bg-white p-3 text-slate-800 shadow-xl"
            onKeyDown={(event) => {
              if (event.key === "Escape") setStyleOpen(false);
            }}
          >
            <div className="mb-1 flex items-center justify-between text-xs font-semibold">
              Note settings
              <button type="button" aria-label="Close note settings" className="rounded p-0.5 hover:bg-slate-100" onClick={() => setStyleOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <NoteStyleControls style={item.noteData.style} onChange={(style) => updateNote(item.id, { style })} />
          </div>
        )}
        <VisualResizeHandles onResizeStart={startResize} />
      </article>
      <VisualEditPrompt
        open={editOpen}
        title={item.title}
        contextQuestion={item.sourceQuestion}
        onClose={() => setEditOpen(false)}
        onSubmit={(prompt) => smart?.openWithPrompt(prompt)}
      />
    </>
  );
}

export function PinnedHomeBoard() {
  const { items } = useVisualBox();
  const pinned = items.filter((item) => item.onHome);
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(960);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    setBoardWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setBoardWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!pinned.length) return null;
  const slots = autoSlots(pinned, boardWidth);
  const positions = pinned.map((item) => ({ item, at: item.pos ?? slots.get(item.id) ?? { x: CARD_GAP, y: CARD_GAP } }));
  const canvasHeight = Math.max(0, ...positions.map(({ item, at }) => at.y + frameOf(item).h)) + CARD_GAP * 8;

  return (
    <div
      ref={boardRef}
      className="pinned-home-board relative z-[2] h-full min-h-0 w-full overflow-x-hidden overflow-y-auto overscroll-y-contain px-4 pb-32"
      style={{ paddingTop: "calc(0.5rem + 3rem + 3px)" }}
    >
      <div className="relative w-full" style={{ minHeight: canvasHeight }}>
        {positions.map(({ item, at }) => (
          <PinnedVisualCard key={item.id} item={item} pos={at} boardWidth={boardWidth} />
        ))}
      </div>
    </div>
  );
}

export function VisualBoxButton() {
  const { setOpen } = useVisualBox();
  return (
    <button
      type="button"
      className="absolute bottom-6 right-6 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[#333869] text-white shadow-lg hover:bg-[#2a2f58]"
      aria-label="Open Visual box"
      onClick={() => setOpen(true)}
    >
      <Box className="h-5 w-5" />
    </button>
  );
}

export function VisualBoxWindow() {
  const { open, setOpen, items, pinHome, unpinHome, rename, updateNote, remove } = useVisualBox();
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-end justify-end bg-[#020a16]/45 p-4 backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Visual box"
        className="ocean-rise mb-16 flex max-h-[70%] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/30 bg-white/95 shadow-2xl backdrop-blur-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[#333869]">Visual box</h2>
            <p className="text-[11px] text-slate-500">Saved N.O.V.A. charts, KPI cards and notes</p>
          </div>
          <button type="button" className="rounded-md p-1 text-slate-500 hover:bg-slate-100" aria-label="Close Visual box" onClick={() => setOpen(false)}>
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {items.length === 0 && <p className="text-sm text-slate-500">Save a chart, KPI or note from SMART to keep it here.</p>}
          {items.map((item) => (
            <article key={item.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <VisualTitleEditor
                  title={item.title}
                  onSave={(next) => rename(item.id, next)}
                  className="text-sm font-medium text-[#0b2540]"
                  inputClassName="text-sm text-[#0b2540] bg-white"
                />
                <button type="button" className="text-[11px] text-slate-400 hover:text-red-600" onClick={() => remove(item.id)}>
                  Remove
                </button>
              </div>
              <VisualPreview item={item} />
              {item.noteData && (
                <details className="mt-2 text-xs text-slate-600">
                  <summary className="cursor-pointer select-none text-[#333869]">Style</summary>
                  <NoteStyleControls style={item.noteData.style} onChange={(style) => updateNote(item.id, { style })} />
                </details>
              )}
              <div className="mt-2">
                {item.onHome ? (
                  <button type="button" className="inline-flex items-center gap-1 text-[11px] text-[#333869]" onClick={() => unpinHome(item.id)}>
                    <PinOff className="h-3 w-3" /> Remove from home
                  </button>
                ) : (
                  <button type="button" className="inline-flex items-center gap-1 text-[11px] text-[#333869]" onClick={() => pinHome(item.id)}>
                    <PinIcon size={12} className="portal-animated-icon" /> Pin to home
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
