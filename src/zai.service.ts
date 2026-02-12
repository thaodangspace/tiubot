import type { ParsedExpense, MonthlySummary } from "./parser.ts";

export type { ChatMessage };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ZaiChoice = {
  message?: {
    role?: string;
    content?: string;
  };
};

type ZaiResponse = {
  choices?: ZaiChoice[];
};

const DEFAULT_MODEL = "glm-4.5-air";

export class ZaiService {
  private apiKey?: string;
  private model: string;
  private baseUrl = "https://api.z.ai/api/paas/v4";

  constructor() {
    this.apiKey = Deno.env.get("ZAI_API_KEY") ?? undefined;
    this.model = Deno.env.get("ZAI_MODEL") ?? DEFAULT_MODEL;
  }

  isEnabled(): boolean {
    return Boolean(this.apiKey);
  }

  async chat(
    messages: ChatMessage[],
    temperature = 0.2,
  ): Promise<string | null> {
    if (!this.apiKey) return null;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[Zai] API error", response.status, body);
      return null;
    }

    const data = await response.json() as ZaiResponse;
    const content = data.choices?.[0]?.message?.content;
    return content?.trim() || null;
  }
}
