export type RawSheetOrderItem = {
  sku: string;
  productName: string;
  quantity: string;
  price: string;
};

function splitLines(value: string | null | undefined): string[] {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function alignLines(values: string[], itemCount: number, columnName: string): string[] {
  if (values.length === 0) return Array(itemCount).fill("");
  if (values.length === 1) return Array(itemCount).fill(values[0]);
  if (values.length !== itemCount) {
    throw new Error(
      `${columnName} has ${values.length} lines but SKU has ${itemCount}. ` +
      "Use one line per SKU.",
    );
  }
  return values;
}

export function parseSheetOrderItems(input: {
  sku: string;
  productName?: string;
  quantity?: string;
  price?: string;
}): RawSheetOrderItem[] {
  const skus = splitLines(input.sku);
  if (skus.length === 0) throw new Error("SKU is empty");

  const productNames = alignLines(splitLines(input.productName), skus.length, "Product Name");
  const quantities = alignLines(splitLines(input.quantity), skus.length, "Quantity");
  const prices = alignLines(splitLines(input.price), skus.length, "Price");

  return skus.map((sku, index) => ({
    sku,
    productName: productNames[index],
    quantity: quantities[index],
    price: prices[index],
  }));
}
