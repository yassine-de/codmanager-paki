import { describe, expect, it } from "vitest";
import { parseSheetOrderItems } from "../../supabase/functions/_shared/sheet-order-items";

describe("parseSheetOrderItems", () => {
  it("parses a Shopify upsell row into parallel items", () => {
    expect(parseSheetOrderItems({
      productName: "Main product\nUpsell product",
      sku: "test 1\ntest 2",
      quantity: "1\n1",
      price: "5600\n5900",
    })).toEqual([
      { productName: "Main product", sku: "test 1", quantity: "1", price: "5600" },
      { productName: "Upsell product", sku: "test 2", quantity: "1", price: "5900" },
    ]);
  });

  it("reuses a single quantity or price for every SKU", () => {
    expect(parseSheetOrderItems({ sku: "A\r\nB", quantity: "1", price: "5000" })).toEqual([
      { productName: "", sku: "A", quantity: "1", price: "5000" },
      { productName: "", sku: "B", quantity: "1", price: "5000" },
    ]);
  });

  it("accepts explicit same-row upsell separators", () => {
    expect(parseSheetOrderItems({
      productName: "Main product; Upsell product",
      sku: "SKU-1; SKU-2",
      quantity: "1; 2",
      price: "6400; 3000",
    })).toEqual([
      { productName: "Main product", sku: "SKU-1", quantity: "1", price: "6400" },
      { productName: "Upsell product", sku: "SKU-2", quantity: "2", price: "3000" },
    ]);
  });

  it("rejects misaligned multi-line columns", () => {
    expect(() => parseSheetOrderItems({
      sku: "A\nB",
      quantity: "1\n2\n3",
    })).toThrow("Quantity has 3 lines but SKU has 2");
  });
});
