"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { LayoutGroup, motion } from "framer-motion";
import { Sidebar } from "@/modules/menu-panel/components/Sidebar";
import { NavChromeProvider } from "@/modules/menu-panel/logic/nav-chrome";

const AIChatPanel = dynamic(
  () => import("@/modules/smart-chatbot/components/AIChatPanel").then((m) => m.AIChatPanel),
  { ssr: false },
);
import { SmartConversationProvider } from "@/modules/smart-chatbot/hooks/useSmartConversation";
import { SmartPanelContext, type SmartPanelState } from "@/modules/smart-chatbot/hooks/useSmartPanel";
import { VisualBoxProvider } from "@/modules/visual-box/visual-box";
import { BITransition } from "@/modules/loaders/components/BITransition";
import { usePortal } from "@/context/PortalContext";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { semanticModel, loadSemanticModel, isLoading, reports } = usePortal();
  const [smartOpen, setSmartOpen] = useState(false);
  const contextId = pathname.match(/^\/(?:dashboard|display)\/([^/]+)/)?.[1];

  const transitionKey = useMemo(() => {
    if (pathname.startsWith("/dashboard/")) return "/dashboard";
    if (pathname.startsWith("/display/")) return "/display";
    return pathname;
  }, [pathname]);

  useEffect(() => {
    if (contextId && smartOpen) loadSemanticModel(contextId);
  }, [contextId, smartOpen, loadSemanticModel]);

  const smartPanel = useMemo<SmartPanelState>(
    () => ({ open: smartOpen, setOpen: setSmartOpen, toggle: () => setSmartOpen((o) => !o) }),
    [smartOpen],
  );

  return (
    <SmartPanelContext.Provider value={smartPanel}>
      <SmartConversationProvider panelOpen={smartOpen} setPanelOpen={setSmartOpen} semanticModel={semanticModel ?? undefined} reportId={contextId}>
        <VisualBoxProvider>
          <NavChromeProvider>
            <LayoutGroup>
              <div className="flex h-screen max-h-screen overflow-hidden bg-background">
                <Sidebar />
                <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <BITransition transitionKey={transitionKey} loading={isLoading && reports.length === 0}>
                    {children}
                  </BITransition>
                </main>
                <motion.aside
                  initial={false}
                  animate={{ width: smartOpen ? 380 : 0 }}
                  transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "smart-panel h-full shrink-0 overflow-hidden border-l",
                    smartOpen ? "border-[var(--smart-border)]" : "border-transparent",
                  )}
                  aria-hidden={!smartOpen}
                >
                  {smartOpen ? (
                    <AIChatPanel open={smartOpen} onOpenChange={setSmartOpen} autoCloseSeconds={0} />
                  ) : null}
                </motion.aside>
              </div>
            </LayoutGroup>
          </NavChromeProvider>
        </VisualBoxProvider>
      </SmartConversationProvider>
    </SmartPanelContext.Provider>
  );
}
