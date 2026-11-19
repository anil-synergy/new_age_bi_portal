import type { PortalReport } from "@/types";

export const ENV_TAGS = ["PROD", "UAT"] as const;

export function reportEnv(report: PortalReport): (typeof ENV_TAGS)[number] {
  const name = `${report.title ?? ""} ${report.name ?? ""}`;
  return /\b(uat|test|dev|sandbox|staging)\b/i.test(name) ? "UAT" : "PROD";
}

export function reportTags(report: PortalReport): string[] {
  const tags: string[] = [reportEnv(report)];
  if (report.categoryName) tags.push(report.categoryName);
  return tags;
}
