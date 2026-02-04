import { App } from '@slack/bolt';
import { parseExpense } from './parser.ts';
import { GoogleSheetsService } from './google-sheets.service.ts';

const appToken = Deno.env.get('SLACK_APP_TOKEN');
const signingSecret = Deno.env.get('SLACK_SIGNING_SECRET');
const botToken = Deno.env.get('SLACK_BOT_TOKEN');

if (!appToken || !signingSecret || !botToken) {
  console.error('Missing Slack configuration in environment variables.');
  Deno.exit(1);
}

const app = new App({
  token: botToken,
  signingSecret: signingSecret,
  socketMode: true,
  appToken: appToken,
});

// Global error handlers for Deno/Node compat stability
globalThis.addEventListener('unhandledrejection', (event) => {
  console.error('[UNHANDLED REJECTION]', event.reason);
  event.preventDefault();
});

globalThis.addEventListener('error', (event) => {
  console.error('[GLOBAL ERROR]', event.error);
  event.preventDefault();
});

const sheetsService = new GoogleSheetsService();

// Listen for messages that are not from the bot itself
app.message(async ({ message, say }: any) => {
  // Check if it's a message with text
  if (!('text' in message) || !message.text) return;

  const text = message.text;
  console.log(`[DEBUG] Received message: "${text}"`);
  
  try {
    const parsed = parseExpense(text);

    if (!parsed) {
      console.log(`[DEBUG] Message did not match expense pattern.`);
      return;
    }

    const summary = `*${parsed.category}* - *${parsed.amount.toLocaleString('vi-VN')} ₫*${parsed.note ? ` (${parsed.note})` : ''}`;
    await say(`⏳ Đang nhập chi tiêu: ${summary}...`);
    await sheetsService.addExpense(parsed.category, parsed.amount, parsed.note);
    await say(`✅ Đã nhập thành công vào Google Sheet!`);
  } catch (error: any) {
    console.error('[ERROR] app.message handler:', error);
    try {
      await say(`❌ Đã xảy ra lỗi: ${error.message}`);
    } catch (sayError) {
      console.error('[ERROR] Failed to send error message:', sayError);
    }
  }
});

(async () => {
  try {
    await app.start();
    console.log('⚡️ Slack Bolt app is running with Socket Mode!');
  } catch (error) {
    console.error('[FATAL] Failed to start app:', error);
    Deno.exit(1);
  }
})();
