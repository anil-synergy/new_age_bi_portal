import { Suspense } from "react";
import { LegacyAuthCallbackRedirect } from "./LegacyAuthCallbackRedirect";

export default function LegacyAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <LegacyAuthCallbackRedirect />
    </Suspense>
  );
}
