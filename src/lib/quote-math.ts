// Current schema uses integer quantities and PostgreSQL int4 cents.
// Reject overflow before sending any values to the database.
export function quoteTotals(lines: { quantity: number; unitPriceCents: number }[], rate: number) {
  const subtotalCents = lines.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0);
  const taxCents = Math.round(subtotalCents * rate / 100);
  const totalCents = subtotalCents + taxCents;
  if (![subtotalCents, taxCents, totalCents].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 2147483647)) {
    throw Object.assign(new Error("El importe excede el límite permitido."), { statusCode: 400 });
  }
  return { subtotalCents, taxCents, totalCents };
}
