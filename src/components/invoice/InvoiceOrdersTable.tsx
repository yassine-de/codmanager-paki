import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { formatUSD, formatPKR, pkrToUsd } from "@/lib/currency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ExternalLink } from "lucide-react";

interface Order {
  id: string;
  order_id: string;
  customer_name: string;
  customer_phone: string;
  product_name: string;
  quantity: number;
  price: number;
  total_amount?: number;
  created_at: string;
  amount_usd?: number;
  weight_kg?: number | null;
  total_weight_kg?: number | null;
}

interface Props {
  orders: Order[];
  productWeightMap: Record<string, number | null>;
}

export function InvoiceOrdersTable({ orders, productWeightMap }: Props) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("all");

  const productNames = useMemo(() => {
    const names = new Set(orders.map(o => o.product_name));
    return Array.from(names).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_id.toLowerCase().includes(s) && !o.customer_phone.includes(s) && !o.customer_name.toLowerCase().includes(s)) return false;
      }
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      return true;
    });
  }, [orders, search, productFilter]);

  const totalRevenuePkr = filtered.reduce((sum, o) => sum + (o.price * o.quantity), 0);
  const totalRevenueUsd = pkrToUsd(totalRevenuePkr);

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-2 px-4 py-2 border-b bg-muted/10">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by phone, order ID, name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={productFilter} onValueChange={setProductFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue placeholder="Product" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Products</SelectItem>
            {productNames.map(name => (
              <SelectItem key={name} value={name}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="max-h-[250px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 z-10">
            <tr className="border-b">
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Order ID</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Customer</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Product</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Weight</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Amount (Rs)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center py-6 text-muted-foreground">No orders found</td>
              </tr>
            ) : (
              filtered.map((o, i) => {
                const wKg = o.weight_kg ?? productWeightMap[o.product_name] ?? 0;
                const totalWeight = o.total_weight_kg ?? (wKg * o.quantity);
                const amountPkr = o.price * o.quantity;
                return (
                  <tr
                    key={o.id}
                    className={`border-b cursor-pointer transition-colors hover:bg-primary/5 ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                    onClick={() => navigate(`/orders/${o.id}`)}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      <div className="flex items-center gap-1 text-primary">
                        {o.order_id}
                        <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="leading-tight">{o.customer_name}</div>
                      <div className="text-[10px] text-muted-foreground">{o.customer_phone}</div>
                    </td>
                    <td className="px-3 py-1.5">{o.product_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{totalWeight > 0 ? `${totalWeight.toFixed(1)} KG` : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatPKR(amountPkr)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Footer totals */}
      <div className="flex justify-between items-center px-4 py-2 border-t bg-muted/30">
        <span className="text-xs text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</span>
        <div className="text-right">
          <span className="text-sm font-bold tabular-nums">{formatPKR(totalRevenuePkr)}</span>
          <span className="text-sm font-bold text-primary ml-2">= {formatUSD(totalRevenueUsd)}</span>
        </div>
      </div>
    </div>
  );
}
