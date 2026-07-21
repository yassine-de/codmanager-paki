export const DELIVERED_DELIVERY_STATUSES = ["delivered", "paid"] as const;

// Orders enter the delivery-rate denominator only after the courier has shipped
// them. Booked, printed, and dispatched are warehouse/pre-shipping stages.
export const SHIPPED_DELIVERY_STATUSES = [
  "shipped",
  "in_transit",
  "with_courier",
  "out_for_delivery",
  "delivered",
  "paid",
  "failed_attempt",
  "no_answer",
  "postponed",
  "returned",
  "return",
  "ready_for_return",
  "return_received",
] as const;

export function isDeliveredStatus(status: string | null | undefined): boolean {
  return DELIVERED_DELIVERY_STATUSES.includes(status as (typeof DELIVERED_DELIVERY_STATUSES)[number]);
}

export function isInShippedDeliveryPool(status: string | null | undefined): boolean {
  return SHIPPED_DELIVERY_STATUSES.includes(status as (typeof SHIPPED_DELIVERY_STATUSES)[number]);
}

export function deliveryRatePercent(delivered: number, shippedPool: number): number {
  return shippedPool > 0 ? Math.round((delivered / shippedPool) * 100) : 0;
}
