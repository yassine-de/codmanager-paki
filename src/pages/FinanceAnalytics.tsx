import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Truck, DollarSign, ChevronDown, CheckCircle2, Wallet, Loader2, XCircle, Package, CreditCard, Clock, Phone, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatUSD, pkrToUsd } from "@/lib/currency";
import { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";

type RevenueTab = "shipping" | "call_center" | "cod" | "sourcing";

export default function FinanceAnalytics() {
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [activeTab, setActiveTab] = useState<RevenueTab>("shipping");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["finance-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, seller_id, price, last_price, quantity, total_amount, shipping_cost, weight, invoice_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["finance-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, status, invoice_number, paid_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data;
    },
  });

  const { data: sellerRatesData = [] } = useQuery({
    queryKey: ["seller-rates-finance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("seller_rates").select("*");
      if (error) throw error;
      return data;
    },
  });

  const { data: sourcingRequests = [] } = useQuery({
    queryKey: ["finance-sourcing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("id, display_id, seller_id, product_name, quantity, unit_price, shipping_cost, total_price, seller_price, payment_status, seller_validated, status, created_at");
      if (error) throw error;
      return data;
    },
  });

  const { data: rateSettingsFinance = [] } = useQuery({
    queryKey: ["rate-settings-finance"],
    queryFn: async () => {
      const { data, error } = await supabase.from("rate_settings").select("seller_id, cod_fee_per_delivery, confirmed_order_rate, dropped_order_rate, is_global, is_custom");
      if (error) throw error;
      return data;
    },
  });

  // Invoice status map
  const invoiceStatusMap = useMemo(() => {
    const map: Record<string, { status: string; number: string }> = {};
    invoices.forEach(inv => { map[inv.id] = { status: inv.status, number: inv.invoice_number }; });
    return map;
  }, [invoices]);

  const isInvoicePaid = (invoiceId: string | null) => {
    if (!invoiceId) return false;
    return invoiceStatusMap[invoiceId]?.status === 'paid';
  };

  const rateHelpers = useMemo(() => {
    const globalRate = rateSettingsFinance.find(r => r.is_global && !r.seller_id);
    const globalCod = (globalRate?.cod_fee_per_delivery ?? 5) / 100;
    const globalConfirmed = globalRate?.confirmed_order_rate ?? 0.3;
    const globalDropped = globalRate?.dropped_order_rate ?? 0.2;
    const sellerCodMap: Record<string, number> = {};
    const sellerConfirmedMap: Record<string, number> = {};
    const sellerDroppedMap: Record<string, number> = {};
    rateSettingsFinance.forEach(r => {
      if (r.seller_id) {
        sellerCodMap[r.seller_id] = r.cod_fee_per_delivery / 100;
        sellerConfirmedMap[r.seller_id] = r.confirmed_order_rate;
        sellerDroppedMap[r.seller_id] = r.dropped_order_rate;
      }
    });
    return {
      getCodRate: (sellerId: string) => sellerCodMap[sellerId] ?? globalCod,
      getConfirmedRate: (sellerId: string) => sellerConfirmedMap[sellerId] ?? globalConfirmed,
      getDroppedRate: (sellerId: string) => sellerDroppedMap[sellerId] ?? globalDropped,
      globalConfirmedRate: globalConfirmed,
      globalDroppedRate: globalDropped,
      globalCodPercent: (globalRate?.cod_fee_per_delivery ?? 5),
    };
  }, [rateSettingsFinance]);

  const getShippingFee = useMemo(() => {
    const rateMap: Record<string, { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus: number }> = {};
    sellerRatesData.forEach(r => {
      rateMap[r.user_id] = { rate_1kg: r.rate_1kg, rate_2kg: r.rate_2kg, rate_3kg: r.rate_3kg, rate_3kg_plus: r.rate_3kg_plus };
    });
    return (sellerId: string, weightKg: number) => {
      const rates = rateMap[sellerId];
      if (!rates) return 3;
      if (weightKg <= 1) return rates.rate_1kg;
      if (weightKg <= 2) return rates.rate_2kg;
      if (weightKg <= 3) return rates.rate_3kg;
      return rates.rate_3kg_plus;
    };
  }, [sellerRatesData]);

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const sellerOptions = useMemo(() => {
    const ids = new Set([...orders.map(o => o.seller_id), ...sourcingRequests.map(s => s.seller_id)]);
    return [...ids].map(id => ({ value: id, label: profileNameMap[id] || id.slice(0, 8) })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests, profileNameMap]);

  const productOptions = useMemo(() => {
    const names = new Set([...orders.map(o => o.product_name).filter(Boolean), ...sourcingRequests.map(s => s.product_name).filter(Boolean)]);
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sourcingRequests]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(o => new Date(o.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(o => new Date(o.created_at) <= dateRange.to!);
    return filtered;
  }, [orders, sellerFilter, productFilter, dateRange]);

  const filteredSourcing = useMemo(() => {
    let filtered = sourcingRequests.filter(r => r.seller_validated === true);
    if (sellerFilter !== "all") filtered = filtered.filter(r => r.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(r => r.product_name === productFilter);
    if (dateRange?.from) filtered = filtered.filter(r => new Date(r.created_at) >= dateRange.from!);
    if (dateRange?.to) filtered = filtered.filter(r => new Date(r.created_at) <= dateRange.to!);
    return filtered;
  }, [sourcingRequests, sellerFilter, productFilter, dateRange]);

  // === CALCULATIONS with invoice-based paid/pending ===

  const shippedOrders = useMemo(() => {
    return filteredOrders.filter(o => o.delivery_status && ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned", "pending"].includes(o.delivery_status));
  }, [filteredOrders]);

  const shippingStats = useMemo(() => {
    let total = 0, paid = 0, pending = 0;
    const sellerMap: Record<string, { shipped: number; revenue: number; paid: number; pending: number }> = {};
    shippedOrders.forEach(o => {
      const weight = Number(o.weight) || 0.5;
      const fee = getShippingFee(o.seller_id, weight);
      const invoicePaid = isInvoicePaid(o.invoice_id);
      total += fee;
      if (invoicePaid) paid += fee; else pending += fee;

      if (!sellerMap[o.seller_id]) sellerMap[o.seller_id] = { shipped: 0, revenue: 0, paid: 0, pending: 0 };
      sellerMap[o.seller_id].shipped++;
      sellerMap[o.seller_id].revenue += fee;
      if (invoicePaid) sellerMap[o.seller_id].paid += fee; else sellerMap[o.seller_id].pending += fee;
    });
    const sellerDetails = Object.entries(sellerMap).map(([id, d]) => ({
      sellerId: id,
      sellerName: profileNameMap[id] || id.slice(0, 8),
      ...d,
    })).sort((a, b) => b.revenue - a.revenue);
    return { total, paid, pending, sellerDetails };
  }, [shippedOrders, getShippingFee, invoiceStatusMap, profileNameMap]);

  const confirmationStats = useMemo(() => {
    const confirmedOrders = filteredOrders.filter(o => o.confirmation_status === "confirmed");
    const droppedOrders = filteredOrders.filter(o => ["cancelled", "wrong_number", "double"].includes(o.confirmation_status));

    let confirmedRevenue = 0, confirmedPaid = 0, confirmedPending = 0;
    let droppedRevenue = 0, droppedPaid = 0, droppedPending = 0;

    const sellerMap: Record<string, { confirmed: number; dropped: number; upsell: number; confirmedRev: number; droppedRev: number; paid: number; pending: number }> = {};

    confirmedOrders.forEach(o => {
      const rate = rateHelpers.getConfirmedRate(o.seller_id);
      const invoicePaid = isInvoicePaid(o.invoice_id);
      confirmedRevenue += rate;
      if (invoicePaid) confirmedPaid += rate; else confirmedPending += rate;

      if (!sellerMap[o.seller_id]) sellerMap[o.seller_id] = { confirmed: 0, dropped: 0, upsell: 0, confirmedRev: 0, droppedRev: 0, paid: 0, pending: 0 };
      sellerMap[o.seller_id].confirmed++;
      sellerMap[o.seller_id].confirmedRev += rate;
      if (invoicePaid) sellerMap[o.seller_id].paid += rate; else sellerMap[o.seller_id].pending += rate;
      if (o.last_price && Number(o.last_price) > 0 && Number(o.last_price) !== Number(o.price)) sellerMap[o.seller_id].upsell++;
    });

    droppedOrders.forEach(o => {
      const rate = rateHelpers.getDroppedRate(o.seller_id);
      const invoicePaid = isInvoicePaid(o.invoice_id);
      droppedRevenue += rate;
      if (invoicePaid) droppedPaid += rate; else droppedPending += rate;

      if (!sellerMap[o.seller_id]) sellerMap[o.seller_id] = { confirmed: 0, dropped: 0, upsell: 0, confirmedRev: 0, droppedRev: 0, paid: 0, pending: 0 };
      sellerMap[o.seller_id].dropped++;
      sellerMap[o.seller_id].droppedRev += rate;
      if (invoicePaid) sellerMap[o.seller_id].paid += rate; else sellerMap[o.seller_id].pending += rate;
    });

    const sellerDetails = Object.entries(sellerMap).map(([id, d]) => ({
      sellerId: id,
      sellerName: profileNameMap[id] || id.slice(0, 8),
      ...d,
      totalRev: d.confirmedRev + d.droppedRev,
    })).sort((a, b) => b.totalRev - a.totalRev);

    return {
      confirmedCount: confirmedOrders.length,
      droppedCount: droppedOrders.length,
      confirmedRevenue, droppedRevenue,
      totalRevenue: confirmedRevenue + droppedRevenue,
      totalPaid: confirmedPaid + droppedPaid,
      totalPending: confirmedPending + droppedPending,
      sellerDetails,
    };
  }, [filteredOrders, rateHelpers, invoiceStatusMap, profileNameMap]);

  const codStats = useMemo(() => {
    const deliveredOrders = filteredOrders.filter(o => o.delivery_status === "delivered" || o.delivery_status === "paid");
    let total = 0, paid = 0, pending = 0;
    // Group by invoice
    const invoiceMap: Record<string, { invoiceNum: string; sellerId: string; codFees: number; isPaid: boolean; orderCount: number }> = {};

    deliveredOrders.forEach(o => {
      const amountUSD = pkrToUsd(Number(o.total_amount));
      const codFee = amountUSD * rateHelpers.getCodRate(o.seller_id);
      const invoicePaid = isInvoicePaid(o.invoice_id);
      total += codFee;
      if (invoicePaid) paid += codFee; else pending += codFee;

      const invKey = o.invoice_id || `no-invoice-${o.seller_id}`;
      if (!invoiceMap[invKey]) {
        invoiceMap[invKey] = {
          invoiceNum: o.invoice_id ? (invoiceStatusMap[o.invoice_id]?.number || '—') : 'No Invoice',
          sellerId: o.seller_id,
          codFees: 0,
          isPaid: invoicePaid,
          orderCount: 0,
        };
      }
      invoiceMap[invKey].codFees += codFee;
      invoiceMap[invKey].orderCount++;
    });

    const invoiceDetails = Object.values(invoiceMap)
      .map(d => ({ ...d, sellerName: profileNameMap[d.sellerId] || d.sellerId.slice(0, 8) }))
      .sort((a, b) => b.codFees - a.codFees);

    return { total, paid, pending, deliveredCount: deliveredOrders.length, invoiceDetails };
  }, [filteredOrders, rateHelpers, invoiceStatusMap, profileNameMap]);

  // Sourcing: profit based on payment_status from sourcing_requests
  const sourcingStats = useMemo(() => {
    let totalProfit = 0, totalAmount = 0, paidAmount = 0, unpaidAmount = 0, paidProfit = 0, unpaidProfit = 0, totalUnits = 0;
    const details: { id: string; displayId: string; product: string; quantity: number; sellerPrice: number; totalCost: number; profit: number; isPaid: boolean }[] = [];

    filteredSourcing.forEach(r => {
      const sellerOwes = (r.seller_price || 0) * r.quantity;
      const ourCost = r.total_price || 0;
      const profit = sellerOwes - ourCost;
      const isPaid = r.payment_status === 'paid';

      totalAmount += sellerOwes;
      totalProfit += profit;
      totalUnits += r.quantity;

      if (isPaid) { paidAmount += sellerOwes; paidProfit += profit; }
      else { unpaidAmount += sellerOwes; unpaidProfit += profit; }

      details.push({
        id: r.id,
        displayId: r.display_id || r.id.slice(0, 8),
        product: r.product_name,
        quantity: r.quantity,
        sellerPrice: r.seller_price || 0,
        totalCost: ourCost,
        profit,
        isPaid,
      });
    });

    return { totalProfit, totalAmount, paidAmount, unpaidAmount, paidProfit, unpaidProfit, totalUnits, count: filteredSourcing.length, details };
  }, [filteredSourcing]);

  const totalRevenueUSD = shippingStats.total + confirmationStats.totalRevenue + codStats.total + sourcingStats.totalProfit;
  const totalPaid = shippingStats.paid + confirmationStats.totalPaid + codStats.paid + sourcingStats.paidProfit;
  const totalPending = shippingStats.pending + confirmationStats.totalPending + codStats.pending + sourcingStats.unpaidProfit;

  // Revenue by seller
  const profitBySeller = useMemo(() => {
    const map: Record<string, { shipping: number; confirmation: number; cod: number; sourcing: number }> = {};
    filteredOrders.forEach(o => {
      const id = o.seller_id;
      if (!map[id]) map[id] = { shipping: 0, confirmation: 0, cod: 0, sourcing: 0 };
      if (o.delivery_status && ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned", "pending"].includes(o.delivery_status)) {
        map[id].shipping += getShippingFee(id, Number(o.weight) || 0.5);
      }
      if (o.confirmation_status === "confirmed") map[id].confirmation += rateHelpers.getConfirmedRate(id);
      else if (["cancelled", "wrong_number", "double"].includes(o.confirmation_status)) map[id].confirmation += rateHelpers.getDroppedRate(id);
      if (o.delivery_status === "delivered" || o.delivery_status === "paid") map[id].cod += pkrToUsd(Number(o.total_amount)) * rateHelpers.getCodRate(id);
    });
    filteredSourcing.forEach(r => {
      const id = r.seller_id;
      if (!map[id]) map[id] = { shipping: 0, confirmation: 0, cod: 0, sourcing: 0 };
      map[id].sourcing += ((r.seller_price || 0) * r.quantity) - (r.total_price || 0);
    });
    return Object.entries(map)
      .map(([id, d]) => ({
        name: profileNameMap[id] || id.slice(0, 8),
        total: Math.round((d.shipping + d.confirmation + d.cod + d.sourcing) * 100) / 100,
        shipping: Math.round(d.shipping * 100) / 100,
        confirmation: Math.round(d.confirmation * 100) / 100,
        cod: Math.round(d.cod * 100) / 100,
        sourcing: Math.round(d.sourcing * 100) / 100,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filteredOrders, filteredSourcing, profileNameMap, getShippingFee, rateHelpers]);

  const chartColors = ['hsl(var(--primary))', 'hsl(155, 50%, 42%)', 'hsl(38, 90%, 55%)', 'hsl(0, 65%, 52%)', 'hsl(220, 70%, 55%)'];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const tabs: { key: RevenueTab; label: string; icon: typeof Truck; total: number; paid: number; pending: number; color: string }[] = [
    { key: "shipping", label: "Shipping", icon: Truck, total: shippingStats.total, paid: shippingStats.paid, pending: shippingStats.pending, color: "text-primary" },
    { key: "call_center", label: "Call Center", icon: Phone, total: confirmationStats.totalRevenue, paid: confirmationStats.totalPaid, pending: confirmationStats.totalPending, color: "text-success" },
    { key: "cod", label: "COD Fees", icon: DollarSign, total: codStats.total, paid: codStats.paid, pending: codStats.pending, color: "text-warning" },
    { key: "sourcing", label: "Sourcing", icon: Package, total: sourcingStats.totalProfit, paid: sourcingStats.paidProfit, pending: sourcingStats.unpaidProfit, color: "text-info" },
  ];

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Finance</h1>
        <p className="text-muted-foreground text-sm mt-1">Exact revenue breakdown from shipping, call center, COD fees & sourcing</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter}
          options={sellerOptions} placeholder="Seller" allLabel="All Sellers" className="w-[180px]" />
        <SearchableSelect value={productFilter} onValueChange={setProductFilter}
          options={productOptions} placeholder="Product" allLabel="All Products" className="w-[180px]" />
        <DatePresetFilter dateRange={dateRange} onDateRangeChange={setDateRange} preset={datePreset} onPresetChange={setDatePreset} />
        {(sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Total Revenue Hero */}
      <div className="bg-gradient-to-br from-primary/10 via-card to-success/10 rounded-xl border-2 border-primary/20 p-6 animate-slide-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 rounded-xl bg-primary/15">
            <Wallet className="w-6 h-6 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground font-medium">Total Revenue</p>
            <p className="text-3xl font-bold tabular-nums tracking-tight">{formatUSD(totalRevenueUSD)}</p>
          </div>
          <div className="ml-auto flex gap-4">
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Paid</p>
              <p className="text-lg font-bold tabular-nums text-success">{formatUSD(totalPaid)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pending</p>
              <p className="text-lg font-bold tabular-nums text-warning">{formatUSD(totalPending)}</p>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {tabs.map(t => (
            <div key={t.key} className="bg-background/60 rounded-lg p-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">{t.label}</p>
              <p className="text-lg font-bold tabular-nums">{formatUSD(t.total)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                <span className="text-success">{formatUSD(t.paid)}</span>
                {t.pending > 0 && <span className="text-warning"> · {formatUSD(t.pending)}</span>}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue Breakdown - Interactive Tabs */}
      <div className="bg-card rounded-xl border overflow-hidden animate-slide-up" style={{ animationDelay: '80ms' }}>
        <div className="px-5 py-4 border-b flex items-center justify-between">
          <h2 className="text-base font-semibold">Revenues</h2>
          <div className="flex bg-muted/50 rounded-lg p-1 gap-0.5">
            {tabs.map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                    activeTab === t.key
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab Summary */}
        {(() => {
          const current = tabs.find(t => t.key === activeTab)!;
          return (
            <div className="px-5 py-4 border-b bg-muted/10">
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-xl font-bold tabular-nums">{formatUSD(current.total)}</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <p className="text-lg font-semibold tabular-nums text-success">{formatUSD(current.paid)}</p>
                </div>
                <div className="h-8 w-px bg-border" />
                <div>
                  <p className="text-xs text-muted-foreground">Pending</p>
                  <p className="text-lg font-semibold tabular-nums text-warning">{formatUSD(current.pending)}</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Tab Content */}
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          {activeTab === "shipping" && <ShippingDetails details={shippingStats.sellerDetails} />}
          {activeTab === "call_center" && <CallCenterDetails details={confirmationStats.sellerDetails} />}
          {activeTab === "cod" && <CodDetails details={codStats.invoiceDetails} />}
          {activeTab === "sourcing" && <SourcingDetails details={sourcingStats.details} />}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {profitBySeller.length > 0 && (
          <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '160ms' }}>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Revenue by Seller</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={profitBySeller} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatUSD(v)} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={110} />
                <Tooltip formatter={(v: number, name: string) => [formatUSD(v), name]} contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))', fontSize: '12px', background: 'hsl(var(--card))' }} />
                <Bar dataKey="shipping" stackId="a" name="Shipping" fill="hsl(var(--primary))" />
                <Bar dataKey="confirmation" stackId="a" name="Call Center" fill="hsl(210, 60%, 52%)" />
                <Bar dataKey="cod" stackId="a" name="COD Fees" fill="hsl(38, 90%, 55%)" />
                <Bar dataKey="sourcing" stackId="a" name="Sourcing" fill="hsl(155, 50%, 42%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(var(--primary))' }} /> Shipping</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(210, 60%, 52%)' }} /> Call Center</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(38, 90%, 55%)' }} /> COD Fees</div>
              <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm" style={{ background: 'hsl(155, 50%, 42%)' }} /> Sourcing</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// === Detail Components ===

function StatusBadge({ isPaid }: { isPaid: boolean }) {
  return (
    <Badge variant="outline" className={cn(
      "text-[10px] px-1.5 py-0 font-medium",
      isPaid ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"
    )}>
      {isPaid ? "Paid" : "Pending"}
    </Badge>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="relative mb-4">
        <div className="absolute inset-0 bg-primary/5 rounded-full scale-150 animate-pulse" />
        <div className="relative p-4 bg-muted/50 rounded-xl border">
          <BarChart3 className="w-6 h-6 text-muted-foreground/50" />
        </div>
      </div>
      <p className="text-sm font-medium text-muted-foreground">No Data Available Yet</p>
      <p className="text-xs text-muted-foreground/70 mt-1">Once your activity starts generating insights,<br />you'll see them visualized here.</p>
    </div>
  );
}

function ShippingDetails({ details }: { details: { sellerId: string; sellerName: string; shipped: number; revenue: number; paid: number; pending: number }[] }) {
  if (details.length === 0) return <EmptyState />;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b bg-muted/20">
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Seller</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Shipped</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Revenue</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Paid</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Pending</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {details.map((d) => (
          <tr key={d.sellerId} className="hover:bg-muted/20 transition-colors">
            <td className="px-5 py-2.5 text-xs font-medium">{d.sellerName}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">{d.shipped}</td>
            <td className="px-5 py-2.5 text-xs text-right font-semibold tabular-nums">{formatUSD(d.revenue)}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-success">{formatUSD(d.paid)}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-warning">{d.pending > 0 ? formatUSD(d.pending) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CallCenterDetails({ details }: { details: { sellerId: string; sellerName: string; confirmed: number; dropped: number; upsell: number; confirmedRev: number; droppedRev: number; paid: number; pending: number; totalRev: number }[] }) {
  if (details.length === 0) return <EmptyState />;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b bg-muted/20">
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Seller</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Confirmed</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Dropped</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Upsell</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Revenue</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Paid</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Pending</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {details.map((d) => (
          <tr key={d.sellerId} className="hover:bg-muted/20 transition-colors">
            <td className="px-5 py-2.5 text-xs font-medium">{d.sellerName}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">
              <span className="text-success">{d.confirmed}</span>
            </td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-destructive">{d.dropped}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-info">{d.upsell}</td>
            <td className="px-5 py-2.5 text-xs text-right font-semibold tabular-nums">{formatUSD(d.totalRev)}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-success">{formatUSD(d.paid)}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums text-warning">{d.pending > 0 ? formatUSD(d.pending) : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CodDetails({ details }: { details: { invoiceNum: string; sellerId: string; sellerName: string; codFees: number; isPaid: boolean; orderCount: number }[] }) {
  if (details.length === 0) return <EmptyState />;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b bg-muted/20">
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Invoice</th>
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Seller</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Orders</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">COD Fees</th>
          <th className="text-center text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {details.map((d, i) => (
          <tr key={i} className="hover:bg-muted/20 transition-colors">
            <td className="px-5 py-2.5 text-xs font-mono font-medium">{d.invoiceNum}</td>
            <td className="px-5 py-2.5 text-xs">{d.sellerName}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">{d.orderCount}</td>
            <td className="px-5 py-2.5 text-xs text-right font-semibold tabular-nums">{formatUSD(d.codFees)}</td>
            <td className="px-5 py-2.5 text-center"><StatusBadge isPaid={d.isPaid} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourcingDetails({ details }: { details: { id: string; displayId: string; product: string; quantity: number; sellerPrice: number; totalCost: number; profit: number; isPaid: boolean }[] }) {
  if (details.length === 0) return <EmptyState />;
  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-card z-10">
        <tr className="border-b bg-muted/20">
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">ID</th>
          <th className="text-left text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Product</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Qty</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Seller Price</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Our Cost</th>
          <th className="text-right text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Profit</th>
          <th className="text-center text-[11px] font-semibold text-muted-foreground uppercase px-5 py-2.5">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {details.map((d) => (
          <tr key={d.id} className="hover:bg-muted/20 transition-colors">
            <td className="px-5 py-2.5 text-xs font-mono font-medium">{d.displayId}</td>
            <td className="px-5 py-2.5 text-xs truncate max-w-[200px]">{d.product}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">{d.quantity}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">{formatUSD(d.sellerPrice * d.quantity)}</td>
            <td className="px-5 py-2.5 text-xs text-right tabular-nums">{formatUSD(d.totalCost)}</td>
            <td className="px-5 py-2.5 text-xs text-right font-medium tabular-nums text-success">{formatUSD(d.profit)}</td>
            <td className="px-5 py-2.5 text-center"><StatusBadge isPaid={d.isPaid} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
