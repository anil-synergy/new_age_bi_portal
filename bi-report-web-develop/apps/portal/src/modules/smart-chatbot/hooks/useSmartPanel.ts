"use client";

import { createContext, useContext } from "react";

export interface SmartPanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const SmartPanelContext = createContext<SmartPanelState | null>(null);

export function useSmartPanel() {
  return useContext(SmartPanelContext);
}
