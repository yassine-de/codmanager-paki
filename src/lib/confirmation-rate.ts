export function confirmationDenominator(totalOrders: number, newOrders: number) {
  return Math.max(0, totalOrders - newOrders);
}

export function confirmationRatePercent(confirmedOrders: number, totalOrders: number, newOrders: number) {
  const denominator = confirmationDenominator(totalOrders, newOrders);
  return denominator > 0 ? Math.round((confirmedOrders / denominator) * 100) : 0;
}

export function confirmationRateRatio(confirmedOrders: number, totalOrders: number, newOrders: number) {
  const denominator = confirmationDenominator(totalOrders, newOrders);
  return denominator > 0 ? confirmedOrders / denominator : 0;
}
