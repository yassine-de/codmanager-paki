export type RawSheetOrderItem = {
  sku: string;
  productName: string;
  quantity: string;
  price: string;
};

function splitItemValues(value: string | null | undefined, options: { comma?: boolean } = {}): string[] {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const separator = /\r?\n/.test(raw)
    ? /\r?\n/
    : options.comma && raw.includes(",")
      ? /,/
      : /[|;]/;

  return raw
    .split(separator)
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
  const skus = splitItemValues(input.sku, { comma: true });
  if (skus.length === 0) throw new Error("SKU is empty");

  const productNames = alignLines(splitItemValues(input.productName), skus.length, "Product Name");
  const quantities = alignLines(splitItemValues(input.quantity, { comma: true }), skus.length, "Quantity");
  const prices = alignLines(splitItemValues(input.price, { comma: true }), skus.length, "Price");

  return skus.map((sku, index) => ({
    sku,
    productName: productNames[index],
    quantity: quantities[index],
    price: prices[index],
  }));
}
