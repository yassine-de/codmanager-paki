import { pkrToUsd } from "@/lib/currency";

// ── Shipping Rates ──────────────────────────────────────────────

export interface SellerShippingRates {
  rate_1kg: number;
  rate_2kg: number;
  rate_3kg: number;
  rate_3kg_plus?: number;
}

export function calcShippingFee(
  weightKg: number | null,
  qty: number,
  rates: SellerShippingRates | null
): number {
  if (!rates || !weightKg || weightKg <= 0) return 0;
  const rounded = Math.ceil(weightKg * qty);
  if (rounded <= 1) return rates.rate_1kg;
  if (rounded <= 2) return rates.rate_2kg;
  if (rounded <= 3) return rates.rate_3kg;
  return rates.rate_3kg_plus ?? rates.rate_3kg;
}

export function getWeightBracket(wKg: number | null, qty: number): string {
  if (!wKg || wKg <= 0) return "—";
  const total = Math.ceil(wKg * qty);
  if (total <= 1) return "≤1 KG";
  if (total <= 2) return "≤2 KG";
  if (total <= 3) return "≤3 KG";
  return `${total} KG`;
}

// ── Invoice Calculation Engine ──────────────────────────────────

export interface InvoiceSummaryResult {
  deliveredRevenueUSD: number;
  shippingFees: number;
  callCenterFees: number;
  codFees: number;
  addonNet: number;
  previousBalance: number;
  netPayable: number;
  deliveredCount: number;
  shippedCount: number;
  confirmedCount: number;
  totalOrdersCount: number;
}

export interface InvoiceCalcParams {
  orders: Array<{
    price: number;
    quantity: number;
    delivery_status: string | null;
    confirmation_status: string;
    product_name: string;
  }>;
  totalSellerOrders: number;
  shippingRates: SellerShippingRates | null;
  confirmedRate: number;
  droppedRate: number;
  codFeePercentage: number;
  addons: Array<{ type: string; amount: number }>;
  previousBalance: number;
  getProductWeight: (productName: string) => number | null;
}

/**
 * Single source of truth for invoice calculation.
 *
 * seller_payout =
 *   total_delivered_revenue_usd
 *   - shipping_fees
 *   - call_center_fees
 *   - cod_fees
 *   + addons_net
 *   + previous_balance
 */
export function calculateInvoiceSummary(params: InvoiceCalcParams): InvoiceSummaryResult {
  const {
    orders,
    totalSellerOrders,
    shippingRates,
    confirmedRate,
    droppedRate,
    codFeePercentage,
    addons,
    previousBalance,
    getProductWeight,
  } = params;

  // 1. Delivered orders → revenue (PKR → USD)
  const delivered = orders.filter(o => o.delivery_status === "delivered");
  const deliveredRevenuePKR = delivered.reduce((sum, o) => sum + o.price * o.quantity, 0);
  const deliveredRevenueUSD = pkrToUsd(deliveredRevenuePKR);

  // 2. Shipped orders → shipping fees (weight-based)
  const shipped = orders.filter(o => o.delivery_status === "shipped");
  const shippingFees = shipped.reduce((sum, o) => {
    const wKg = getProductWeight(o.product_name);
    return sum + calcShippingFee(wKg, o.quantity, shippingRates);
  }, 0);

  // 3. Call center fees
  //    confirmed × confirmed_rate  +  total_seller_orders × dropped_rate
  const confirmed = orders.filter(o => o.confirmation_status === "confirmed");
  const callCenterFees =
    confirmed.length * confirmedRate + totalSellerOrders * droppedRate;

  // 4. COD fees (percentage of delivered revenue in USD)
  const codFees = deliveredRevenueUSD * (codFeePercentage / 100);

  // 5. Addons net
  const addonNet = addons.reduce(
    (sum, a) => (a.type === "out" ? sum - a.amount : sum + a.amount),
    0
  );

  // 6. Net payable
  const netPayable =
    deliveredRevenueUSD -
    shippingFees -
    callCenterFees -
    codFees +
    addonNet +
    previousBalance;

  return {
    deliveredRevenueUSD,
    shippingFees,
    callCenterFees,
    codFees,
    addonNet,
    previousBalance,
    netPayable,
    deliveredCount: delivered.length,
    shippedCount: shipped.length,
    confirmedCount: confirmed.length,
    totalOrdersCount: totalSellerOrders,
  };
}
