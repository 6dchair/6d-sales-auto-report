import type { Transaction } from "../types";

const money = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * True when a transaction matches the search text.
 * Every word typed must appear somewhere in: reference number, product,
 * category, date (2026-10-11), status, or amount (1234.50 or 1,234.50).
 * Matching ignores upper/lower case.
 */
export function matchesSearch(transaction: Transaction, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [
    transaction.referenceNumber,
    transaction.product,
    transaction.category,
    transaction.date,
    transaction.status,
    transaction.amount.toFixed(2),
    money.format(transaction.amount),
  ]
    .join(" ")
    .toLowerCase();

  return words.every((word) => haystack.includes(word));
}