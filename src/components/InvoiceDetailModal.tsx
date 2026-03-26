import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Package } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  sellerName: string;
  sellerId?: string;
  sellerRates: { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus?: number } | null;
  isDraft?: boolean;
  draftOrders?: any[];
}

function calculateFeeFromWeight(weightText: string | null, rates: { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus?: number } | null): number {
  if (!rates || !weightText) return 0;
  if (weightText === "up_to_1kg") return rates.rate_1kg;
  if (weightText === "up_to_2kg") return rates.rate_2kg;
  if (weightText === "up_to_3kg") return rates.rate_3kg;
  if (weightText === "more_than_3kg") return rates.rate_3kg_plus ?? 6;
  return 0;
}

const weightLabels: Record<string, string> = {
  up_to_1kg: "≤1kg",
  up_to_2kg: "≤2kg",
  up_to_3kg: "≤3kg",
  more_than_3kg: ">3kg",
};

const deliveryStatusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground" },
  shipped: { label: "Shipped", color: "bg-info/15 text-info" },
  in_transit: { label: "In Transit", color: "bg-info/15 text-info" },
  with_courier: { label: "With Courier", color: "bg-warning/15 text-warning" },
  delivered: { label: "Delivered", color: "bg-success/15 text-success" },
  returned: { label: "Returned", color: "bg-destructive/15 text-destructive" },
  cancelled: { label: "Cancelled", color: "bg-destructive/15 text-destructive" },
  no_answer: { label: "No Answer", color: "bg-warning/15 text-warning" },
  postponed: { label: "Postponed", color: "bg-warning/15 text-warning" },
};

export function InvoiceDetailModal({ open, onOpenChange, invoiceId, invoiceNumber, sellerName, sellerId, sellerRates, isDraft, draftOrders }: Props) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["invoice-orders", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("delivered_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId && !isDraft,
  });

  const displayOrders = isDraft ? (draftOrders || []) : orders;

  // Determine seller ID from orders if not passed
  const resolvedSellerId = sellerId || (displayOrders.length > 0 ? displayOrders[0].seller_id : null);

  // Fetch products to get weight
  const { data: products = [] } = useQuery({
    queryKey: ["products-for-invoice-detail", resolvedSellerId],
    queryFn: async () => {
      if (!resolvedSellerId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("name, weight")
        .eq("seller_id", resolvedSellerId);
      if (error) throw error;
      return data as { name: string; weight: string | null }[];
    },
    enabled: !!resolvedSellerId && open,
  });

  const productWeightMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    products.forEach(p => { map[p.name] = p.weight; });
    return map;
  }, [products]);

  const getWeight = (productName: string) => productWeightMap[productName] || null;

  const totalAmount = displayOrders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
  const totalFees = displayOrders.reduce((sum, o) => sum + calculateFeeFromWeight(getWeight(o.product_name), sellerRates), 0);
  const netPayable = totalAmount - totalFees;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {invoiceNumber}
            <span className="text-xs font-normal text-muted-foreground">— {sellerName}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="p-0">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent bg-muted/30">
                    <TableHead className="text-[11px] font-semibold">Order ID</TableHead>
                    <TableHead className="text-[11px] font-semibold">Customer</TableHead>
                    <TableHead className="text-[11px] font-semibold">Phone</TableHead>
                    <TableHead className="text-[11px] font-semibold">Product</TableHead>
                    <TableHead className="text-[11px] font-semibold text-center">Qty</TableHead>
                    <TableHead className="text-[11px] font-semibold text-center">Weight</TableHead>
                    <TableHead className="text-[11px] font-semibold text-center">Status</TableHead>
                    <TableHead className="text-[11px] font-semibold text-right">Fees</TableHead>
                    <TableHead className="text-[11px] font-semibold text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {displayOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center py-10 text-muted-foreground text-xs">
                        No orders in this invoice.
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayOrders.map(order => {
                      const wText = getWeight(order.product_name);
                      const fee = calculateFeeFromWeight(wText, sellerRates);
                      const amount = order.price * order.quantity;
                      const statusCfg = deliveryStatusConfig[order.delivery_status || "pending"] || deliveryStatusConfig.pending;
                      return (
                        <TableRow key={order.id} className="text-xs">
                          <TableCell className="font-mono font-medium text-primary">{order.order_id}</TableCell>
                          <TableCell className="font-medium">{order.customer_name}</TableCell>
                          <TableCell className="text-muted-foreground">{order.customer_phone}</TableCell>
                          <TableCell className="max-w-[150px] truncate">{order.product_name}</TableCell>
                          <TableCell className="text-center tabular-nums">{order.quantity}</TableCell>
                          <TableCell className="text-center">
                            {wText ? (
                              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                                {weightLabels[wText] || wText}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${statusCfg.color}`}>
                              {statusCfg.label}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{fee.toFixed(2)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{amount.toLocaleString()}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>

              {/* Summary */}
              {displayOrders.length > 0 && (
                <div className="border-t px-5 py-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Orders</span>
                    <span className="font-semibold">{displayOrders.length}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Amount (price × qty)</span>
                    <span className="font-semibold tabular-nums">{totalAmount.toLocaleString()} MAD</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Total Fees (shipping rates)</span>
                    <span className="font-semibold tabular-nums text-destructive">-{totalFees.toFixed(2)} MAD</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between text-sm">
                    <span className="font-bold">Net Payable</span>
                    <span className="font-bold text-success tabular-nums">{netPayable.toLocaleString()} MAD</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}