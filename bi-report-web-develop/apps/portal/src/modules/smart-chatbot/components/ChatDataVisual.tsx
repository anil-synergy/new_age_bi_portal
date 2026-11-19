"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { MatrixPayload, TablePayload } from "@/types";

const PREVIEW_ROWS = 8;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(value);
}

function formatNum(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface ChatTableVisualProps {
  table: TablePayload;
  fill?: boolean;
  previewRows?: number;
}

export function ChatTableVisual({ table, fill = false, previewRows = PREVIEW_ROWS }: ChatTableVisualProps) {
  const [expanded, setExpanded] = useState(false);
  const cap = fill ? table.rows.length : previewRows;
  const rows = expanded || fill ? table.rows : table.rows.slice(0, cap);
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-white dark:bg-slate-950/40",
        fill && "flex h-full min-h-0 flex-col",
      )}
    >
      <div className={cn("overflow-auto", fill ? "min-h-0 flex-1" : "max-h-64")}>
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <tr>
              {table.columns.map((c) => (
                <th key={c} className="whitespace-nowrap px-2 py-1 text-left font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                {table.columns.map((c) => (
                  <td key={c} className="whitespace-nowrap px-2 py-1 text-slate-700 dark:text-slate-200">
                    {formatCell(row[c])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!fill && (table.rows.length > previewRows || table.truncated) && (
        <div className="flex shrink-0 items-center justify-between border-t px-2 py-1 text-[10px] text-slate-500">
          {table.rows.length > previewRows ? (
            <button type="button" className="text-[var(--smart-accent)] hover:underline" onClick={() => setExpanded((e) => !e)}>
              {expanded ? "Show fewer rows" : `Show all ${table.rows.length} rows`}
            </button>
          ) : (
            <span />
          )}
          {table.truncated && <span>Result truncated</span>}
        </div>
      )}
      {fill && table.truncated && (
        <div className="shrink-0 border-t px-2 py-0.5 text-[10px] text-slate-500">Result truncated</div>
      )}
    </div>
  );
}

interface ChatMatrixVisualProps {
  matrix: MatrixPayload;
  fill?: boolean;
}

export function ChatMatrixVisual({ matrix, fill = false }: ChatMatrixVisualProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-md border bg-white dark:bg-slate-950/40",
        fill && "flex h-full min-h-0 flex-col",
      )}
    >
      <div className={cn("overflow-auto", fill ? "min-h-0 flex-1" : "max-h-64")}>
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-300">
            <tr>
              <th className="whitespace-nowrap px-2 py-1 text-left font-medium">{matrix.row_field}</th>
              {matrix.column_labels.map((c) => (
                <th key={c} className="whitespace-nowrap px-2 py-1 text-right font-medium">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.row_labels.map((rowLabel, ri) => (
              <tr key={rowLabel} className="border-t border-slate-100 dark:border-slate-800">
                <td className="whitespace-nowrap px-2 py-1 font-medium text-slate-700 dark:text-slate-200">{rowLabel}</td>
                {matrix.cells[ri]?.map((value, ci) => (
                  <td key={ci} className="whitespace-nowrap px-2 py-1 text-right text-slate-700 dark:text-slate-200">
                    {formatNum(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {matrix.truncated && (
        <div className="shrink-0 border-t px-2 py-0.5 text-[10px] text-slate-500">Matrix truncated to fit</div>
      )}
    </div>
  );
}