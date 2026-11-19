"use client";

import { useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { X } from "lucide-react";
import { LoaderIcon } from "@/modules/shared/components/animated-icons/LoaderIcon";
import { SendHorizontalIcon } from "@/modules/shared/components/animated-icons/SendHorizontalIcon";
import { motion } from "framer-motion";
import { Button } from "@/modules/shared/components/ui/button";
import smartLogo from "@/assets/SMART_logo.png";
import { Input } from "@/modules/shared/components/ui/input";
import { SmartAnswer } from "./SmartAnswer";
import { SteerWheelIndicator } from "./SteerWheelIndicator";
import { useSmartConversation } from "../hooks/useSmartConversation";
import { cn } from "@/lib/utils";

interface AIChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoCloseSeconds?: number;
}

export function AIChatPanel({ open, onOpenChange, autoCloseSeconds = 0 }: AIChatPanelProps) {
  const { messages, input, setInput, loading, drafting, lastUsedFallback, sendMessage } = useSmartConversation();
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const resetIdleTimer = useCallback(() => {
    if (!autoCloseSeconds || !open) return;
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => onOpenChange(false), autoCloseSeconds * 1000);
  }, [autoCloseSeconds, open, onOpenChange]);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [messages, open, resetIdleTimer]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, drafting]);

  return (
    <section id="smart-panel" aria-label="SMART assistant" className="smart-panel flex h-full w-[380px] flex-col">
      <header className="smart-panel-header flex items-start justify-between gap-2 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          {open && (
            <motion.span layoutId="smart-launcher" className="block h-7 w-7" transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}>
              <Image src={smartLogo} alt="" width={28} height={28} className="h-7 w-7 object-contain" />
            </motion.span>
          )}
          <div>
            <h2 className="text-sm font-semibold text-[var(--smart-text)]">SMART</h2>
            <p className="text-[11px] text-[var(--smart-muted)]">Synergy Maritime AI Reporting</p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-[var(--smart-muted)] hover:bg-[var(--smart-bubble-assistant)] hover:text-[var(--smart-text)]"
          aria-label="Close SMART panel"
          tabIndex={open ? 0 : -1}
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="smart-bubble-user ml-8 rounded-lg p-3 text-sm">
              {msg.content}
            </div>
          ) : (
            <div key={msg.id} className="mr-8 flex flex-col gap-1">
              <div className="smart-bubble-assistant rounded-lg p-3 text-sm">
                <SmartAnswer msg={msg} part="body" onPick={(c) => void sendMessage(c)} />
              </div>
              <SmartAnswer msg={msg} part="after" onPick={(c) => void sendMessage(c)} />
            </div>
          ),
        )}
        {lastUsedFallback && !loading && (
          <p className="mr-8 text-[11px] text-amber-700 dark:text-amber-200">
            Demo KPI/chart only — SMART orchestrator was unavailable. Restart the Python services and try again.
          </p>
        )}
        {loading && !drafting && (
          <div className="smart-bubble-assistant mr-8 rounded-lg p-3">
            <SteerWheelIndicator animated label="Thinking…" />
          </div>
        )}
        {loading && drafting && (
          <div className="mr-8 flex justify-end px-1">
            <SteerWheelIndicator animated size={22} label="Writing answer…" labelClassName="text-[11px] text-[var(--smart-muted)]" />
          </div>
        )}
      </div>
      <div className="smart-panel-header flex gap-2 border-t p-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void sendMessage()}
          placeholder="Ask about KPIs, charts, or data…"
          disabled={loading}
          className="border-[var(--smart-border)] bg-[var(--smart-bubble-assistant)] text-[var(--smart-text)] focus-visible:border-[var(--smart-chrome-indigo)] focus-visible:ring-[var(--smart-chrome-indigo)] focus-visible:ring-offset-0"
        />
        <Button
          variant="ghost"
          size="icon"
          className="smart-accent-btn shrink-0 border-0 shadow-none focus-visible:ring-[var(--smart-chrome-indigo)] focus-visible:ring-offset-0"
          onClick={() => void sendMessage()}
          disabled={loading}
          aria-busy={loading}
        >
          {loading ? (
            <LoaderIcon active size={18} className="smart-send-icon" />
          ) : (
            <SendHorizontalIcon size={16} className="smart-send-icon" />
          )}
        </Button>
      </div>
    </section>
  );
}
