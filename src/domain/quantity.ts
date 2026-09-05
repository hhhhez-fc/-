export const MAX_LABEL_QUANTITY = 1000;

// Zero is an explicit, serializable invalid state that print validation rejects.
export function parseQuantity(value: unknown): { quantity: number } {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text)) return { quantity: 0 };
  const quantity = Number(text);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= MAX_LABEL_QUANTITY
    ? { quantity }
    : { quantity: 0 };
}
