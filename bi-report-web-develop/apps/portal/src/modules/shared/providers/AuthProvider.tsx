"use client";

import { createContext, useContext, useMemo } from "react";
import AuthService from "@/lib/auth/authService";

const AuthContext = createContext<AuthService | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const value = useMemo(() => new AuthService(), []);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
