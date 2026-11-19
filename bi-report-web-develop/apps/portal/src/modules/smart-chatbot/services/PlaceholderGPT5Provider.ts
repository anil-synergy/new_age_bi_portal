import type { AIProvider, SemanticModelContext } from "./types";
import type { ChatMessage } from "@/types";

/**
 * Placeholder GPT-5 provider — wire Azure OpenAI when secrets are configured.
 * Set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT in .env.local
 */
export class PlaceholderGPT5Provider implements AIProvider {
  async chat(messages: ChatMessage[], context: SemanticModelContext): Promise<ChatMessage> {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT ?? "gpt-5";

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = lastUser?.content ?? "";

    if (endpoint && apiKey) {
      try {
        const response = await fetch(`${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-02-15-preview`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content: `You are a BI assistant. Semantic model: ${JSON.stringify(context.model?.tables?.slice(0, 5) ?? [])}. Answer questions about data and suggest DAX queries.`,
              },
              ...messages.map((m) => ({ role: m.role, content: m.content })),
            ],
            max_tokens: 1000,
          }),
        });
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content ?? "No response from model.";
        return { id: crypto.randomUUID(), role: "assistant", content, type: "text" };
      } catch (e) {
        console.error("Azure OpenAI error:", e);
      }
    }

    const tableCount = context.model?.tables?.length ?? 0;
    const isKpi = /kpi|summary|total|count/i.test(question);
    const isChart = /chart|graph|trend|plot/i.test(question);

    if (isKpi) {
      return {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `KPI summary for your question: "${question}"`,
        type: "kpi",
        kpiData: {
          label: "Sample KPI",
          value: "1,234",
          delta: "+12.5%",
        },
      };
    }

    if (isChart) {
      return {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Chart generated from semantic model (${tableCount} tables available). Configure Azure OpenAI for live DAX-driven charts.`,
        type: "chart",
        chartData: {
          type: "bar",
          labels: ["Q1", "Q2", "Q3", "Q4"],
          datasets: [{ label: "Revenue", data: [120, 190, 150, 220] }],
        },
      };
    }

    return {
      id: crypto.randomUUID(),
      role: "assistant",
      content: `[GPT-5 Placeholder] I can help analyze your report data. Semantic model has ${tableCount} table(s). Ask me for KPIs, charts, or summaries. Add AZURE_OPENAI_* secrets to enable live AI responses.\n\nYour question: "${question}"`,
      type: "text",
    };
  }
}
