import { JWT } from 'npm:google-auth-library';
import { MonthlySummary } from "./parser.ts";

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

type SheetsValuesResponse = {
  values?: string[][];
};

type SheetProperties = {
  sheetId: number;
  title: string;
  index: number;
};

type SpreadsheetMetadata = {
  sheets: Array<{
    properties: SheetProperties;
  }>;
};

type BatchUpdateRequest = {
  requests: Array<{
    addSheet: {
      properties: {
        title: string;
      };
    };
  }>;
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

  private getSheetNumber(): number {
    const month = new Date().getMonth(); // 0-11
    return month + 1; // Convert to 1-12
  }

  private async getSpreadsheetMetadata(): Promise<SpreadsheetMetadata> {
    return await this.googleFetch<SpreadsheetMetadata>(
      '?includeGridData=false',
    );
  }

  private async sheetExists(sheetNumber: number): Promise<boolean> {
    const metadata = await this.getSpreadsheetMetadata();
    const sheetTitle = String(sheetNumber);
    return metadata.sheets.some(
      (sheet) => sheet.properties.title === sheetTitle,
    );
  }

  private async createSheet(sheetNumber: number): Promise<void> {
    const request: BatchUpdateRequest = {
      requests: [
        {
          addSheet: {
            properties: {
              title: String(sheetNumber),
            },
          },
        },
      ],
    };

    await this.googleFetch('/batchUpdate', {
      method: 'POST',
      body: JSON.stringify(request),
    });

    // Add column headers in Vietnamese
    const range = `${sheetNumber}!A1:D1`;
    const headers = [['Danh mục', 'Chi tiêu', 'Thu nhập', 'Ghi chú']];
    await this.googleFetch(
      `/values/${range}?valueInputOption=RAW`,
      {
        method: 'PUT',
        body: JSON.stringify({ values: headers }),
      },
    );
  }

  private async ensureSheetExists(sheetNumber: number): Promise<void> {
    const exists = await this.sheetExists(sheetNumber);
    if (!exists) {
      await this.createSheet(sheetNumber);
    }
  }

  private getMonthRange(): string {
    const sheetNumber = this.getSheetNumber();
    return `${sheetNumber}!A:D`;
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
    const sheetNumber = this.getSheetNumber();
    await this.ensureSheetExists(sheetNumber);

    const range = `${sheetNumber}!A2:D`; // Start from row 2 to skip header
    const encodedRange = encodeURIComponent(range);
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

  async addExpense(category: string, amount: number, type: 'expense' | 'income', note?: string) {
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

    const rowsToAppend: (string | number)[][] = [];

    // If no date header or last date header is not today, add a header row
    if (lastDateHeader !== todayStr) {
      if (values.length > 0) {
        // Add an empty row for spacing before the new date header if there's existing data
        rowsToAppend.push(['', '', '', '']);
      }
      rowsToAppend.push([todayStr, '', '', '']);
    }

    // Add the expense/income row
    const row = type === 'expense'
      ? [category, amount, '', note || '']
      : [category, '', amount, note || ''];
    rowsToAppend.push(row);

    const encodedRange = encodeURIComponent(this.getMonthRange());
    await this.googleFetch(
      `/values/${encodedRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ values: rowsToAppend }),
      },
    );
  }

  private parseAmount(str: string): number {
    if (!str) return 0;
    const clean = str.replace(/\s*₫\s*/, '').trim();
    const normalized = clean.includes('.') ? clean.replace(/\./g, '') : clean;
    return parseFloat(normalized.replace(/,/g, '')) || 0;
  }

  async getMonthlySummary(): Promise<MonthlySummary> {
    const sheetNumber = this.getSheetNumber();

    // Check if sheet exists, return empty summary if not
    const exists = await this.sheetExists(sheetNumber);
    if (!exists) {
      return {
        totalExpenses: 0,
        totalIncome: 0,
        balance: 0,
        expensesByCategory: [],
        entryCount: 0,
      };
    }

    const monthRange = `${sheetNumber}!A2:D`; // Start from row 2 to skip header
    const encodedRange = encodeURIComponent(monthRange);
    const data = await this.googleFetch<SheetsValuesResponse>(
      `/values/${encodedRange}`,
    );
    const values = data.values ?? [];

    const expensesByCategory = new Map<string, number>();
    let totalExpenses = 0;
    let totalIncome = 0;
    let entryCount = 0;

    for (const row of values) {
      if (!row || row.length < 2) continue;

      // Skip date header rows (DD/MM/YYYY pattern)
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(row[0] || '')) continue;

      // Skip empty rows
      if (!row[0] && !row[1] && !row[2]) continue;

      const category = row[0]?.trim() || 'Uncategorized';
      const expenseAmount = this.parseAmount(row[1]);
      const incomeAmount = this.parseAmount(row[2]);

      if (expenseAmount > 0) {
        totalExpenses += expenseAmount;
        const current = expensesByCategory.get(category) || 0;
        expensesByCategory.set(category, current + expenseAmount);
      }

      if (incomeAmount > 0) {
        totalIncome += incomeAmount;
      }

      entryCount++;
    }

    const sortedExpensesByCategory = Array.from(expensesByCategory.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      totalExpenses,
      totalIncome,
      balance: totalIncome - totalExpenses,
      expensesByCategory: sortedExpensesByCategory,
      entryCount,
    };
  }
}
