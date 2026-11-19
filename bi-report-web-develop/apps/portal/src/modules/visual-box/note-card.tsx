"use client";

import type { CSSProperties } from "react";
import { Bold, Italic, Palette, RotateCcw } from "lucide-react";
import type { NoteStyle } from "@/types";
import { cn } from "@/lib/utils";

export const DEFAULT_NOTE_STYLE: NoteStyle = {
  background: "#fef9c3",
  color: "#1f2937",
  fontSize: 16,
  fontFamily: "sans",
  bold: false,
  italic: false,
};

const FONT_STACK: Record<NoteStyle["fontFamily"], string> = {
  sans: "ui-sans-serif, system-ui, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
  hand: "'Segoe Print', 'Comic Sans MS', cursive",
};

const SWATCHES = ["#fef9c3", "#dcfce7", "#dbeafe", "#fce7f3", "#ffedd5", "#ffffff", "#1f2937", "#0b2540"];
const DARK = ["#1f2937", "#0b2540"];

function textStyle(style: NoteStyle): CSSProperties {
  return {
    fontSize: style.fontSize,
    fontFamily: FONT_STACK[style.fontFamily],
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? "italic" : "normal",
    color: style.color,
    lineHeight: 1.5,
  };
}

/** Read-only note (chat reply). */
export function NoteView({ text, style }: { text: string; style: NoteStyle }) {
  return (
    <div className="min-h-[4rem] whitespace-pre-wrap rounded-lg p-3" style={{ background: style.background, ...textStyle(style) }}>
      {text || <span className="opacity-60">Empty note</span>}
    </div>
  );
}

/** Editable note (Visual box and home screen). Every keystroke updates the saved note at once. */
export function NoteEditor({
  text,
  style,
  onText,
  fill = false,
}: {
  text: string;
  style: NoteStyle;
  onText: (next: string) => void;
  fill?: boolean;
}) {
  return (
    <textarea
      aria-label="Note text"
      value={text}
      onChange={(event) => onText(event.target.value)}
      placeholder="Write a note…"
      spellCheck
      className={cn(
        "w-full resize-none rounded-lg p-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--smart-chrome-indigo,#333869)]",
        fill ? "h-full min-h-0" : "min-h-[6rem]",
        DARK.includes(style.background.toLowerCase()) && "placeholder:text-white/50",
      )}
      style={{ background: style.background, ...textStyle(style) }}
    />
  );
}

/** Style options for one note: colours, size, font, bold, italic. */
export function NoteStyleControls({ style, onChange }: { style: NoteStyle; onChange: (patch: Partial<NoteStyle>) => void }) {
  const control = "rounded-md border border-black/10 bg-white px-2 py-1 text-xs text-slate-800 focus:outline-none";
  return (
    <div className="grid grid-cols-2 gap-2 pt-2 text-xs text-slate-700">
      <label className="flex items-center gap-1">
        <Palette className="h-3.5 w-3.5" aria-hidden /> Background
        <input type="color" aria-label="Background colour" value={style.background} onChange={(e) => onChange({ background: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </label>
      <label className="flex items-center gap-1">
        Text
        <input type="color" aria-label="Text colour" value={style.color} onChange={(e) => onChange({ color: e.target.value })} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
      </label>
      <div className="col-span-2 flex flex-wrap gap-1" role="group" aria-label="Background presets">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={`Background ${c}`}
            onClick={() => onChange({ background: c, color: DARK.includes(c) ? "#f8fafc" : style.color })}
            className="h-5 w-5 rounded-full border border-black/20"
            style={{ background: c }}
          />
        ))}
      </div>
      <label className="flex items-center gap-1">
        Size
        <input type="range" min={11} max={28} value={style.fontSize} aria-label="Font size" onChange={(e) => onChange({ fontSize: Number(e.target.value) })} className="w-24" />
        <span className="w-6 text-right tabular-nums">{style.fontSize}</span>
      </label>
      <label className="flex items-center gap-1">
        Font
        <select aria-label="Font family" value={style.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value as NoteStyle["fontFamily"] })} className={control}>
          <option value="sans">Sans</option>
          <option value="serif">Serif</option>
          <option value="mono">Mono</option>
          <option value="hand">Handwriting</option>
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-1">
        <button type="button" aria-pressed={style.bold} aria-label="Bold" onClick={() => onChange({ bold: !style.bold })} className={cn("rounded p-1 hover:bg-black/10", style.bold && "bg-black/15")}>
          <Bold className="h-3.5 w-3.5" />
        </button>
        <button type="button" aria-pressed={style.italic} aria-label="Italic" onClick={() => onChange({ italic: !style.italic })} className={cn("rounded p-1 hover:bg-black/10", style.italic && "bg-black/15")}>
          <Italic className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={() => onChange(DEFAULT_NOTE_STYLE)} className="ml-auto flex items-center gap-1 rounded px-2 py-1 hover:bg-black/10">
          <RotateCcw className="h-3.5 w-3.5" /> Reset style
        </button>
      </div>
    </div>
  );
}
