"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearAuthStorage } from "@/lib/auth/authService";

export default function LogoutCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    clearAuthStorage();
    router.replace("/login");
  }, [router]);

  return null;
}
