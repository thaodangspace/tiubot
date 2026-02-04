import { google } from 'googleapis';
import type { JWT } from 'npm:google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

export class GoogleSheetsService {
  private jwtClient: any; // Using any for simplicity in Deno compat or import correctly if needed
  private spreadsheetId: string;

  constructor() {
    const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    this.spreadsheetId = Deno.env.get('GOOGLE_SHEET_ID') || '';

    if (!email || !privateKey || !this.spreadsheetId) {
      throw new Error('Missing Google Sheets configuration in environment variables.');
    }

    // @ts-ignore: Google Auth Library via npm specifier
    const { JWT } = google.auth;
    this.jwtClient = new JWT({
      email,
      key: privateKey,
      scopes: SCOPES,
    });
  }

  private async getSheetsClient() {
    await this.jwtClient.authorize();
    return google.sheets({ version: 'v4', auth: this.jwtClient });
  }

  private getTodayString(): string {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private formatCurrency(amount: number): string {
    return amount.toLocaleString('vi-VN').replace(/,/g, '.') + ' ₫';
  }

  async addExpense(category: string, amount: number, note?: string) {
    const sheets = await this.getSheetsClient();
    const todayStr = this.getTodayString();
    
    // Get current values to find the last date header
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: this.spreadsheetId,
      range: "'1'!A:C", // Based on screenshot, tab name is '1' and we need Col C for notes
    });

    const values = response.data.values || [];
    let lastDateHeader = '';

    // Search backwards for the last date header (DD/MM/YYYY pattern)
    for (let i = values.length - 1; i >= 0; i--) {
      const row = values[i];
      if (!row) continue;
      const cellA = row[0];
      if (cellA && /^\d{2}\/\d{2}\/\d{4}$/.test(cellA)) {
        lastDateHeader = cellA;
        break;
      }
    }

    const rowsToAppend: string[][] = [];

    // If no date header or last date header is not today, add a header row
    if (lastDateHeader !== todayStr) {
      if (values.length > 0) {
        // Add an empty row for spacing before the new date header if there's existing data
        rowsToAppend.push(['', '', '']);
      }
      rowsToAppend.push([todayStr, '', '']);
    }

    // Add the expense row
    rowsToAppend.push([category, this.formatCurrency(amount), note || '']);

    await sheets.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: "'1'!A:C",
      valueInputOption: 'RAW',
      requestBody: {
        values: rowsToAppend,
      },
    });
  }
}
