export interface ParsedExpense {
  category: string;
  amount: number;
  note?: string;
  type: 'expense' | 'income';
}

/**
 * Parses a string like "ăn tối 157k" or "mua sắm 200000" into a category and amount.
 * 
 * Suffixes supported:
 * - k, K: 1,000
 * - tr, TR, m, M: 1,000,000
 */
export function parseExpense(input: string): ParsedExpense | null {
  const trimmed = input.trim();

  // Detect income: starts with "thu" or "nhận"
  const isIncome = /^(thu|nhận)\s/i.test(trimmed);

  // If income, remove prefix before parsing
  const textToParse = isIncome
    ? trimmed.replace(/^(thu|nhận)\s+/i, '')
    : trimmed;

  // Regex to match: [category] [number][optional suffix] [optional note]
  // Suffixes: k (thousand), tr/m (million)
  const regex = /^(.+?)\s+([\d,.]+)\s*(k|tr|m|đ|d)?(?:\s+(.*))?$/i;
  const match = textToParse.match(regex);

  if (!match || !match[1] || !match[2]) return null;

  const category = match[1].trim();
  let amountStr = match[2];
  const suffix = match[3]?.toLowerCase();
  const note = match[4]?.trim();

  // Handle thousand separators vs decimals
  // If there's a suffix like 'k' or 'tr' and a single dot/comma, it's likely a decimal (e.g., 1.2tr)
  // If there are multiple dots or dot followed by 3 digits, it's likely a thousand separator (e.g., 2.839.000)
  if (suffix && (amountStr.includes('.') || amountStr.includes(','))) {
    // Basic heuristic: if it looks like a standard thousand-separated number, strip separators.
    // Otherwise, treat as a decimal.
    if (/^\d{1,3}([.,]\d{3})+$/.test(amountStr)) {
      amountStr = amountStr.replace(/[,.]/g, '');
    } else {
      amountStr = amountStr.replace(/,/g, '.');
    }
  } else {
    // No suffix or simple number, just strip all dots/commas to be safe for thousand separators
    amountStr = amountStr.replace(/[,.]/g, '');
  }

  let amount = parseFloat(amountStr);

  if (suffix === 'k') {
    amount *= 1000;
  } else if (suffix === 'tr' || suffix === 'm') {
    amount *= 1000000;
  }

  if (isNaN(amount)) return null;

  return {
    category: category.charAt(0).toUpperCase() + category.slice(1),
    amount,
    note,
    type: isIncome ? 'income' : 'expense'
  };
}
