import type { Report } from "powerbi-client";

export interface SnapshotTarget {
  report: Report;
  canvas: HTMLElement;
}

let current: SnapshotTarget | null = null;

export function registerSnapshotTarget(target: SnapshotTarget) {
  current = target;
  return () => {
    if (current === target) current = null;
  };
}

export function getSnapshotTarget() {
  return current;
}
