import type { Transaction } from "../types";

const money = new Intl.NumberFormat("en-PH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" });

// Lower-case, and ignore peso signs, "PHP" and thousands commas, so that
// "₱3,050.00", "php 3050" and "3,050" all find the same amount.
const normalize = (text: string) =>
  text.toLowerCase().replace(/[₱,]/g, "").replace(/\bphp\b/g, " ");

function dateForms(iso: string): string[] {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime()) ? [] : [shortDate.format(date), longDate.format(date)];
}

/**
 * True when a transaction matches the search text.
 * Every word typed must appear somewhere in: reference number, product,
 * category, date (2026-10-11, "Oct 11" or "October 2026"), status, or amount
 * (3050.00, 3,050.00 or ₱3,050.00). Upper/lower case does not matter.
 */
export function matchesSearch(transaction: Transaction, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = normalize(
    [
      transaction.referenceNumber,
      transaction.product,
      transaction.category,
      transaction.date,
      ...dateForms(transaction.date),
      transaction.status,
      transaction.amount.toFixed(2),
      money.format(transaction.amount),
    ].join(" ")
  );

  return words.every((word) => haystack.includes(word));
}
