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
 *
 * Compound format: "144tr300" = 144,300,000 / "2k5" = 2,500
 * The remainder after the suffix is treated as a decimal: XtrY → X.Y × 1,000,000
 */
export function parseExpense(input: string): ParsedExpense | null {
  const trimmed = input.trim();

  // Detect income: starts with "thu" or "nhận"
  const isIncome = /^(thu|nhận)\s/i.test(trimmed);

  // If income, remove prefix before parsing
  const textToParse = isIncome
    ? trimmed.replace(/^(thu|nhận)\s+/i, '')
    : trimmed;

  // Regex to match: [category] [number][optional suffix][optional remainder] [optional note]
  // Compound example: "ăn tối 144tr300 ghi chú" → ["ăn tối", "144", "tr", "300", "ghi chú"]
  const regex = /^(.+?)\s+([\d,.]+)\s*(k|tr|m|đ|d)?(\d+)?(?:\s+(.*))?$/i;
  const match = textToParse.match(regex);

  if (!match || !match[1] || !match[2]) return null;

  const category = match[1].trim();
  let amountStr = match[2];
  const suffix = match[3]?.toLowerCase();
  const remainder = match[4];
  const note = match[5]?.trim();

  let amount: number;

  if (suffix && remainder) {
    // Compound format: "144tr300" → parseFloat("144.300") × multiplier
    const cleanMain = amountStr.replace(/[,.]/g, '');
    amount = parseFloat(`${cleanMain}.${remainder}`);
  } else {
    // Handle thousand separators vs decimals
    if (suffix && (amountStr.includes('.') || amountStr.includes(','))) {
      if (/^\d{1,3}([.,]\d{3})+$/.test(amountStr)) {
        amountStr = amountStr.replace(/[,.]/g, '');
      } else {
        amountStr = amountStr.replace(/,/g, '.');
      }
    } else {
      amountStr = amountStr.replace(/[,.]/g, '');
    }
    amount = parseFloat(amountStr);
  }

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
