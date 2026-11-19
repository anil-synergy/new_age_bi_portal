export const isAuthEnabled = () => process.env.NEXT_PUBLIC_AUTH_ENABLED === "true";

export const hasStoredAccessToken = () => {
  if (typeof window === "undefined") return false;
  return Boolean(localStorage.getItem("access_token"));
};

/** bi-report-api uses the DATA360-style app JWT issued by POST /api/sso/token */
export const shouldAttachApiToken = () =>
  typeof window !== "undefined" && (isAuthEnabled() || hasStoredAccessToken());
