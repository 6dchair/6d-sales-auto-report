export const currency = (value: number) =>
  new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 2,
  }).format(value);

// Compact axis labels: 200 -> ₱200, 2500 -> ₱2.5k, 1200000 -> ₱1.2M
export const formatAxisCurrency = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₱${+(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₱${+(value / 1_000).toFixed(1)}k`;
  return `₱${value}`;
};

// "2026-10-05" -> "Oct 5"
export const formatShortDate = (iso: string) => {
  const date = new Date(`${iso}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
};

// Date -> "YYYY-MM-DD" in the user's local time zone (what the API expects).
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Hands a Blob to the browser as a file download.
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
