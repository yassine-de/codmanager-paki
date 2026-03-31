import { formatUSD } from "@/lib/currency";

interface Order {
  id: string;
  order_id: string;
  product_name: string;
  quantity: number;
}

interface Props {
  orders: Order[];
  productWeightMap: Record<string, number | null>;
  sellerRates: { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus?: number } | null;
}

function getWeightBracket(wKg: number | null, qty: number): string {
  if (!wKg || wKg <= 0) return "—";
  const total = Math.ceil(wKg * qty);
  if (total <= 1) return "≤1 KG";
  if (total <= 2) return "≤2 KG";
  if (total <= 3) return "≤3 KG";
  return `${total} KG`;
}

function calcShippingFee(wKg: number | null, qty: number, rates: Props["sellerRates"]): number {
  if (!rates || !wKg || wKg <= 0) return 0;
  const rounded = Math.ceil(wKg * qty);
  if (rounded <= 1) return rates.rate_1kg;
  if (rounded <= 2) return rates.rate_2kg;
  if (rounded <= 3) return rates.rate_3kg;
  return rates.rate_3kg_plus ?? rates.rate_3kg;
}

export function InvoiceShippedTable({ orders, productWeightMap, sellerRates }: Props) {
  const totalShipping = orders.reduce((sum, o) => {
    const wKg = productWeightMap[o.product_name] ?? null;
    return sum + calcShippingFee(wKg, o.quantity, sellerRates);
  }, 0);

  return (
    <div>
      <div className="max-h-[200px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 z-10">
            <tr className="border-b">
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Order ID</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Product</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Weight</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Shipping Cost</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-6 text-muted-foreground">No shipped orders</td></tr>
            ) : (
              orders.map((o, i) => {
                const wKg = productWeightMap[o.product_name] ?? null;
                const bracket = getWeightBracket(wKg, o.quantity);
                const fee = calcShippingFee(wKg, o.quantity, sellerRates);
                return (
                  <tr key={o.id} className={`border-b ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                    <td className="px-3 py-1.5 font-mono text-[11px]">{o.order_id}</td>
                    <td className="px-3 py-1.5">{o.product_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{bracket}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-destructive">-{formatUSD(fee)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="flex justify-between items-center px-4 py-2 border-t bg-muted/30">
        <span className="text-xs text-muted-foreground">{orders.length} order{orders.length !== 1 ? "s" : ""}</span>
        <span className="text-xs font-bold text-destructive tabular-nums">Total: -{formatUSD(totalShipping)}</span>
      </div>
    </div>
  );
}

export { calcShippingFee, getWeightBracket };
