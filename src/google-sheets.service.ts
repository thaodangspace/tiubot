import { JWT } from 'npm:google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_RANGE = "'1'!A:C";

type SheetsValuesResponse = {
  values?: string[][];
};

type CachedToken = {
  value: string;
  expiry: number;
};

export class GoogleSheetsService {
  private jwtClient: JWT;
  private spreadsheetId: string;
  private tokenCache?: CachedToken;

  constructor() {
    const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');
    this.spreadsheetId = Deno.env.get('GOOGLE_SHEET_ID') || '';

    if (!email || !privateKey || !this.spreadsheetId) {
      throw new Error('Missing Google Sheets configuration in environment variables.');
    }

    this.jwtClient = new JWT({
      email,
      key: privateKey,
      scopes: SCOPES,
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiry - 30_000) {
      return this.tokenCache.value;
    }

    const tokens = await this.jwtClient.authorize();
    const accessToken = tokens?.access_token;

    if (!accessToken) {
      throw new Error('Failed to obtain Google access token.');
    }

    const expiry = tokens.expiry_date ?? Date.now() + 50 * 60 * 1000;
    this.tokenCache = { value: accessToken, expiry };
    return accessToken;
  }

  private async googleFetch<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.getAccessToken();
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);

    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(
      `${SHEETS_API_BASE}/${this.spreadsheetId}${path}`,
      {
        ...init,
        headers,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Google Sheets API error (${response.status}): ${errorText}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const bodyText = await response.text();
    return bodyText ? JSON.parse(bodyText) as T : ({} as T);
  }

  private async getCurrentValues(): Promise<string[][]> {
    const encodedRange = encodeURIComponent(SHEET_RANGE);
    const data = await this.googleFetch<SheetsValuesResponse>(
      `/values/${encodedRange}`,
    );
    return data.values ?? [];
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
    const todayStr = this.getTodayString();
    const values = await this.getCurrentValues();
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

    const encodedRange = encodeURIComponent(SHEET_RANGE);
    await this.googleFetch(
      `/values/${encodedRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ values: rowsToAppend }),
      },
    );
  }
}
