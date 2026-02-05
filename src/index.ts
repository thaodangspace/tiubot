import { parseExpense } from './parser.ts';
import { GoogleSheetsService } from './google-sheets.service.ts';

// Environment validation
const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
const botToken = Deno.env.get('SLACK_BOT_TOKEN');

if (!signingSecret || !botToken) {
  console.error('Missing Slack configuration in environment variables.');
  Deno.exit(1);
}

// Global error handlers for stability
globalThis.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED REJECTION]', event.reason);
  event.preventDefault();
});

globalThis.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]', event.error);
  event.preventDefault();
});

const sheetsService = new GoogleSheetsService();

// ---------------------------------------------------------------------------
// Slack request verification (HMAC SHA-256)
// ---------------------------------------------------------------------------

async function verifySlackRequest(
  body: string,
  signature: string | null,
  timestamp: string | null,
): Promise<boolean> {
  if (!signature || !timestamp) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const baseString = `v0:${timestamp}:${body}`;
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(baseString),
  );
  const expectedSignature = `v0=${
    Array.from(new Uint8Array(signatureBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  }`;

  return signature === expectedSignature;
}

// ---------------------------------------------------------------------------
// Slack API helpers
// ---------------------------------------------------------------------------

async function sendSlackMessage(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    channel,
    text,
  };
  if (threadTs) payload.thread_ts = threadTs;

  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    throw new Error(`Slack API error: ${resp.status}`);
  }
  
  const data = await resp.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error}`);
  }
}

// ---------------------------------------------------------------------------
// Event handler for messages
// ---------------------------------------------------------------------------

async function handleSlackEvent(event: any): Promise<void> {
  const { type, text, channel, ts, thread_ts, bot_id } = event;
  
  // Ignore bot messages and non-message events
  if (type !== "message" || bot_id) return;
  if (!text) return;

  console.log(`[DEBUG] Received message: "${text}"`);

  try {
    const parsed = parseExpense(text);

    if (!parsed) {
      console.log(`[DEBUG] Message did not match expense pattern.`);
      return;
    }

    const summary = `*${parsed.category}* - *${parsed.amount.toLocaleString('vi-VN')} ₫*${parsed.note ? ` (${parsed.note})` : ''}`;
    
    // Send processing message
    await sendSlackMessage(channel, `⏳ Đang nhập chi tiêu: ${summary}...`, thread_ts || ts);
    
    // Add to Google Sheets
    await sheetsService.addExpense(parsed.category, parsed.amount, parsed.note);
    
    // Send success message
    await sendSlackMessage(channel, `✅ Đã nhập thành công vào Google Sheet!`, thread_ts || ts);
  } catch (error: any) {
    console.error('[ERROR] handleSlackEvent:', error);
    try {
      await sendSlackMessage(channel, `❌ Đã xảy ra lỗi: ${error.message}`, thread_ts || ts);
    } catch (sayError) {
      console.error('[ERROR] Failed to send error message:', sayError);
    }
  }
}

// ---------------------------------------------------------------------------
// HTTP request handler (for Deno Deploy / Edge runtime)
// ---------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  // Health-check shortcut
  if (req.method === "GET") {
    return new Response("Slack bot is running 🚀", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Read raw body as text (needed both for signature and parsing)
  const body = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (!(await verifySlackRequest(body, signature, timestamp))) {
    console.error('[ERROR] Slack request verification failed');
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const payload = JSON.parse(body);

    // URL verification challenge
    if (payload.type === "url_verification") {
      return new Response(payload.challenge, {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Event callback - fire-and-forget so we can immediately return 200 OK
    if (payload.type === "event_callback" && payload.event) {
      handleSlackEvent(payload.event).catch(console.error);
    }

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response("Internal Server Error", { status: 500 });
  }
}

// Start HTTP server
const port = Number(Deno.env.get("PORT") || "8000");
console.log(`⚡️ Slack bot is running on port ${port}!`);
Deno.serve({ port }, handler);
