"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ChatMessage, SemanticModel } from "@/types";
import { PlaceholderGPT5Provider } from "../services/PlaceholderGPT5Provider";
import { OrchestratorUnavailableError, SmartOrchestratorProvider } from "../services/SmartOrchestratorProvider";

export const CONV_STORAGE = "smart-conversation-id";
export const PENDING_STORAGE = "smart-pending-question";
export const MEMORY_STORAGE = "smart-chat-memory";

const orchestrator = new SmartOrchestratorProvider();
const fallbackProvider = new PlaceholderGPT5Provider();

export const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content: "Hi! I can generate KPIs, charts, and summaries from your report's semantic model. What would you like to know?",
  type: "text",
};

function loadStoredMessages(): ChatMessage[] {
  if (typeof window === "undefined") return [WELCOME];
  try {
    const raw = sessionStorage.getItem(MEMORY_STORAGE);
    const saved = raw ? (JSON.parse(raw) as ChatMessage[]) : [];
    if (!Array.isArray(saved) || !saved.length) return [WELCOME];
    const prior = saved.filter(
      (m) => m && m.id && m.id !== "welcome" && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
    return prior.length ? [WELCOME, ...prior] : [WELCOME];
  } catch {
    return [WELCOME];
  }
}

function getStoredConversationId(): string {
  if (typeof window === "undefined") return "default";
  let id = sessionStorage.getItem(CONV_STORAGE);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CONV_STORAGE, id);
  }
  return id;
}

export interface SmartConversationState {
  messages: ChatMessage[];
  input: string;
  setInput: (value: string) => void;
  loading: boolean;
  drafting: boolean;
  lastUsedFallback: boolean;
  sendMessage: (text?: string, options?: { resume?: boolean }) => Promise<void>;
  openWithPrompt: (text?: string) => void;
}

const SmartConversationContext = createContext<SmartConversationState | null>(null);

export function useSmartConversation() {
  const ctx = useContext(SmartConversationContext);
  if (!ctx) throw new Error("useSmartConversation must be used within SmartConversationProvider");
  return ctx;
}

export function useSmartConversationOptional() {
  return useContext(SmartConversationContext);
}

interface ProviderProps {
  children: ReactNode;
  semanticModel?: SemanticModel;
  reportId?: string;
  filterState?: Record<string, unknown>;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

export function SmartConversationProvider({
  children,
  semanticModel,
  reportId,
  filterState,
  panelOpen,
  setPanelOpen,
}: ProviderProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(loadStoredMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [lastUsedFallback, setLastUsedFallback] = useState(false);
  const conversationIdRef = useRef(getStoredConversationId());
  const conversationId = conversationIdRef.current;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendMessageRef = useRef<(text: string, options?: { resume?: boolean }) => Promise<void>>(async () => undefined);

  useEffect(() => {
    const stored = messages.filter((m) => m.id !== "welcome").slice(-30);
    sessionStorage.setItem(MEMORY_STORAGE, JSON.stringify(stored));
  }, [messages]);

  const sendMessage = useCallback(
    async (text = input, options?: { resume?: boolean }) => {
      const trimmed = (typeof text === "string" ? text : input).trim();
      if (!trimmed || loading) return;
      if (!options?.resume) {
        const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: trimmed, type: "text" };
        setMessages((prev) => [...prev, userMsg]);
        setInput("");
      }
      setLoading(true);
      setDrafting(false);
      setLastUsedFallback(false);
      const history = options?.resume
        ? messagesRef.current
        : [...messagesRef.current, { id: crypto.randomUUID(), role: "user" as const, content: trimmed, type: "text" as const }];
      const memory = history
        .filter((m) => m.id !== "welcome" && (m.role === "user" || m.role === "assistant"))
        .slice(0, -1)
        .slice(-12)
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, 800) }));
      const context = { model: semanticModel, reportId, filterState, conversationId };
      const draftId = crypto.randomUUID();
      try {
        let reply: ChatMessage;
        try {
          reply = await orchestrator.chat(history, context, {
            memory,
            onDelta: (delta) => {
              setDrafting(true);
              setMessages((prev) => {
                const existing = prev.find((m) => m.id === draftId);
                if (!existing) return [...prev, { id: draftId, role: "assistant", content: delta, type: "text" }];
                return prev.map((m) => (m.id === draftId ? { ...m, content: m.content + delta } : m));
              });
            },
          });
        } catch (error) {
          if (!(error instanceof OrchestratorUnavailableError)) throw error;
          setLastUsedFallback(true);
          reply = await fallbackProvider.chat(history, context);
        }
        if (reply.needsReportContext || (reply.kind === "info" && reply.content.toLowerCase().includes("open a report"))) {
          sessionStorage.setItem(PENDING_STORAGE, trimmed);
        } else {
          sessionStorage.removeItem(PENDING_STORAGE);
        }
        setMessages((prev) => [...prev.filter((m) => m.id !== draftId), reply]);
        if (reply.openReportId) router.push(`/dashboard/${reply.openReportId}`);
      } catch (error) {
        // Keep the real cause in the browser console; the user sees the plain message below.
        console.error("SMART chat failed:", error);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content:
              "I couldn't finish reading that answer from the connection. Please send the question again. If it keeps failing, name the report and measure you want (for example: \"count of IMO in Fleet Count Vessel Portal for Oct 2026\").",
            kind: "error",
          },
        ]);
      } finally {
        setLoading(false);
        setDrafting(false);
      }
    },
    [conversationId, filterState, input, loading, reportId, router, semanticModel],
  );

  sendMessageRef.current = sendMessage;

  useEffect(() => {
    if (!reportId || loading) return;
    const pending = sessionStorage.getItem(PENDING_STORAGE);
    if (!pending) return;
    sessionStorage.removeItem(PENDING_STORAGE);
    void sendMessageRef.current(pending, { resume: true });
  }, [reportId, loading]);

  const openWithPrompt = useCallback(
    (text?: string) => {
      setPanelOpen(true);
      const trimmed = text?.trim();
      if (trimmed) void sendMessage(trimmed);
    },
    [sendMessage, setPanelOpen],
  );

  const value: SmartConversationState = {
    messages,
    input,
    setInput,
    loading,
    drafting,
    lastUsedFallback,
    sendMessage,
    openWithPrompt,
  };

  return <SmartConversationContext.Provider value={value}>{children}</SmartConversationContext.Provider>;
}
