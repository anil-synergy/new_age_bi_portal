import { captureReportPages } from "./capture";
import { blobToSnapshot, buildDocx, buildPdf, buildPptx } from "./documents";
import { openOutlookWithAttachment, openOutlookWithSnapshots } from "./outlook";
import { getSnapshotTarget } from "./target";

export type SnapshotFormat = "pdf" | "word" | "ppt" | "email";
export type SnapshotDelivery = "download" | "email";

const EXTENSION: Record<Exclude<SnapshotFormat, "email">, string> = {
  pdf: "pdf",
  word: "docx",
  ppt: "pptx",
};

function safeFileName(title: string) {
  const cleaned = title.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "report";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportSnapshots(input: {
  format: SnapshotFormat;
  delivery: SnapshotDelivery;
  reportTitle: string;
  pageNames: string[];
  stream: MediaStream;
  onStatus: (message: string) => void;
}) {
  const target = getSnapshotTarget();
  if (!target) throw new Error("Open a report before exporting.");

  const shots = await captureReportPages(target.report, target.canvas, input.pageNames, input.stream, input.onStatus);
  const images = await Promise.all(shots.map((shot) => blobToSnapshot(shot.title, shot.blob)));
  const baseName = safeFileName(input.reportTitle);
  const subject = input.reportTitle || "Report";

  if (input.format === "email") {
    if (input.delivery === "download") {
      const html = images
        .map((image) => {
          let binary = "";
          for (let i = 0; i < image.jpeg.length; i += 0x8000) {
            binary += String.fromCharCode(...Array.from(image.jpeg.subarray(i, i + 0x8000)));
          }
          return `<p><img src="data:image/jpeg;base64,${btoa(binary)}" alt="${image.title}" style="max-width:100%;height:auto"></p>`;
        })
        .join("");
      downloadBlob(new Blob([`<html><body>${html}</body></html>`], { type: "text/html" }), `${baseName}-pages.html`);
      return;
    }
    await openOutlookWithSnapshots({ subject, images });
    return;
  }

  const blob = input.format === "pdf" ? buildPdf(images, subject) : input.format === "word" ? buildDocx(images) : buildPptx(images);
  const fileName = `${baseName}.${EXTENSION[input.format]}`;
  if (input.delivery === "download") {
    downloadBlob(blob, fileName);
    return;
  }
  await openOutlookWithAttachment({
    subject,
    fileName,
    bytes: new Uint8Array(await blob.arrayBuffer()),
  });
}
