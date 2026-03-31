import { useState, useMemo, useEffect, useRef } from "react";
import { Calculator, Package, TrendingUp, TrendingDown, DollarSign, ShoppingCart, Truck, Weight, Users, Target, BarChart3, Zap, ArrowRight, CalendarIcon } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { DateRange } from "react-day-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

/* ── Animated Number ── */
function AnimatedNumber({ value, prefix = "", suffix = "", decimals = 2, className = "" }: { value: number; prefix?: string; suffix?: string; decimals?: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  useEffect(() => {
    const duration = 600;
    const start = ref.current;
    const diff = value - start;
    const startTime = performance.now();
    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * ease;
      setDisplay(current);
      ref.current = current;
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [value]);
  return <span className={className}>{prefix}{display.toFixed(decimals)}{suffix}</span>;
}

interface RealProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  landed_price: number | null;
  image_url: string | null;
  weight: string | null;
}

/* ── Default weight options (fallback) ── */
const DEFAULT_WEIGHT_OPTIONS = [
  { label: "0 - 1 kg", value: "1kg", rate: 3 },
  { label: "1 - 2 kg", value: "2kg", rate: 5 },
  { label: "2 - 3 kg", value: "3kg", rate: 7 },
];

export default function Simulation() {
  const { authUser } = useAuth();
  const [mode, setMode] = useState<"system" | "manual">("system");
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [costPerLead, setCostPerLead] = useState<string>("");
  const [numberOfLeads, setNumberOfLeads] = useState<string>("");
  const [selectedWeight, setSelectedWeight] = useState<string>("1kg");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Manual inputs
  const [manualBuyingPrice, setManualBuyingPrice] = useState<string>("");
  const [manualSellingPrice, setManualSellingPrice] = useState<string>("");
  const [manualConfirmationRate, setManualConfirmationRate] = useState<string>("");
  const [manualDeliveryRate, setManualDeliveryRate] = useState<string>("");

  // Real data from DB
  const [sellerRates, setSellerRates] = useState<{ rate_1kg: number; rate_2kg: number; rate_3kg: number } | null>(null);
  const [realProducts, setRealProducts] = useState<RealProduct[]>([]);
  const [orderMetrics, setOrderMetrics] = useState<{ confirmationRate: number; deliveryRate: number; totalLeads: number }>({ confirmationRate: 0, deliveryRate: 0, totalLeads: 0 });

  // Fetch seller products
  useEffect(() => {
    if (!authUser?.id) return;
    supabase
      .from("products")
      .select("id, name, sku, price, landed_price, image_url, weight")
      .eq("seller_id", authUser.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data) setRealProducts(data);
      });
  }, [authUser?.id]);

  // Fetch seller shipping rates from DB
  useEffect(() => {
    if (!authUser?.id) return;
    supabase
      .from("seller_rates")
      .select("rate_1kg, rate_2kg, rate_3kg")
      .eq("user_id", authUser.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setSellerRates(data);
      });
  }, [authUser?.id]);

  // Fetch real order metrics when product is selected
  useEffect(() => {
    if (mode !== "system" || !selectedProductId || !authUser?.id) return;
    const selectedProd = realProducts.find(p => p.id === selectedProductId);
    if (!selectedProd) return;

    const fetchMetrics = async () => {
      let query = supabase
        .from("orders")
        .select("confirmation_status, delivery_status, created_at")
        .eq("seller_id", authUser.id)
        .eq("product_name", selectedProd.name);

      if (dateRange?.from) {
        query = query.gte("created_at", dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        query = query.lte("created_at", new Date(dateRange.to.getTime() + 86400000 - 1).toISOString());
      }

      const { data: orders } = await query;
      if (!orders || orders.length === 0) {
        setOrderMetrics({ confirmationRate: 0, deliveryRate: 0, totalLeads: 0 });
        setNumberOfLeads("100");
        return;
      }

      const total = orders.length;
      const confirmed = orders.filter(o => ['confirmed', 'shipped', 'delivered'].includes(o.confirmation_status)).length;
      const delivered = orders.filter(o => o.delivery_status === 'delivered').length;

      setOrderMetrics({
        confirmationRate: total > 0 ? confirmed / total : 0,
        deliveryRate: confirmed > 0 ? delivered / confirmed : 0,
        totalLeads: total,
      });
      setNumberOfLeads(total > 0 ? total.toString() : "100");
    };

    fetchMetrics();
  }, [mode, selectedProductId, authUser?.id, dateRange, realProducts]);

  const weightOptions = useMemo(() => {
    if (sellerRates) {
      return [
        { label: "0 - 1 kg", value: "1kg", rate: Number(sellerRates.rate_1kg) },
        { label: "1 - 2 kg", value: "2kg", rate: Number(sellerRates.rate_2kg) },
        { label: "2 - 3 kg", value: "3kg", rate: Number(sellerRates.rate_3kg) },
      ];
    }
    return DEFAULT_WEIGHT_OPTIONS;
  }, [sellerRates]);

  const selectedProduct = useMemo(() => realProducts.find(p => p.id === selectedProductId), [selectedProductId, realProducts]);

  // Auto-select weight from product in system mode
  const autoShippingRate = useMemo(() => {
    if (mode === "system" && selectedProduct?.weight) {
      const w = parseFloat(selectedProduct.weight);
      if (!isNaN(w)) {
        if (w <= 1) return weightOptions[0]?.rate ?? 3;
        if (w <= 2) return weightOptions[1]?.rate ?? 5;
        return weightOptions[2]?.rate ?? 7;
      }
    }
    return null;
  }, [mode, selectedProduct, weightOptions]);

  const shippingRate = useMemo(() => {
    if (mode === "system" && autoShippingRate !== null) return autoShippingRate;
    return weightOptions.find(w => w.value === selectedWeight)?.rate ?? weightOptions[0]?.rate ?? 3;
  }, [mode, autoShippingRate, selectedWeight, weightOptions]);

  const metrics = useMemo(() => {
    if (mode === "system") {
      if (!selectedProduct) return null;
      const buyingPrice = selectedProduct.landed_price ? Number(selectedProduct.landed_price) : Math.round(Number(selectedProduct.price) * 0.4);
      return {
        sellingPrice: Number(selectedProduct.price),
        buyingPrice,
        confirmationRate: orderMetrics.confirmationRate,
        deliveryRate: orderMetrics.deliveryRate,
      };
    } else {
      const bp = parseFloat(manualBuyingPrice);
      const sp = parseFloat(manualSellingPrice);
      const cr = parseFloat(manualConfirmationRate);
      const dr = parseFloat(manualDeliveryRate);
      if (isNaN(bp) || isNaN(sp) || isNaN(cr) || isNaN(dr)) return null;
      return {
        sellingPrice: sp,
        buyingPrice: bp,
        confirmationRate: cr / 100,
        deliveryRate: dr / 100,
      };
    }
  }, [mode, selectedProduct, orderMetrics, manualBuyingPrice, manualSellingPrice, manualConfirmationRate, manualDeliveryRate]);

  const results = useMemo(() => {
    if (!metrics) return null;
    const leads = parseFloat(numberOfLeads) || 0;
    const cpl = parseFloat(costPerLead) || 0;

    const confirmedOrders = Math.round(leads * metrics.confirmationRate);
    const deliveredOrders = Math.round(confirmedOrders * metrics.deliveryRate);
    const revenue = deliveredOrders * metrics.sellingPrice;
    const productCost = deliveredOrders * metrics.buyingPrice;
    const adsCost = leads * cpl;
    const totalShipping = confirmedOrders * shippingRate;
    const codFees = revenue * 0.05;
    const totalProfit = revenue - productCost - adsCost - totalShipping - codFees;
    const profitPerOrder = deliveredOrders > 0 ? totalProfit / deliveredOrders : 0;
    const breakEvenCPL = leads > 0 ? (revenue - productCost - totalShipping - codFees) / leads : 0;

    return { confirmedOrders, deliveredOrders, revenue, productCost, adsCost, totalShipping, codFees, totalProfit, profitPerOrder, breakEvenCPL };
  }, [metrics, costPerLead, numberOfLeads, shippingRate]);

  const isProfitable = results ? results.totalProfit >= 0 : true;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center">
            <Calculator className="h-4.5 w-4.5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">Simulation</h1>
            <p className="text-xs text-muted-foreground">Calculate product profitability based on real data</p>
          </div>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center rounded-xl border border-border bg-muted/40 p-1 text-xs shadow-sm">
          <button
            onClick={() => setMode("system")}
            className={`px-4 py-2 rounded-lg transition-all font-medium ${mode === "system" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            📦 Existing Product
          </button>
          <button
            onClick={() => { setMode("manual"); setSelectedProductId(""); }}
            className={`px-4 py-2 rounded-lg transition-all font-medium ${mode === "manual" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
          >
            ✏️ Manual Input
          </button>
        </div>
      </div>

      {/* Product Data Card */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 bg-muted/20">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {mode === "system" ? "Product Data from System" : "Enter Product Data"}
            <Badge variant="outline" className="ml-2 text-[10px] font-normal">
              {mode === "system" ? "Auto-filled" : "Manual"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          {mode === "system" ? (
            <div className="space-y-5">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Select Product</Label>
                <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue placeholder="Choose a product..." />
                  </SelectTrigger>
                  <SelectContent>
                    {realProducts.map(p => (
                      <SelectItem key={p.id} value={p.id} className="text-sm">
                        <div className="flex items-center gap-2">
                          {p.image_url && <img src={p.image_url} alt="" className="w-5 h-5 rounded object-cover" />}
                          {p.name} — {p.price} $
                        </div>
                      </SelectItem>
                    ))}
                    {realProducts.length === 0 && (
                      <div className="px-3 py-4 text-sm text-muted-foreground text-center">No products found</div>
                    )}
                  </SelectContent>
                </Select>
              </div>
              {/* Date Range Filter */}
              {selectedProductId && (
                <div className="animate-in fade-in-0 slide-in-from-bottom-1 duration-200">
                  <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    <CalendarIcon className="h-3 w-3" /> Date Range
                    <Badge variant="outline" className="ml-1 text-[9px] font-normal">Optional</Badge>
                  </Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "w-full h-10 justify-start text-left text-sm font-normal",
                          !dateRange?.from && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {dateRange?.from ? (
                          dateRange.to ? (
                            <>
                              {format(dateRange.from, "dd MMM yyyy")} — {format(dateRange.to, "dd MMM yyyy")}
                            </>
                          ) : (
                            format(dateRange.from, "dd MMM yyyy")
                          )
                        ) : (
                          "All time (select to filter)"
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="range"
                        selected={dateRange}
                        onSelect={setDateRange}
                        numberOfMonths={2}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                      {dateRange?.from && (
                        <div className="px-3 pb-3">
                          <Button variant="ghost" size="sm" className="w-full text-xs text-muted-foreground" onClick={() => setDateRange(undefined)}>
                            Clear date filter
                          </Button>
                        </div>
                      )}
                    </PopoverContent>
                  </Popover>
                </div>
              )}
              {metrics && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
                  <MetricCard label="Buying Price" value={`${metrics.buyingPrice}`} unit="$" icon={ShoppingCart} color="text-warning" bg="bg-warning/10" />
                  <MetricCard label="Selling Price" value={`${metrics.sellingPrice}`} unit="$" icon={DollarSign} color="text-success" bg="bg-success/10" />
                  <MetricCard label="Confirmation Rate" value={`${(metrics.confirmationRate * 100).toFixed(1)}`} unit="%" icon={Target} color="text-info" bg="bg-info/10" />
                  <MetricCard label="Delivery Rate" value={`${(metrics.deliveryRate * 100).toFixed(1)}`} unit="%" icon={Truck} color="text-primary" bg="bg-primary/10" />
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><ShoppingCart className="h-3 w-3" /> Buying Price ($)</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 50" value={manualBuyingPrice} onChange={e => setManualBuyingPrice(e.target.value)} className="h-10 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><DollarSign className="h-3 w-3" /> Selling Price ($)</Label>
                <Input type="number" min="0" step="0.01" placeholder="e.g. 120" value={manualSellingPrice} onChange={e => setManualSellingPrice(e.target.value)} className="h-10 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Target className="h-3 w-3" /> Confirmation Rate (%)</Label>
                <Input type="number" min="0" max="100" step="1" placeholder="e.g. 45" value={manualConfirmationRate} onChange={e => setManualConfirmationRate(e.target.value)} className="h-10 text-sm" />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1"><Truck className="h-3 w-3" /> Delivery Rate (%)</Label>
                <Input type="number" min="0" max="100" step="1" placeholder="e.g. 65" value={manualDeliveryRate} onChange={e => setManualDeliveryRate(e.target.value)} className="h-10 text-sm" />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Inputs Card - 2 cols */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3 bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              Simulation Inputs
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <BarChart3 className="h-3 w-3" /> Cost Per Lead ($)
              </Label>
              <Input
                type="number" min="0" step="0.01" placeholder="e.g. 0.50"
                value={costPerLead} onChange={e => setCostPerLead(e.target.value)}
                className="h-10 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                <Users className="h-3 w-3" /> Number of Leads
                {mode === "system" && selectedProduct && (
                  <Badge variant="outline" className="ml-1 text-[9px] font-normal text-info">Auto-filled</Badge>
                )}
              </Label>
              <Input
                type="number" min="0" step="1" placeholder="e.g. 1000"
                value={numberOfLeads} onChange={e => setNumberOfLeads(e.target.value)}
                className="h-10 text-sm"
              />
            </div>
            {mode === "system" && selectedProduct?.weight && (
              <div className="rounded-lg bg-muted/30 border border-border p-3 flex items-center gap-2">
                <Weight className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Product Weight:</span>
                <span className="text-sm font-medium text-foreground">{selectedProduct.weight} kg</span>
                <Badge variant="outline" className="ml-1 text-[9px] font-normal text-info">Auto</Badge>
                <span className="text-xs text-muted-foreground ml-auto">Shipping: <span className="font-semibold text-foreground">{shippingRate} $</span></span>
              </div>
            )}
            {mode === "manual" && (
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                  <Weight className="h-3 w-3" /> Product Weight
                  {sellerRates && (
                    <Badge variant="outline" className="ml-1 text-[9px] font-normal text-success">Your Rates</Badge>
                  )}
                </Label>
                <Select value={selectedWeight} onValueChange={setSelectedWeight}>
                  <SelectTrigger className="h-10 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {weightOptions.map(w => (
                      <SelectItem key={w.value} value={w.value} className="text-sm">
                        {w.label} — {w.rate} $ shipping
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Shipping: <span className="font-semibold text-foreground">{shippingRate} $</span> per confirmed order
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Results Card - 3 cols */}
        <Card className={`lg:col-span-3 transition-all duration-300 ${results && results.totalProfit !== 0 ? (isProfitable ? "ring-2 ring-success/20 shadow-lg shadow-success/5" : "ring-2 ring-destructive/20 shadow-lg shadow-destructive/5") : ""}`}>
          <CardHeader className="pb-3 bg-muted/20">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {isProfitable ? <TrendingUp className="h-4 w-4 text-success" /> : <TrendingDown className="h-4 w-4 text-destructive" />}
              Profit Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-5">
            {!results || !metrics ? (
              <div className="py-12 text-center">
                <div className="h-12 w-12 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto mb-3">
                  <Calculator className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="text-sm text-muted-foreground">Select a product and enter your inputs to see results</p>
              </div>
            ) : (
              <div className="space-y-5 animate-in fade-in-0 slide-in-from-bottom-3 duration-500">
                {/* Hero profit cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className={`rounded-2xl p-5 text-center transition-all ${isProfitable ? "bg-success/10 border border-success/20" : "bg-destructive/10 border border-destructive/20"}`}>
                    <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Profit Per Order</p>
                    <AnimatedNumber
                      value={results.profitPerOrder}
                      suffix=" $"
                      className={`text-2xl md:text-3xl font-bold ${isProfitable ? "text-success" : "text-destructive"}`}
                    />
                  </div>
                  <div className={`rounded-2xl p-5 text-center transition-all ${isProfitable ? "bg-success/5 border border-success/10" : "bg-destructive/5 border border-destructive/10"}`}>
                    <p className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground mb-2">Total Profit</p>
                    <AnimatedNumber
                      value={results.totalProfit}
                      suffix=" $"
                      className={`text-2xl md:text-3xl font-bold ${isProfitable ? "text-success" : "text-destructive"}`}
                    />
                  </div>
                </div>

                {/* Flow summary */}
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{parseFloat(numberOfLeads) || 0}</span> leads
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium text-info">{results.confirmedOrders}</span> confirmed
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-medium text-success">{results.deliveredOrders}</span> delivered
                </div>

                {/* Breakdown */}
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-2.5 text-sm">
                  <BreakdownRow label="Revenue" value={`+${results.revenue.toFixed(2)} $`} colorClass="text-success" />
                  <BreakdownRow label="Product Cost" value={`-${results.productCost.toFixed(2)} $`} colorClass="text-destructive" />
                  <BreakdownRow label="Ads Cost" value={`-${results.adsCost.toFixed(2)} $`} colorClass="text-destructive" />
                  <BreakdownRow label={`Shipping (${shippingRate} $ × ${results.confirmedOrders})`} value={`-${results.totalShipping.toFixed(2)} $`} colorClass="text-destructive" />
                  <BreakdownRow label={`COD Fees (5% × ${results.revenue.toFixed(0)}$)`} value={`-${results.codFees.toFixed(2)} $`} colorClass="text-destructive" />
                  <div className="border-t border-border pt-2.5 flex justify-between items-center font-bold">
                    <span className="text-foreground">Net Profit</span>
                    <AnimatedNumber
                      value={results.totalProfit}
                      suffix=" $"
                      className={`text-base ${isProfitable ? "text-success" : "text-destructive"}`}
                    />
                  </div>
                  <div className="border-t border-dashed border-border pt-2.5 flex justify-between items-center">
                    <span className="text-muted-foreground text-xs">⚡ Break-even CPL</span>
                    <span className="font-bold text-warning">{results.breakEvenCPL.toFixed(2)} $</span>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ── Small Components ── */
function MetricCard({ label, value, unit, icon: Icon, color, bg }: { label: string; value: string; unit: string; icon: any; color: string; bg: string }) {
  return (
    <div className={`rounded-xl ${bg} p-4 text-center transition-all hover:scale-[1.02]`}>
      <div className={`h-8 w-8 rounded-lg ${bg} flex items-center justify-center mx-auto mb-2`}>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <p className="text-[10px] text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-bold text-foreground mt-0.5">
        {value}<span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>
      </p>
    </div>
  );
}

function BreakdownRow({ label, value, colorClass }: { label: string; value: string; colorClass: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-semibold ${colorClass}`}>{value}</span>
    </div>
  );
}
