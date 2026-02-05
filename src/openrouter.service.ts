import type { ParsedExpense } from "./parser.ts";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenRouterChoice = {
  message?: {
    role?: string;
    content?: string;
  };
};

type OpenRouterResponse = {
  choices?: OpenRouterChoice[];
};

const DEFAULT_MODEL = "z-ai/glm-4.5-air:free";
const DEFAULT_REFERER = "https://github.com/thaodangspace/tiubot";

export class OpenRouterService {
  private apiKey?: string;
  private model: string;
  private baseUrl: string;
  private referer: string;
  private clientTitle: string;

  constructor() {
    this.apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? undefined;
    this.model = Deno.env.get("OPENROUTER_MODEL") ?? DEFAULT_MODEL;
    this.baseUrl = Deno.env.get("OPENROUTER_BASE_URL") ??
      "https://openrouter.ai/api/v1";
    this.referer = Deno.env.get("OPENROUTER_REFERER") ?? DEFAULT_REFERER;
    this.clientTitle = Deno.env.get("OPENROUTER_APP_NAME") ?? "tiubot";
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
        "HTTP-Referer": this.referer,
        "X-Title": this.clientTitle,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error("[OpenRouter] API error", response.status, body);
      return null;
    }

    const data = await response.json() as OpenRouterResponse;
    const content = data.choices?.[0]?.message?.content;
    return content?.trim() || null;
  }
}

export class AiExpenseHelper {
  private client = new OpenRouterService();

  isEnabled(): boolean {
    return this.client.isEnabled();
  }

  async parseExpenseWithAi(message: string): Promise<ParsedExpense | null> {
    if (!this.isEnabled()) return null;

    const completion = await this.client.chat([
      {
        role: "system",
        content:
          "You convert Vietnamese Slack messages about expenses into JSON. " +
          'Return ONLY minified JSON like {"category":"Ăn tối","amount":150000,"note":"pizza"}. ' +
          'Amount must be in Vietnamese đồng (integer). If unsure, reply with {"error":"unknown"}.',
      },
      {
        role: "user",
        content: `Message:\n"""\n${message}\n"""\nExtract the expense.`,
      },
    ]);

    if (!completion) return null;

    const jsonMatch = completion.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      if (parsed.error) return null;
      if (typeof parsed.amount !== "number" || !parsed.category) {
        return null;
      }

      return {
        category: String(parsed.category),
        amount: parsed.amount,
        note: parsed.note ? String(parsed.note) : undefined,
      };
    } catch (err) {
      console.error("[OpenRouter] Failed to parse AI JSON", err);
      return null;
    }
  }

  async generatePlayfulSuccess(
    summary: string,
    usedAi: boolean,
  ): Promise<string | null> {
    if (!this.isEnabled()) return null;

    return await this.client.chat([
      {
        role: "system",
        content:
          "You are a witty Vietnamese finance bot responding inside Slack threads. " +
          "Keep replies under 30 words and include friendly emoji. Mention if AI helped interpret the message when told.",
      },
      {
        role: "user",
        content: `Thông tin chi tiêu: ${summary}. ` +
          `AI đã dùng để hiểu tin nhắn: ${usedAi ? "có" : "không"}. ` +
          "Hãy gửi lời xác nhận rằng khoản này đã được lưu vào Google Sheets.",
      },
    ], 0.6);
  }

  async generateConfusedReply(): Promise<string | null> {
    if (!this.isEnabled()) return null;

    return await this.client.chat([
      {
        role: "system",
        content:
          "Bạn là bot ghi chép chi tiêu vui vẻ trong Slack. Xin lỗi nhẹ nhàng và yêu cầu người dùng nhập lại định dạng rõ ràng. " +
          "Giữ câu trả lời dưới 25 từ, thêm emoji duy nhất.",
      },
      {
        role: "user",
        content:
          'Tin nhắn không thể phân tích được. Hãy nhắc người dùng nhập theo dạng "[hạng mục] [số tiền] [ghi chú]" bằng tiếng Việt.',
      },
    ], 0.5);
  }
}
