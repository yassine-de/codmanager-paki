import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { formatPKR } from "@/lib/currency";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Copy, Check, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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
  weight_kg?: number | null;
  total_weight_kg?: number | null;
  confirmation_status: string;
  delivery_status: string;
  has_adjustment: boolean;
  adjustment_invoice_id?: string | null;
  adjustment_invoice_number?: string | null;
}

interface Props {
  orders: Order[];
}

const statusColors: Record<string, string> = {
  delivered: "bg-success/15 text-success border-success/30",
  shipped: "bg-info/15 text-info border-info/30",
  returned: "bg-destructive/15 text-destructive border-destructive/30",
  confirmed: "bg-primary/15 text-primary border-primary/30",
  cancelled: "bg-destructive/15 text-destructive border-destructive/30",
  new: "bg-muted text-muted-foreground border-border",
  none: "bg-muted text-muted-foreground border-border",
};

function getDisplayStatus(order: Order) {
  if (order.delivery_status && order.delivery_status !== "none") {
    return order.delivery_status;
  }
  return order.confirmation_status;
}

export function InvoiceAllOrdersTable({ orders }: Props) {
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const filtered = useMemo(() => {
    return orders.filter(o => {
      if (search) {
        const s = search.toLowerCase();
        if (!o.order_id.toLowerCase().includes(s) && !o.customer_phone.includes(s) && !o.customer_name.toLowerCase().includes(s)) return false;
      }
      if (statusFilter !== "all") {
        const display = getDisplayStatus(o);
        if (display !== statusFilter) return false;
      }
      return true;
    });
  }, [orders, search, statusFilter]);

  const statuses = useMemo(() => {
    const s = new Set(orders.map(o => getDisplayStatus(o)));
    return Array.from(s).sort();
  }, [orders]);

  return (
    <div>
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
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {statuses.map(s => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="max-h-[300px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 z-10">
            <tr className="border-b">
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Order ID</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Customer</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Product</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Qty</th>
              <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Status</th>
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
                const displayStatus = getDisplayStatus(o);
                const amountPkr = o.price * o.quantity;
                return (
                  <tr
                    key={o.id}
                    className={`border-b ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}
                  >
                    <td className="px-3 py-1.5 font-mono text-[11px]">
                      <div className="flex items-center gap-1 text-foreground">
                        {o.order_id}
                        <button
                          className="ml-1 p-0.5 rounded hover:bg-muted transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(o.order_id);
                            setCopiedId(o.id);
                            toast.success("Order ID copied");
                            setTimeout(() => setCopiedId(null), 1500);
                          }}
                        >
                          {copiedId === o.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3 text-muted-foreground" />}
                        </button>
                        {o.has_adjustment && (
                          <span
                            title={o.adjustment_invoice_number ? `Adjusted in ${o.adjustment_invoice_number}` : "Has adjustment"}
                            className="inline-flex items-center gap-0.5 text-[9px] font-medium text-warning bg-warning/10 px-1 py-0.5 rounded"
                          >
                            <AlertTriangle className="w-3 h-3" />
                            {o.adjustment_invoice_number ? o.adjustment_invoice_number : "Adj"}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <div className="leading-tight">{o.customer_name}</div>
                      <div className="text-[10px] text-muted-foreground">{o.customer_phone}</div>
                    </td>
                    <td className="px-3 py-1.5">{o.product_name}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{o.quantity}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${statusColors[displayStatus] || statusColors.none}`}>
                        {displayStatus}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{formatPKR(amountPkr)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center px-4 py-2 border-t bg-muted/30">
        <span className="text-xs text-muted-foreground">{filtered.length} order{filtered.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}
