import type { Report } from "powerbi-client";

export interface ReportPageOption {
  name: string;
  displayName: string;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function settle(promise: Promise<unknown>, ms: number) {
  try {
    await withTimeout(promise, ms, "timeout");
  } catch {
    // Best effort: a slow Power BI call must not block the export.
  }
}

export async function listReportPages(report: Report): Promise<ReportPageOption[]> {
  const pages = await withTimeout(report.getPages(), 15000, "Power BI did not return the report pages.");
  const visible = pages.filter((page) => page.visibility !== 1);
  const source = visible.length > 0 ? visible : pages;
  return source.map((page) => ({
    name: page.name,
    displayName: page.displayName || page.name,
  }));
}

export function requestCanvasCapture(): Promise<MediaStream> {
  const options = {
    video: { frameRate: 8 },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
  };
  return navigator.mediaDevices.getDisplayMedia(options as DisplayMediaStreamOptions);
}

async function startVideo(video: HTMLVideoElement) {
  await settle(video.play(), 3000);
  const started = Date.now();
  while (video.videoWidth === 0 && Date.now() - started < 5000) await sleep(100);
  if (video.videoWidth === 0) throw new Error("The browser did not provide a picture of this tab. Try the export again.");
}

type FrameGrabber = { grabFrame: () => Promise<ImageBitmap> };

/** Reads a fresh frame from the track; the <video> element can still hold an older picture. */
async function latestFrame(
  grabber: FrameGrabber | null,
  video: HTMLVideoElement
): Promise<{ source: CanvasImageSource; width: number; height: number; close?: () => void }> {
  if (grabber) {
    try {
      const bitmap = await withTimeout(grabber.grabFrame(), 1500, "grab timeout");
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch {
      // Fall back to the video element below.
    }
  }
  return { source: video, width: video.videoWidth, height: video.videoHeight };
}

function waitForEvent(report: Report, eventName: string, ms: number) {
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(() => {
      report.off(eventName, onEvent);
      resolve();
    }, ms);
    const onEvent = () => {
      window.clearTimeout(timer);
      report.off(eventName, onEvent);
      resolve();
    };
    report.on(eventName, onEvent);
  });
}

/** Switches the embedded report and waits until that page is the active one. */
async function activatePage(report: Report, pageName: string, displayName: string) {
  const pages = await report.getPages();
  const page = pages.find((item) => item.name === pageName);
  if (!page) throw new Error(`"${displayName}" is no longer in this report.`);
  const current = await report.getActivePage().catch(() => null);
  if (current?.name === pageName) {
    await sleep(500);
    return;
  }
  const rendered = waitForEvent(report, "rendered", 15000);
  await withTimeout(page.setActive(), 10000, `Could not open "${displayName}".`);
  const started = Date.now();
  let activeName = "";
  while (Date.now() - started < 8000) {
    const active = await report.getActivePage().catch(() => null);
    activeName = active?.name ?? "";
    if (activeName === pageName) break;
    await sleep(200);
  }
  if (activeName !== pageName) {
    throw new Error(`The report stayed on another page instead of "${displayName}".`);
  }
  await rendered;
  await sleep(700);
}

/** A cross-origin Power BI frame does not wake tab capture by itself. Nudge, then put the iframe back so the picture itself is not shifted. */
function nudgeIframe(iframe: HTMLElement) {
  iframe.style.transform = "translateZ(0.1px)";
  void iframe.offsetWidth;
}

function releaseIframe(iframe: HTMLElement) {
  iframe.style.transform = "";
  void iframe.offsetWidth;
}

async function waitForFreshFrame(video: HTMLVideoElement) {
  if ("requestVideoFrameCallback" in video) {
    await Promise.race([
      new Promise<void>((resolve) => video.requestVideoFrameCallback(() => resolve())),
      sleep(1200),
    ]);
    return;
  }
  await sleep(500);
}

async function fingerprint(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 64) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length}:${hash >>> 0}`;
}

async function grabCanvas(grabber: FrameGrabber | null, video: HTMLVideoElement, target: HTMLElement): Promise<Blob> {
  const frame = await latestFrame(grabber, video);
  const rect = target.getBoundingClientRect();
  const scaleX = frame.width / Math.max(1, window.innerWidth);
  const scaleY = frame.height / Math.max(1, window.innerHeight);
  const sx = Math.max(0, rect.left * scaleX);
  const sy = Math.max(0, rect.top * scaleY);
  const sw = Math.max(1, Math.min(frame.width - sx, rect.width * scaleX));
  const sh = Math.max(1, Math.min(frame.height - sy, rect.height * scaleY));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw));
  canvas.height = Math.max(1, Math.round(sh));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not capture the report canvas.");
  context.drawImage(frame.source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  frame.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode the snapshot."))),
      "image/jpeg",
      0.86
    );
  });
}

/**
 * Photographs only the Power BI canvas inside this browser tab.
 * The crop uses the canvas box, so other windows on the desktop are not included.
 */
export async function captureReportPages(
  report: Report,
  canvas: HTMLElement,
  pageNames: string[],
  stream: MediaStream,
  onStatus: (message: string) => void
): Promise<{ title: string; blob: Blob }[]> {
  const iframe = (canvas.querySelector("iframe") as HTMLElement | null) ?? canvas;
  const pages = await listReportPages(report);
  const selected = pages.filter((page) => pageNames.includes(page.name));
  if (!selected.length) throw new Error("Select at least one report page.");

  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  // Chrome stops delivering frames to a detached or tiny video, which repeated the first page.
  Object.assign(video.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "64px",
    height: "36px",
    opacity: "0.02",
    pointerEvents: "none",
    zIndex: "1",
  });
  document.body.appendChild(video);
  const track = stream.getVideoTracks()[0];
  const ImageCaptureCtor = (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => FrameGrabber }).ImageCapture;
  const grabber = track && ImageCaptureCtor ? new ImageCaptureCtor(track) : null;
  try {
    await startVideo(video);
  } catch (error) {
    video.remove();
    throw error;
  }

  const active = await report.getActivePage().catch(() => null);
  const shots: { title: string; blob: Blob }[] = [];
  const seen = new Set<string>();
  const previousTitle = document.title;

  try {
    await settle(
      report.updateSettings({
        navContentPaneEnabled: false,
        panes: {
          filters: { visible: false, expanded: false },
          pageNavigation: { visible: false },
        },
      }),
      6000
    );

    for (let index = 0; index < selected.length; index++) {
      const page = selected[index];
      const message = `Capturing ${page.displayName} (${index + 1} of ${selected.length})`;
      document.title = message;
      onStatus(message);
      if (stream.getVideoTracks()[0]?.readyState === "ended") {
        throw new Error("Tab sharing stopped before the snapshot finished.");
      }
      await activatePage(report, page.name, page.displayName);

      let blob: Blob | null = null;
      let print = "";
      for (let attempt = 0; attempt < 8; attempt++) {
        nudgeIframe(iframe);
        await waitForFreshFrame(video);
        releaseIframe(iframe);
        await waitForFreshFrame(video);
        await sleep(400 + attempt * 350);
        blob = await grabCanvas(grabber, video, iframe);
        print = await fingerprint(blob);
        if (!seen.has(print)) break;
      }
      if (!blob || seen.has(print)) {
        throw new Error(`"${page.displayName}" did not paint a new snapshot. Wait for the report to finish, then export again.`);
      }
      seen.add(print);
      shots.push({ title: page.displayName, blob });
    }
  } finally {
    releaseIframe(iframe);
    document.title = previousTitle;
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    video.remove();
    void settle(
      report
        .updateSettings({
          navContentPaneEnabled: true,
          panes: {
            filters: { visible: false, expanded: false },
            pageNavigation: { visible: true },
          },
        })
        .then(() => (active?.name ? report.setPage(active.name) : undefined)),
      8000
    );
  }

  return shots;
}
