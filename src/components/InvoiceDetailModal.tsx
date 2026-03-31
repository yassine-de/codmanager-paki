import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Package, Truck, Phone, CreditCard, ArrowDownCircle, ArrowUpCircle, BarChart3 } from "lucide-react";
import { formatUSD } from "@/lib/currency";

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

function calcShippingFee(weightKg: number | null, qty: number, rates: Props["sellerRates"]): number {
  if (!rates || !weightKg || weightKg <= 0) return 0;
  const totalWeight = weightKg * qty;
  const rounded = Math.ceil(totalWeight);
  if (rounded <= 1) return rates.rate_1kg;
  if (rounded <= 2) return rates.rate_2kg;
  if (rounded <= 3) return rates.rate_3kg;
  return rates.rate_3kg_plus ?? rates.rate_3kg;
}

function getWeightBracket(weightKg: number | null, qty: number): string {
  if (!weightKg || weightKg <= 0) return "—";
  const total = Math.ceil(weightKg * qty);
  if (total <= 1) return "≤1 KG";
  if (total <= 2) return "≤2 KG";
  if (total <= 3) return "≤3 KG";
  return `${total} KG`;
}

export function InvoiceDetailModal({
  open, onOpenChange, invoiceId, invoiceNumber, sellerName, sellerId,
  sellerRates, codFeePercentage = 5, confirmedRate = 0, droppedRate = 0,
  isDraft, draftOrders
}: Props) {
  // Fetch all orders linked to this invoice
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

  // Fetch products to get weight_kg
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

  // Fetch addons
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

  // === CATEGORIZE ORDERS ===
  const deliveredOrders = displayOrders.filter(o => o.delivery_status === "delivered");
  const shippedOrders = displayOrders.filter(o => o.delivery_status === "shipped" || o.delivery_status === "in_transit" || o.delivery_status === "with_courier");
  const confirmedOrders = displayOrders.filter(o => o.confirmation_status === "confirmed");
  const droppedOrders = displayOrders.filter(o => o.confirmation_status === "cancelled");

  // === SECTION 1: DELIVERED ===
  const deliveredRevenuePKR = deliveredOrders.reduce((sum, o) => sum + (o.price * o.quantity), 0);

  // === SECTION 2: SHIPPING ===
  // Shipping applies to shipped + delivered orders
  const shippableOrders = displayOrders.filter(o => 
    o.delivery_status === "delivered" || o.delivery_status === "shipped" || 
    o.delivery_status === "in_transit" || o.delivery_status === "with_courier"
  );
  
  const shippingBreakdown = useMemo(() => {
    const brackets: Record<string, { count: number; fee: number }> = {
      "≤1 KG": { count: 0, fee: 0 },
      "≤2 KG": { count: 0, fee: 0 },
      "≤3 KG": { count: 0, fee: 0 },
      ">3 KG": { count: 0, fee: 0 },
    };
    let total = 0;
    shippableOrders.forEach(o => {
      const wKg = productWeightMap[o.product_name] ?? null;
      const fee = calcShippingFee(wKg, o.quantity, sellerRates);
      total += fee;
      const bracket = getWeightBracket(wKg, o.quantity);
      if (bracket === "≤1 KG") { brackets["≤1 KG"].count++; brackets["≤1 KG"].fee += fee; }
      else if (bracket === "≤2 KG") { brackets["≤2 KG"].count++; brackets["≤2 KG"].fee += fee; }
      else if (bracket === "≤3 KG") { brackets["≤3 KG"].count++; brackets["≤3 KG"].fee += fee; }
      else if (bracket !== "—") { brackets[">3 KG"].count++; brackets[">3 KG"].fee += fee; }
    });
    return { brackets, total };
  }, [shippableOrders, productWeightMap, sellerRates]);

  // === SECTION 3: CALL CENTER ===
  const confirmedFees = confirmedOrders.length * confirmedRate;
  const droppedFees = droppedOrders.length * droppedRate;
  const totalCallCenterFees = confirmedFees + droppedFees;

  // === SECTION 4: COD ===
  const codFees = deliveredOrders.length * (codFeePercentage / 100) * (deliveredRevenuePKR / (deliveredOrders.length || 1));
  // Actually COD is a percentage of delivered revenue
  const codFeesTotal = deliveredRevenuePKR * (codFeePercentage / 100);

  // === SECTION 5: ADDONS ===
  const addonNet = addons.reduce((sum, a) => a.type === "out" ? sum - a.amount : sum + a.amount, 0);

  // === FINAL ===
  const totalDeductions = shippingBreakdown.total + totalCallCenterFees + codFeesTotal;
  const netPayable = deliveredRevenuePKR - totalDeductions + addonNet;

  const SectionHeader = ({ icon: Icon, title, color }: { icon: any; title: string; color: string }) => (
    <div className={`flex items-center gap-2 px-4 py-2.5 border-b bg-muted/20`}>
      <Icon className={`h-4 w-4 ${color}`} />
      <span className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</span>
    </div>
  );

  const Row = ({ label, value, valueClass = "", bold = false }: { label: string; value: string; valueClass?: string; bold?: boolean }) => (
    <div className={`flex justify-between px-4 py-1.5 text-xs ${bold ? "font-bold text-sm" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular-nums font-semibold ${valueClass}`}>{value}</span>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {invoiceNumber}
            <span className="text-xs font-normal text-muted-foreground">— {sellerName}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[70vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : displayOrders.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-xs">
              No orders in this invoice.
            </div>
          ) : (
            <div>
              {/* SECTION 1: DELIVERED */}
              <SectionHeader icon={Package} title="Delivered Orders" color="text-success" />
              <div className="py-2">
                <Row label="Number of delivered orders" value={String(deliveredOrders.length)} />
                <Row label="Total revenue" value={`${deliveredRevenuePKR.toLocaleString()} PKR`} valueClass="text-foreground" />
              </div>

              {/* SECTION 2: SHIPPING */}
              <SectionHeader icon={Truck} title="Shipping Fees" color="text-info" />
              <div className="py-2">
                <Row label="Shipped + delivered orders" value={String(shippableOrders.length)} />
                {Object.entries(shippingBreakdown.brackets).map(([bracket, data]) => 
                  data.count > 0 && (
                    <Row 
                      key={bracket} 
                      label={`${bracket} × ${data.count} orders`} 
                      value={`-${formatUSD(data.fee)}`}
                      valueClass="text-destructive"
                    />
                  )
                )}
                <div className="border-t mx-4 mt-1 pt-1">
                  <Row label="Total shipping fees" value={`-${formatUSD(shippingBreakdown.total)}`} valueClass="text-destructive font-bold" />
                </div>
              </div>

              {/* SECTION 3: CALL CENTER */}
              <SectionHeader icon={Phone} title="Call Center Fees" color="text-warning" />
              <div className="py-2">
                <Row label={`Confirmed orders (${confirmedOrders.length} × ${formatUSD(confirmedRate)})`} value={`-${formatUSD(confirmedFees)}`} valueClass="text-destructive" />
                <Row label={`Dropped orders (${droppedOrders.length} × ${formatUSD(droppedRate)})`} value={`-${formatUSD(droppedFees)}`} valueClass="text-destructive" />
                <div className="border-t mx-4 mt-1 pt-1">
                  <Row label="Total call center fees" value={`-${formatUSD(totalCallCenterFees)}`} valueClass="text-destructive font-bold" />
                </div>
              </div>

              {/* SECTION 4: COD */}
              <SectionHeader icon={CreditCard} title={`COD Fees (${codFeePercentage}%)`} color="text-orange-500" />
              <div className="py-2">
                <Row label={`${codFeePercentage}% of delivered revenue`} value={`-${formatUSD(codFeesTotal)}`} valueClass="text-destructive" />
              </div>

              {/* ADDONS */}
              {addons.length > 0 && (
                <>
                  <SectionHeader icon={ArrowDownCircle} title="Addons" color="text-primary" />
                  <div className="py-2">
                    {addons.map(addon => (
                      <div key={addon.id} className="flex justify-between px-4 py-1 text-xs items-center">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          {addon.type === "in" ? (
                            <ArrowDownCircle className="h-3 w-3 text-success" />
                          ) : (
                            <ArrowUpCircle className="h-3 w-3 text-destructive" />
                          )}
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
              <div className="py-3 space-y-0.5">
                <Row label="Total Revenue (Delivered)" value={`${deliveredRevenuePKR.toLocaleString()} PKR`} />
                <div className="border-t mx-4 my-1" />
                <Row label="Shipping Fees" value={`-${formatUSD(shippingBreakdown.total)}`} valueClass="text-destructive" />
                <Row label="COD Fees" value={`-${formatUSD(codFeesTotal)}`} valueClass="text-destructive" />
                <Row label="Call Center Fees" value={`-${formatUSD(totalCallCenterFees)}`} valueClass="text-destructive" />
                {addonNet !== 0 && (
                  <Row label="Addons" value={`${addonNet >= 0 ? "+" : ""}${formatUSD(addonNet)}`} valueClass={addonNet >= 0 ? "text-success" : "text-destructive"} />
                )}
                <div className="border-t mx-4 my-1" />
                <div className="flex justify-between px-4 py-2">
                  <span className="text-sm font-bold">Net Payable</span>
                  <span className={`text-sm font-bold tabular-nums ${netPayable >= 0 ? "text-success" : "text-destructive"}`}>
                    {netPayable.toLocaleString()} PKR
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
