export function parseQuantity(value: unknown): { quantity: number; needsReview: boolean } {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return { quantity: 1, needsReview: true };
  const quantity = Number(text);
  return Number.isSafeInteger(quantity) && quantity > 0
    ? { quantity, needsReview: false }
    : { quantity: 1, needsReview: true };
}
