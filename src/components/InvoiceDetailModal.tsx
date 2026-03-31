import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Package, Truck, Phone, CreditCard, ArrowDownCircle, ArrowUpCircle, BarChart3 } from "lucide-react";
import { formatUSD, formatPKR, pkrToUsd } from "@/lib/currency";
import { InvoiceOrdersTable } from "@/components/invoice/InvoiceOrdersTable";
import { calcShippingFee } from "@/components/invoice/InvoiceShippedTable";


interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  sellerName: string;
  sellerId?: string;
  sellerRates: { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus?: number } | null;
  codFeePercentage?: number;
  confirmedRate?: number;
  droppedRate?: number;
  isDraft?: boolean;
  draftOrders?: any[];
}

export function InvoiceDetailModal({
  open, onOpenChange, invoiceId, invoiceNumber, sellerName, sellerId,
  sellerRates, codFeePercentage = 5, confirmedRate = 0, droppedRate = 0,
  isDraft, draftOrders
}: Props) {
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["invoice-detail-orders", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!invoiceId && !isDraft,
  });

  const displayOrders = isDraft ? (draftOrders || []) : orders;
  const resolvedSellerId = sellerId || (displayOrders.length > 0 ? displayOrders[0].seller_id : null);

  const { data: products = [] } = useQuery({
    queryKey: ["products-for-invoice-detail", resolvedSellerId],
    queryFn: async () => {
      if (!resolvedSellerId) return [];
      const { data, error } = await supabase
        .from("products")
        .select("name, weight_kg")
        .eq("seller_id", resolvedSellerId);
      if (error) throw error;
      return data as { name: string; weight_kg: number | null }[];
    },
    enabled: !!resolvedSellerId && open,
  });

  const productWeightMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    products.forEach(p => { map[p.name] = p.weight_kg; });
    return map;
  }, [products]);

  const { data: addons = [] } = useQuery({
    queryKey: ["invoice-addons-detail", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return [];
      const { data, error } = await supabase
        .from("invoice_addons")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as { id: string; type: string; amount: number; reason: string }[];
    },
    enabled: !!invoiceId && open,
  });

  // Categorize orders
  const deliveredOrders = displayOrders.filter(o => o.delivery_status === "delivered");
  const shippableOrders = displayOrders.filter(o =>
    o.delivery_status === "delivered" || o.delivery_status === "shipped" ||
    o.delivery_status === "in_transit" || o.delivery_status === "with_courier"
  );
  const confirmedOrders = displayOrders.filter(o => o.confirmation_status === "confirmed");
  const droppedOrders = displayOrders.filter(o => o.confirmation_status === "cancelled");

  // Revenue
  const deliveredRevenuePKR = deliveredOrders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
  const deliveredRevenueUSD = pkrToUsd(deliveredRevenuePKR);

  // Shipping
  const totalShippingFees = shippableOrders.reduce((sum, o) => {
    const wKg = productWeightMap[o.product_name] ?? null;
    return sum + calcShippingFee(wKg, o.quantity, sellerRates);
  }, 0);

  // Call center
  const confirmedFees = confirmedOrders.length * confirmedRate;
  const droppedFees = droppedOrders.length * droppedRate;
  const totalCallCenterFees = confirmedFees + droppedFees;

  // COD — 5% of USD revenue
  const codFeesTotal = deliveredRevenueUSD * (codFeePercentage / 100);

  // Addons
  const addonNet = addons.reduce((sum, a) => a.type === "out" ? sum - a.amount : sum + a.amount, 0);

  // Final — all in USD
  const totalDeductions = totalShippingFees + totalCallCenterFees + codFeesTotal;
  const netPayable = deliveredRevenueUSD - totalDeductions + addonNet;

  const SectionHeader = ({ icon: Icon, title, color, count }: { icon: any; title: string; color: string; count?: number }) => (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-t bg-muted/30">
      <Icon className={`h-4 w-4 ${color}`} />
      <span className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{count}</span>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {invoiceNumber}
            <span className="text-xs font-normal text-muted-foreground">— {sellerName}</span>
            {isDraft && <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded font-semibold">DRAFT</span>}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayOrders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-xs">No orders in this invoice.</div>
          ) : (
            <div>
              {/* SECTION 1: DELIVERED ORDERS DETAIL TABLE */}
              <SectionHeader icon={Package} title="Delivered Orders Details" color="text-success" count={deliveredOrders.length} />
              <InvoiceOrdersTable orders={deliveredOrders} productWeightMap={productWeightMap} />

              {/* SECTION 2: SHIPPED ORDERS — SUMMARY ONLY */}
              <SectionHeader icon={Truck} title="Shipping Fees" color="text-info" count={shippableOrders.length} />
              <div className="px-4 py-2 space-y-1">
                {(() => {
                  const brackets: Record<string, { count: number; fee: number }> = {
                    "≤1 KG": { count: 0, fee: 0 }, "≤2 KG": { count: 0, fee: 0 },
                    "≤3 KG": { count: 0, fee: 0 }, ">3 KG": { count: 0, fee: 0 },
                  };
                  shippableOrders.forEach(o => {
                    const wKg = productWeightMap[o.product_name] ?? null;
                    const fee = calcShippingFee(wKg, o.quantity, sellerRates);
                    const total = wKg ? Math.ceil(wKg * o.quantity) : 0;
                    const key = total <= 1 ? "≤1 KG" : total <= 2 ? "≤2 KG" : total <= 3 ? "≤3 KG" : ">3 KG";
                    if (total > 0) { brackets[key].count++; brackets[key].fee += fee; }
                  });
                  return Object.entries(brackets).filter(([, d]) => d.count > 0).map(([bracket, data]) => (
                    <div key={bracket} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{bracket} × {data.count} orders</span>
                      <span className="tabular-nums font-semibold text-destructive">-{formatUSD(data.fee)}</span>
                    </div>
                  ));
                })()}
                <div className="border-t pt-1 mt-1 flex justify-between text-xs font-bold">
                  <span>Total Shipping</span>
                  <span className="tabular-nums text-destructive">-{formatUSD(totalShippingFees)}</span>
                </div>
              </div>

              {/* SECTION 3: CALL CENTER — SUMMARY ONLY */}
              <SectionHeader icon={Phone} title="Call Center Fees" color="text-warning" count={confirmedOrders.length + droppedOrders.length} />
              <div className="px-4 py-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Confirmed orders ({confirmedOrders.length} × {formatUSD(confirmedRate)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(confirmedOrders.length * confirmedRate)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Dropped orders ({droppedOrders.length} × {formatUSD(droppedRate)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(droppedOrders.length * droppedRate)}</span>
                </div>
                <div className="border-t pt-1 mt-1 flex justify-between text-xs font-bold">
                  <span>Total Call Center</span>
                  <span className="tabular-nums text-destructive">-{formatUSD(totalCallCenterFees)}</span>
                </div>
              </div>

              {/* SECTION 4: COD FEES */}
              <SectionHeader icon={CreditCard} title={`COD Fees (${codFeePercentage}%)`} color="text-orange-500" />
              <div className="px-4 py-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{codFeePercentage}% of delivered revenue ({formatUSD(deliveredRevenueUSD)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(codFeesTotal)}</span>
                </div>
              </div>

              {/* ADDONS */}
              {addons.length > 0 && (
                <>
                  <SectionHeader icon={ArrowDownCircle} title="Addons" color="text-primary" count={addons.length} />
                  <div className="py-2">
                    {addons.map(addon => (
                      <div key={addon.id} className="flex justify-between px-4 py-1 text-xs items-center">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {addon.type === "in" ? <ArrowDownCircle className="h-3 w-3 text-success" /> : <ArrowUpCircle className="h-3 w-3 text-destructive" />}
                          {addon.reason || (addon.type === "in" ? "Bonus" : "Deduction")}
                        </span>
                        <span className={`font-semibold tabular-nums ${addon.type === "in" ? "text-success" : "text-destructive"}`}>
                          {addon.type === "in" ? "+" : "-"}{formatUSD(addon.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* SECTION 5: FINAL SUMMARY */}
              <SectionHeader icon={BarChart3} title="Final Summary" color="text-primary" />
              <div className="py-3 px-4 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total Delivered Revenue</span>
                  <span className="tabular-nums font-semibold text-success">{formatUSD(deliveredRevenueUSD)}</span>
                </div>
                <div className="border-t my-1" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Shipping Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totalShippingFees)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">COD Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(codFeesTotal)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Call Center Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totalCallCenterFees)}</span>
                </div>
                {addonNet !== 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Addons</span>
                    <span className={`tabular-nums font-semibold ${addonNet >= 0 ? "text-success" : "text-destructive"}`}>
                      {addonNet >= 0 ? "+" : ""}{formatUSD(addonNet)}
                    </span>
                  </div>
                )}
                <div className="border-t my-1" />
                <div className="flex justify-between py-1.5">
                  <span className="text-sm font-bold">Net Payable</span>
                  <span className={`text-sm font-bold tabular-nums ${netPayable >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatUSD(netPayable)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
