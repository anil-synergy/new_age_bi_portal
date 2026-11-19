import { Suspense } from "react";
import { AuthCallbackContent } from "./AuthCallbackContent";

export const dynamic = "force-dynamic";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen items-center justify-center text-slate-500">
          Completing sign in…
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
