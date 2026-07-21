import { describe, expect, it } from "vitest";
import { deliveryRatePercent, isInShippedDeliveryPool } from "@/lib/delivery-rate";

describe("delivery rate", () => {
  it.each(["booked", "printed", "dispatched", null])("excludes pre-shipping status %s", (status) => {
    expect(isInShippedDeliveryPool(status)).toBe(false);
  });

  it.each([
    "shipped",
    "in_transit",
    "with_courier",
    "out_for_delivery",
    "delivered",
    "paid",
    "failed_attempt",
    "returned",
    "return_received",
  ])("includes shipped/downstream status %s", (status) => {
    expect(isInShippedDeliveryPool(status)).toBe(true);
  });

  it("calculates delivered over the shipped pool", () => {
    expect(deliveryRatePercent(61, 81)).toBe(75);
    expect(deliveryRatePercent(0, 0)).toBe(0);
  });
});
