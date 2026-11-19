import type { AgentStep, ChatMessage, SemanticModel } from "@/types";

export interface SemanticModelContext {
  model?: SemanticModel;
  reportId?: string;
  filterState?: Record<string, unknown>;
  conversationId?: string;
}

export interface ChatOptions {
  onStep?: (step: AgentStep) => void;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
  outputMode?: "stream" | "batch";
  memory?: { role: "user" | "assistant"; content: string }[];
}

export interface AIProvider {
  chat(messages: ChatMessage[], context: SemanticModelContext, options?: ChatOptions): Promise<ChatMessage>;
}
