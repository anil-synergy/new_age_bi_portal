import type { UserInfo } from "@/types";

/** System Admin and department admins can open the configuration pages. */
export function canConfigurePortal(
  userInfo: UserInfo | null,
  flags?: { isSuperAdmin?: boolean; isDepAdmin?: boolean }
): boolean {
  if (flags?.isSuperAdmin || flags?.isDepAdmin) return true;
  if (userInfo?.isSuperAdmin || userInfo?.isDepartmentAdmin) return true;
  return (userInfo?.group ?? []).some((group) => /admin/i.test(group.name ?? ""));
}
