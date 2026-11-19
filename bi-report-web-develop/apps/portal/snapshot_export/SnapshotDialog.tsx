"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { listReportPages, requestCanvasCapture, type ReportPageOption } from "./capture";
import { exportSnapshots, type SnapshotDelivery, type SnapshotFormat } from "./export-report";
import { getSnapshotTarget } from "./target";

const FORMAT_LABEL: Record<SnapshotFormat, string> = {
  pdf: "PDF",
  word: "Word",
  ppt: "PowerPoint",
  email: "Email",
};

interface SnapshotDialogProps {
  format: SnapshotFormat;
  reportTitle: string;
  anchor: DOMRect | null;
  onClose: () => void;
}

export function SnapshotDialog({ format, reportTitle, anchor, onClose }: SnapshotDialogProps) {
  const [pages, setPages] = useState<ReportPageOption[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [status, setStatus] = useState("Preparing snapshot…");

  useEffect(() => {
    const target = getSnapshotTarget();
    if (!target) {
      setError("Open a report, wait for it to finish loading, then export.");
      return;
    }
    listReportPages(target.report)
      .then((items) => {
        setPages(items);
        setSelected(items.map((item) => item.name));
      })
      .catch((reason: Error) => setError(reason.message || "Could not read the report pages."));
  }, []);

  const toggle = (name: string) => {
    setSelected((current) => (current.includes(name) ? current.filter((item) => item !== name) : [...current, name]));
  };

  const run = async (delivery: SnapshotDelivery) => {
    setError(null);
    let stream: MediaStream | null = null;
    try {
      const streamPromise = requestCanvasCapture();
      setStatus("Preparing snapshot…");
      setCapturing(true);
      stream = await streamPromise;
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await exportSnapshots({
        format,
        delivery,
        reportTitle,
        pageNames: selected,
        stream,
        onStatus: setStatus,
      });
      onClose();
    } catch (reason) {
      stream?.getTracks().forEach((track) => track.stop());
      const denied = reason instanceof DOMException && reason.name === "NotAllowedError";
      setError(denied ? "Allow this browser tab so only the report canvas can be captured." : reason instanceof Error ? reason.message : "Export failed.");
      setCapturing(false);
    }
  };

  const top = (anchor?.bottom ?? 48) + 6;
  const popupWidth = 320;
  const anchorLeft = anchor?.left ?? 8;
  const openToRight = anchorLeft + popupWidth + 16 < window.innerWidth;
  const left = Math.max(8, Math.min(anchorLeft, window.innerWidth - popupWidth - 8));
  const right = Math.max(8, window.innerWidth - (anchor?.right ?? window.innerWidth - 16));

  if (capturing) {
    return createPortal(
      <div
        className="fixed z-[100001] flex items-center gap-2 rounded-md bg-[#333869] px-3 text-xs text-white shadow"
        style={{ top: anchor?.top ?? 8, height: anchor?.height ?? 32, ...(openToRight ? { left: anchorLeft } : { right }) }}
        role="status"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#1aa6a0]" />
        {status}
      </div>,
      document.body
    );
  }

  const popup = (
    <>
      <div className="fixed inset-0 z-[100000]" onMouseDown={onClose} />
      <div
        className="fixed z-[100001] w-80 max-w-[calc(100vw-16px)] overflow-y-auto rounded-lg border border-[#e2e8f0] bg-white p-3 text-[#0b2540] shadow-xl"
        style={{ top, maxHeight: `calc(100vh - ${top + 12}px)`, ...(openToRight ? { left } : { right }) }}
        role="dialog"
        aria-label={`Export as ${FORMAT_LABEL[format]}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Export as {FORMAT_LABEL[format]}</h3>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-[#f4f7fb] hover:text-[#0b2540]"
            aria-label="Close export"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-2 text-xs text-slate-500">
          Choose the report pages. Send email opens Outlook with those snapshots in the message, or with the PDF, PowerPoint, or Word file attached.
        </p>
        <div className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
          {pages.length === 0 && !error && <p className="text-xs text-slate-500">Reading pages…</p>}
          {pages.map((page) => (
            <label key={page.name} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-[#f4f7fb]">
              <input type="checkbox" checked={selected.includes(page.name)} onChange={() => toggle(page.name)} />
              <span className="truncate">{page.displayName}</span>
            </label>
          ))}
        </div>
        {error && <p className="mb-2 text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm"
            disabled={!selected.length}
            onClick={() => run("download")}
          >
            Download
          </button>
          <button
            type="button"
            className="rounded-md bg-[#333869] px-3 py-1.5 text-sm text-white disabled:opacity-50"
            disabled={!selected.length}
            onClick={() => run("email")}
          >
            Send email
          </button>
        </div>
      </div>
    </>
  );

  return createPortal(popup, document.body);
}
