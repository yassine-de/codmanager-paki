import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeDollarSign,
  Banknote,
  CalendarDays,
  CreditCard,
  DollarSign,
  Loader2,
  Phone,
  ReceiptText,
  Search,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { DateRange } from "react-day-picker";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { formatUSD } from "@/lib/currency";
import { fetchInvoiceSummary, type InvoiceSummaryResponse } from "@/lib/invoice-summary";
import { cn } from "@/lib/utils";

interface DbInvoice {
  id: string;
  seller_id: string;
  invoice_number: string | null;
  status: string;
  created_at: string;
}

interface SellerProfile {
  user_id: string;
  name: string | null;
  email?: string | null;
}

interface SourcingRequest {
  id: string;
  seller_id: string;
  product_name: string | null;
  quantity: number | null;
  landed_price: number | null;
  seller_price: number | null;
  seller_validated: boolean | null;
  created_at: string;
}

interface FinanceRow {
  invoiceId: string;
  invoiceNumber: string;
  sellerId: string;
  sellerName: string;
  sellerEmail: string;
  status: string;
  createdAt: string;
  deliveredCount: number;
  totalOrders: number;
  revenue: number;
  shipping: number;
  callCenter: number;
  cod: number;
  otherImpact: number;
  feeRevenue: number;
  netPayable: number;
  paid: number;
  nextPayout: number;
  isAnwar: boolean;
}

interface FinanceTotals {
  invoices: number;
  sellers: number;
  delivered: number;
  totalOrders: number;
  revenue: number;
  sourcingProfit: number;
  shipping: number;
  callCenter: number;
  cod: number;
  otherImpact: number;
  feeRevenue: number;
  netPayable: number;
  paid: number;
  nextPayout: number;
}

const CUSTOMER_SHIPPING_CHARGE_USD = 3;
const ANWAR_SHIPPING_COST_USD = 0.7;

const zeroTotals: FinanceTotals = {
  invoices: 0,
  sellers: 0,
  delivered: 0,
  totalOrders: 0,
  revenue: 0,
  sourcingProfit: 0,
  shipping: 0,
  callCenter: 0,
  cod: 0,
  otherImpact: 0,
  feeRevenue: 0,
  netPayable: 0,
  paid: 0,
  nextPayout: 0,
};

const isPaidStatus = (status: string) => status === "paid";

function isAnwarSeller(profile?: SellerProfile | null) {
  const haystack = `${profile?.name ?? ""} ${profile?.email ?? ""}`.toLowerCase();
  return haystack.includes("anwar");
}

function sumRows(rows: FinanceRow[]): FinanceTotals {
  const sellers = new Set(rows.map((row) => row.sellerId));
  return rows.reduce<FinanceTotals>(
    (acc, row) => ({
      invoices: acc.invoices + 1,
      sellers: sellers.size,
      delivered: acc.delivered + row.deliveredCount,
      totalOrders: acc.totalOrders + row.totalOrders,
      revenue: acc.revenue + row.revenue,
      sourcingProfit: acc.sourcingProfit,
      shipping: acc.shipping + row.shipping,
      callCenter: acc.callCenter + row.callCenter,
      cod: acc.cod + row.cod,
      otherImpact: acc.otherImpact + row.otherImpact,
      feeRevenue: acc.feeRevenue + row.feeRevenue,
      netPayable: acc.netPayable + row.netPayable,
      paid: acc.paid + row.paid,
      nextPayout: acc.nextPayout + row.nextPayout,
    }),
    { ...zeroTotals }
  );
}

function withSourcingProfit(totals: FinanceTotals, sourcingProfit: number): FinanceTotals {
  return { ...totals, sourcingProfit };
}

function calculateSourcingProfit(requests: SourcingRequest[]) {
  return requests.reduce((sum, request) => {
    const qty = Number(request.quantity ?? 0);
    const sellerPrice = Number(request.seller_price ?? 0);
    const landedPrice = Number(request.landed_price ?? 0);
    return sum + (sellerPrice - landedPrice) * qty;
  }, 0);
}

function makeFinanceRow(invoice: DbInvoice, summary: InvoiceSummaryResponse, profile?: SellerProfile): FinanceRow {
  const anwar = isAnwarSeller(profile);
  const totals = summary.totals;
  const otherImpact = -(Number(totals.addon_net ?? 0) + Number(totals.adjustment_net ?? 0));
  const chargedFees = Number(totals.shipping_fees ?? 0) + Number(totals.call_center_fees ?? 0) + Number(totals.cod_fees ?? 0) + otherImpact;
  const netPayable = Number(totals.net_payable ?? 0);
  const paid = isPaidStatus(invoice.status) ? netPayable : 0;

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoice_number || "Open Invoice",
    sellerId: invoice.seller_id,
    sellerName: profile?.name || invoice.seller_id.slice(0, 8),
    sellerEmail: profile?.email || "",
    status: invoice.status,
    createdAt: invoice.created_at,
    deliveredCount: Number(summary.counts.delivered_count ?? 0),
    totalOrders: Number(summary.counts.total_orders_count ?? 0),
    revenue: Number(totals.delivered_revenue_usd ?? 0),
    shipping: anwar ? 0 : Number(totals.shipping_fees ?? 0),
    callCenter: anwar ? 0 : Number(totals.call_center_fees ?? 0),
    cod: anwar ? 0 : Number(totals.cod_fees ?? 0),
    otherImpact: anwar ? 0 : otherImpact,
    feeRevenue: anwar ? 0 : Math.max(0, chargedFees),
    netPayable,
    paid,
    nextPayout: isPaidStatus(invoice.status) ? 0 : netPayable,
    isAnwar: anwar,
  };
}

export default function Finance2() {
  const [sellerFilter, setSellerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["finance2-invoices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, seller_id, invoice_number, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DbInvoice[];
    },
  });

  const { data: sourcingRequests = [] } = useQuery({
    queryKey: ["finance2-sourcing-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("id, seller_id, product_name, quantity, landed_price, seller_price, seller_validated, created_at")
        .eq("seller_validated", true);
      if (error) throw error;
      return data as SourcingRequest[];
    },
  });

  const sellerIds = useMemo(
    () => [...new Set([...invoices.map((invoice) => invoice.seller_id), ...sourcingRequests.map((request) => request.seller_id)])],
    [invoices, sourcingRequests]
  );

  const { data: profiles = [] } = useQuery({
    queryKey: ["finance2-seller-profiles", sellerIds],
    queryFn: async () => {
      if (sellerIds.length === 0) return [] as SellerProfile[];
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, name, email")
        .in("user_id", sellerIds);
      if (error) throw error;
      return data as SellerProfile[];
    },
    enabled: sellerIds.length > 0,
  });

  const profileMap = useMemo(() => {
    const map = new Map<string, SellerProfile>();
    profiles.forEach((profile) => map.set(profile.user_id, profile));
    return map;
  }, [profiles]);

  const invoiceIds = useMemo(() => invoices.map((invoice) => invoice.id), [invoices]);

  const { data: summaryMap = {}, isLoading: loadingSummaries } = useQuery({
    queryKey: ["finance2-invoice-summaries", invoiceIds],
    queryFn: async () => {
      if (invoiceIds.length === 0) return {} as Record<string, InvoiceSummaryResponse>;
      const entries = await Promise.all(
        invoiceIds.map(async (invoiceId) => [invoiceId, await fetchInvoiceSummary(invoiceId)] as const)
      );
      return Object.fromEntries(entries) as Record<string, InvoiceSummaryResponse>;
    },
    enabled: invoiceIds.length > 0,
  });

  const rows = useMemo(() => {
    return invoices
      .map((invoice) => {
        const summary = summaryMap[invoice.id];
        if (!summary) return null;
        return makeFinanceRow(invoice, summary, profileMap.get(invoice.seller_id));
      })
      .filter((row): row is FinanceRow => !!row);
  }, [invoices, summaryMap, profileMap]);

  const sellerOptions = useMemo(() => {
    return sellerIds
      .map((id) => {
        const profile = profileMap.get(id);
        return { value: id, label: profile?.name || id.slice(0, 8) };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [sellerIds, profileMap]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((row) => {
      if (sellerFilter !== "all" && row.sellerId !== sellerFilter) return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (groupFilter === "main" && row.isAnwar) return false;
      if (groupFilter === "anwar" && !row.isAnwar) return false;
      if (dateRange?.from && new Date(row.createdAt) < dateRange.from) return false;
      if (dateRange?.to && new Date(row.createdAt) > dateRange.to) return false;
      if (q && !`${row.invoiceNumber} ${row.sellerName} ${row.status}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, sellerFilter, statusFilter, groupFilter, dateRange, searchQuery]);

  const filteredSourcing = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sourcingRequests.filter((request) => {
      const profile = profileMap.get(request.seller_id);
      const anwar = isAnwarSeller(profile);
      const sellerName = profile?.name || "";
      if (sellerFilter !== "all" && request.seller_id !== sellerFilter) return false;
      if (groupFilter === "main" && anwar) return false;
      if (groupFilter === "anwar" && !anwar) return false;
      if (dateRange?.from && new Date(request.created_at) < dateRange.from) return false;
      if (dateRange?.to && new Date(request.created_at) > dateRange.to) return false;
      if (q && !`${request.product_name ?? ""} ${sellerName}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [sourcingRequests, profileMap, sellerFilter, groupFilter, dateRange, searchQuery]);

  const mainRows = filteredRows.filter((row) => !row.isAnwar);
  const anwarRows = filteredRows.filter((row) => row.isAnwar);
  const mainSourcingRequests = filteredSourcing.filter((request) => !isAnwarSeller(profileMap.get(request.seller_id)));
  const anwarSourcingRequests = filteredSourcing.filter((request) => isAnwarSeller(profileMap.get(request.seller_id)));
  const mainTotals = useMemo(() => withSourcingProfit(sumRows(mainRows), calculateSourcingProfit(mainSourcingRequests)), [mainRows, mainSourcingRequests]);
  const anwarTotals = useMemo(() => withSourcingProfit(sumRows(anwarRows), calculateSourcingProfit(anwarSourcingRequests)), [anwarRows, anwarSourcingRequests]);
  const combinedTotals = useMemo(() => sumRows(filteredRows), [filteredRows]);

  const sellerRows = useMemo(() => {
    const map = new Map<string, { sellerId: string; sellerName: string; isAnwar: boolean; rows: FinanceRow[] }>();
    filteredRows.forEach((row) => {
      if (!map.has(row.sellerId)) {
        map.set(row.sellerId, { sellerId: row.sellerId, sellerName: row.sellerName, isAnwar: row.isAnwar, rows: [] });
      }
      map.get(row.sellerId)!.rows.push(row);
    });
    return [...map.values()]
      .map((entry) => ({ ...entry, totals: sumRows(entry.rows) }))
      .sort((a, b) => b.totals.nextPayout - a.totals.nextPayout);
  }, [filteredRows]);

  const loading = loadingInvoices || loadingSummaries;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-500/10 text-emerald-600">
            <BadgeDollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Analytics</p>
            <h1 className="text-2xl font-bold tracking-tight">Finance2</h1>
            <p className="text-sm text-muted-foreground">Instant finance overview from invoice summaries.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-3">
          <HeaderMetric label="Next Payout" value={formatUSD(combinedTotals.nextPayout)} tone="warning" />
          <HeaderMetric label="Paid" value={formatUSD(combinedTotals.paid)} tone="success" />
          <HeaderMetric label="Invoices" value={String(combinedTotals.invoices)} />
        </div>
      </div>

      <div className="rounded-xl border border-dashed bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1">
            <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Search className="h-3 w-3" /> Search
            </Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Invoice, seller, status..."
                className="h-9 pl-8 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <CalendarDays className="h-3 w-3" /> Date Range
            </Label>
            <DatePresetFilter
              dateRange={dateRange}
              onDateRangeChange={setDateRange}
              preset={datePreset}
              onPresetChange={setDatePreset}
            />
          </div>
          <FilterBlock label="Seller">
            <SearchableSelect value={sellerFilter} onValueChange={setSellerFilter} options={sellerOptions} allLabel="All Sellers" className="w-[190px]" />
          </FilterBlock>
          <FilterBlock label="Group">
            <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-xs">
              <option value="all">All</option>
              <option value="main">Main Sellers</option>
              <option value="anwar">Anwar</option>
            </select>
          </FilterBlock>
          <FilterBlock label="Status">
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-xs">
              <option value="all">All</option>
              <option value="open">Open</option>
              <option value="ready">Ready</option>
              <option value="paid">Paid</option>
            </select>
          </FilterBlock>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={() => {
              setSellerFilter("all");
              setStatusFilter("all");
              setGroupFilter("all");
              setSearchQuery("");
              setDatePreset("maximum");
              setDateRange(undefined);
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      <FinanceOverviewGrid title="All Sellers Without Anwar" totals={mainTotals} />
      <FinanceOverviewGrid title="Anwar" totals={anwarTotals} anwar />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.55fr)]">
        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">Seller Breakdown</h2>
              <p className="text-[11px] text-muted-foreground">{sellerRows.length} sellers in current filter</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs">
              <thead className="bg-muted/30 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Seller</th>
                  <th className="px-4 py-3 text-right">Revenue</th>
                  <th className="px-4 py-3 text-right">Shipping Fee Rev.</th>
                  <th className="px-4 py-3 text-right">Call Center</th>
                  <th className="px-4 py-3 text-right">COD</th>
                  <th className="px-4 py-3 text-right">Fee Revenue</th>
                  <th className="px-4 py-3 text-right">Next Payout</th>
                  <th className="px-4 py-3 text-right">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sellerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">No finance data for this filter.</td>
                  </tr>
                ) : (
                  sellerRows.map((seller) => (
                    <tr key={seller.sellerId} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="grid h-7 w-7 place-items-center rounded-lg bg-muted text-muted-foreground">
                            <Store className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <p className="font-semibold">{seller.sellerName}</p>
                            {seller.isAnwar && <Badge variant="outline" className="mt-1 border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-600">Anwar · no fees</Badge>}
                          </div>
                        </div>
                      </td>
                      <AmountCell value={seller.totals.revenue} />
                      <AmountCell value={seller.totals.shipping} negative />
                      <AmountCell value={seller.totals.callCenter} negative />
                      <AmountCell value={seller.totals.cod} negative />
                      <AmountCell value={seller.totals.feeRevenue} strong />
                      <AmountCell value={seller.totals.nextPayout} strong tone={seller.totals.nextPayout >= 0 ? "success" : "danger"} />
                      <AmountCell value={seller.totals.paid} tone="success" />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">Recent Open Payouts</h2>
            <p className="text-[11px] text-muted-foreground">Invoices that still affect next payout.</p>
          </div>
          <div className="divide-y">
            {filteredRows.filter((row) => row.nextPayout !== 0).slice(0, 10).map((row) => (
              <div key={row.invoiceId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{row.invoiceNumber}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{row.sellerName} · {row.status}</p>
                </div>
                <p className={cn("shrink-0 text-sm font-bold tabular-nums", row.nextPayout >= 0 ? "text-emerald-600" : "text-red-600")}>
                  {formatUSD(row.nextPayout)}
                </p>
              </div>
            ))}
            {filteredRows.filter((row) => row.nextPayout !== 0).length === 0 && (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">No open payouts.</div>
            )}
          </div>
        </section>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Next Payout includes every non-paid invoice, including open invoices. Anwar is shown separately and no fees are counted for Anwar.
      </p>
    </div>
  );
}

function FinanceOverviewGrid({ title, totals, anwar = false }: { title: string; totals: FinanceTotals; anwar?: boolean }) {
  const shippingRate = anwar ? ANWAR_SHIPPING_COST_USD : CUSTOMER_SHIPPING_CHARGE_USD;
  const shippingCost = totals.totalOrders * shippingRate;
  const feeRevenue = anwar ? 0 : totals.feeRevenue;
  const operatingCosts = shippingCost + (anwar ? 0 : totals.callCenter + totals.cod + Math.max(0, totals.otherImpact));
  const netProfit = feeRevenue + totals.sourcingProfit - operatingCosts;
  const grossRevenue = totals.revenue + totals.sourcingProfit;

  return (
    <section className="space-y-3">
      <SectionTitle title={title} badge={anwar ? "No fees charged" : undefined} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        <MetricCard
          title="Net Profit"
          value={formatUSD(netProfit)}
          helper={anwar ? "Sourcing profit minus Anwar shipping cost" : "Fee revenue + sourcing profit minus operating costs"}
          icon={BadgeDollarSign}
          tone="green"
          large
        />
        <MetricCard
          title="Gross Revenue"
          value={formatUSD(grossRevenue)}
          helper="Delivered revenue + sourcing profit"
          icon={DollarSign}
          tone="rose"
          large
        />
        <MetricCard
          title="Next Payout"
          value={formatUSD(totals.nextPayout)}
          helper="All non-paid invoices, including open invoices"
          icon={Wallet}
          tone="amber"
          large
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <MetricCard
          title="Call Center Cost"
          value={formatUSD(anwar ? 0 : totals.callCenter)}
          helper={anwar ? "No call center fee for Anwar" : "Confirmed + dropped lead fees"}
          icon={Phone}
          tone="rose"
        />
        <MetricCard
          title="COD Fee Revenue"
          value={formatUSD(anwar ? 0 : totals.cod)}
          helper={anwar ? "No COD fee for Anwar" : "COD fees charged to sellers"}
          icon={CreditCard}
          tone="rose"
        />
        <MetricCard
          title="Shipping Cost"
          value={formatUSD(shippingCost)}
          helper={`${totals.totalOrders} invoiced orders x ${formatUSD(shippingRate)}`}
          icon={Truck}
          tone="rose"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <MetricCard
          title="Sourcing Profit"
          value={formatUSD(totals.sourcingProfit)}
          helper="Seller price minus landed price"
          icon={ReceiptText}
          tone="green"
        />
        <MetricCard
          title="Paid"
          value={formatUSD(totals.paid)}
          helper="Already paid invoices"
          icon={Banknote}
          tone="green"
        />
      </div>
    </section>
  );
}

function SectionTitle({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-6 w-6 place-items-center rounded-full bg-rose-500/10 text-rose-600">
        <DollarSign className="h-3.5 w-3.5" />
      </span>
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">{title}</h2>
      {badge && <Badge variant="outline" className="text-[10px]">{badge}</Badge>}
    </div>
  );
}

function HeaderMetric({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-base font-bold tabular-nums", tone === "success" && "text-emerald-600", tone === "warning" && "text-amber-600")}>{value}</p>
    </div>
  );
}

function FilterBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function MetricCard({
  title,
  value,
  helper,
  icon: Icon,
  tone,
  large = false,
}: {
  title: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: "green" | "rose" | "amber" | "blue" | "muted";
  large?: boolean;
}) {
  const toneClass = {
    green: "bg-emerald-500/10 text-emerald-600",
    rose: "bg-rose-500/10 text-rose-600",
    amber: "bg-amber-500/10 text-amber-600",
    blue: "bg-sky-500/10 text-sky-600",
    muted: "bg-muted text-muted-foreground",
  }[tone];

  return (
    <div className={cn("rounded-xl border bg-card p-4 shadow-sm", large && "p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
          <p className={cn("mt-3 font-bold tabular-nums tracking-tight", large ? "text-3xl" : "text-xl")}>{value}</p>
          <p className="mt-2 text-[11px] text-muted-foreground">{helper}</p>
        </div>
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-2xl", toneClass)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
}

function AmountCell({
  value,
  negative = false,
  strong = false,
  tone,
}: {
  value: number;
  negative?: boolean;
  strong?: boolean;
  tone?: "success" | "danger";
}) {
  const displayValue = negative && value > 0 ? -value : value;
  return (
    <td
      className={cn(
        "px-4 py-3 text-right tabular-nums",
        strong && "font-bold",
        tone === "success" && "text-emerald-600",
        tone === "danger" && "text-red-600",
        negative && value > 0 && "text-red-600"
      )}
    >
      {formatUSD(displayValue)}
    </td>
  );
}
