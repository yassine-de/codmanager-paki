import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Search, RotateCcw, Eye, CalendarDays, Store, CreditCard, CheckCircle2, PlusCircle,
  Wallet, Clock, ArrowDownCircle, ArrowUpCircle,
  Loader2, ChevronLeft, ChevronRight, Package
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import type { DateRange } from "react-day-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { InvoiceDetailModal } from "@/components/InvoiceDetailModal";
import { toast } from "sonner";

interface DbInvoice {
  id: string;
  seller_id: string;
  invoice_number: string;
  status: string;
  created_at: string;
  finalized_at: string | null;
  paid_at: string | null;
  paid_by: string | null;
  payment_proof_url: string | null;
}

interface DbAddon {
  id: string;
  invoice_id: string;
  type: string;
  amount: number;
  reason: string;
  created_at: string;
}

function calculateFeeFromWeight(weightText: string | null, rates: { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus?: number } | null): number {
  if (!rates || !weightText) return 0;
  if (weightText === "up_to_1kg") return rates.rate_1kg;
  if (weightText === "up_to_2kg") return rates.rate_2kg;
  if (weightText === "up_to_3kg") return rates.rate_3kg;
  if (weightText === "more_than_3kg") return rates.rate_3kg_plus ?? 6;
  return 0;
}

export default function Invoices() {
  const { t } = useLanguage();
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const isSeller = authUser?.role === "seller";

  const [searchQuery, setSearchQuery] = useState("");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Detail modal
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);
  const [detailInvoiceNumber, setDetailInvoiceNumber] = useState("");
  const [detailSellerName, setDetailSellerName] = useState("");
  const [detailSellerRates, setDetailSellerRates] = useState<any>(null);
  const [detailIsDraft, setDetailIsDraft] = useState(false);
  const [detailSellerId, setDetailSellerId] = useState<string>("");
  const [detailDraftOrders, setDetailDraftOrders] = useState<any[]>([]);

  // Addon dialog
  const [addonInvoiceId, setAddonInvoiceId] = useState<string | null>(null);
  const [addonType, setAddonType] = useState<"in" | "out">("in");
  const [addonAmount, setAddonAmount] = useState("");
  const [addonReason, setAddonReason] = useState("");

  // Fetch invoices
  const { data: invoices = [], isLoading: loadingInvoices } = useQuery({
    queryKey: ["invoices"],
    queryFn: async () => {
      const query = supabase.from("invoices").select("*").order("created_at", { ascending: false });
      const { data, error } = await query;
      if (error) throw error;
      return data as DbInvoice[];
    },
  });

  // Fetch addons for all invoices
  const invoiceIds = useMemo(() => invoices.map(i => i.id), [invoices]);
  const { data: allAddons = [] } = useQuery({
    queryKey: ["invoice-addons", invoiceIds],
    queryFn: async () => {
      if (invoiceIds.length === 0) return [];
      const { data, error } = await supabase.from("invoice_addons").select("*").in("invoice_id", invoiceIds);
      if (error) throw error;
      return data as DbAddon[];
    },
    enabled: invoiceIds.length > 0,
  });

  // Group addons by invoice
  const addonsByInvoice = useMemo(() => {
    const map: Record<string, DbAddon[]> = {};
    allAddons.forEach(a => {
      if (!map[a.invoice_id]) map[a.invoice_id] = [];
      map[a.invoice_id].push(a);
    });
    return map;
  }, [allAddons]);

  // Fetch orders with invoice_id to compute totals
  const { data: invoiceOrders = [] } = useQuery({
    queryKey: ["invoice-orders-summary", invoiceIds],
    queryFn: async () => {
      if (invoiceIds.length === 0) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, invoice_id, price, quantity, product_name, seller_id")
        .in("invoice_id", invoiceIds);
      if (error) throw error;
      return data;
    },
    enabled: invoiceIds.length > 0,
  });

  // Fetch unassigned delivered orders (drafts) - admin only
  const { data: unassignedOrders = [], isLoading: loadingDrafts } = useQuery({
    queryKey: ["unassigned-delivered-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("delivery_status", "delivered")
        .is("invoice_id", null)
        .order("delivered_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !isSeller,
  });

  // Fetch all seller profiles
  const allSellerIds = useMemo(() => {
    const ids = new Set<string>();
    invoices.forEach(i => ids.add(i.seller_id));
    unassignedOrders.forEach(o => ids.add(o.seller_id));
    return [...ids];
  }, [invoices, unassignedOrders]);

  const { data: sellerProfiles = [] } = useQuery({
    queryKey: ["seller-profiles-invoices", allSellerIds],
    queryFn: async () => {
      if (allSellerIds.length === 0) return [];
      const { data, error } = await supabase.from("profiles").select("user_id, name").in("user_id", allSellerIds);
      if (error) throw error;
      return data;
    },
    enabled: allSellerIds.length > 0,
  });

  const sellerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    sellerProfiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [sellerProfiles]);

  // Fetch seller rates
  const { data: sellerRatesData = [] } = useQuery({
    queryKey: ["seller-rates-invoices", allSellerIds],
    queryFn: async () => {
      if (allSellerIds.length === 0) return [];
      const { data, error } = await supabase.from("seller_rates").select("*").in("user_id", allSellerIds);
      if (error) throw error;
      return data;
    },
    enabled: allSellerIds.length > 0,
  });

  const sellerRatesMap = useMemo(() => {
    const map: Record<string, { rate_1kg: number; rate_2kg: number; rate_3kg: number; rate_3kg_plus: number }> = {};
    sellerRatesData.forEach(r => { map[r.user_id] = { rate_1kg: r.rate_1kg, rate_2kg: r.rate_2kg, rate_3kg: r.rate_3kg, rate_3kg_plus: (r as any).rate_3kg_plus ?? 6 }; });
    return map;
  }, [sellerRatesData]);

  // Fetch products to get weight info
  const { data: allProducts = [] } = useQuery({
    queryKey: ["products-for-invoices", allSellerIds],
    queryFn: async () => {
      if (allSellerIds.length === 0) return [];
      const { data, error } = await supabase
        .from("products")
        .select("name, seller_id, weight")
        .in("seller_id", allSellerIds);
      if (error) throw error;
      return data as { name: string; seller_id: string; weight: string | null }[];
    },
    enabled: allSellerIds.length > 0,
  });

  // Map: "sellerId|productName" -> weight text
  const productWeightMap = useMemo(() => {
    const map: Record<string, string | null> = {};
    allProducts.forEach(p => {
      map[`${p.seller_id}|${p.name}`] = p.weight;
    });
    return map;
  }, [allProducts]);

  const getProductWeight = (sellerId: string, productName: string): string | null => {
    return productWeightMap[`${sellerId}|${productName}`] || null;
  };

  // Compute draft invoices (grouped unassigned orders by seller)
  const draftInvoices = useMemo(() => {
    const grouped: Record<string, typeof unassignedOrders> = {};
    unassignedOrders.forEach(order => {
      if (!grouped[order.seller_id]) grouped[order.seller_id] = [];
      grouped[order.seller_id].push(order);
    });
    return Object.entries(grouped).map(([sellerId, orders]) => {
      const rates = sellerRatesMap[sellerId] || null;
      const totalAmount = orders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
      const totalFees = orders.reduce((sum, o) => sum + calculateFeeFromWeight(getProductWeight(sellerId, o.product_name), rates), 0);
      return {
        id: `draft-${sellerId}`,
        sellerId,
        orders,
        ordersCount: orders.length,
        totalAmount,
        totalFees,
        netPayable: totalAmount - totalFees,
      };
    });
  }, [unassignedOrders, sellerRatesMap, productWeightMap]);

  // Compute invoice summaries
  const invoiceSummaries = useMemo(() => {
    const ordersBySeller: Record<string, typeof invoiceOrders> = {};
    invoiceOrders.forEach(o => {
      const key = o.invoice_id!;
      if (!ordersBySeller[key]) ordersBySeller[key] = [];
      ordersBySeller[key].push(o);
    });

    return invoices.map(inv => {
      const orders = ordersBySeller[inv.id] || [];
      const rates = sellerRatesMap[inv.seller_id] || null;
      const totalAmount = orders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
      const totalFees = orders.reduce((sum, o) => sum + calculateFeeFromWeight(getProductWeight(inv.seller_id, o.product_name), rates), 0);
      const addons = addonsByInvoice[inv.id] || [];
      const addonNet = addons.reduce((sum, a) => a.type === "out" ? sum - a.amount : sum + a.amount, 0);
      return {
        ...inv,
        ordersCount: orders.length,
        totalAmount,
        totalFees,
        addonNet,
        netPayable: totalAmount - totalFees + addonNet,
        sellerName: sellerNameMap[inv.seller_id] || inv.seller_id.slice(0, 8),
      };
    });
  }, [invoices, invoiceOrders, sellerRatesMap, addonsByInvoice, sellerNameMap, productWeightMap]);

  // Combined list: drafts first, then invoices
  type CombinedRow = { type: "draft"; data: typeof draftInvoices[0] } | { type: "invoice"; data: typeof invoiceSummaries[0] };

  const combined = useMemo(() => {
    const rows: CombinedRow[] = [];
    if (!isSeller) {
      draftInvoices.forEach(d => rows.push({ type: "draft", data: d }));
    }
    invoiceSummaries
      .filter(inv => isSeller ? inv.status !== "draft" : true)
      .forEach(inv => rows.push({ type: "invoice", data: inv }));
    return rows;
  }, [draftInvoices, invoiceSummaries, isSeller]);

  // Filters
  const filtered = useMemo(() => {
    return combined.filter(row => {
      const sellerId = row.type === "draft" ? row.data.sellerId : row.data.seller_id;
      const sellerName = sellerNameMap[sellerId] || "";
      if (sellerFilter !== "all" && sellerId !== sellerFilter) return false;
      if (statusFilter !== "all") {
        if (statusFilter === "draft" && row.type !== "draft") return false;
        if (statusFilter !== "draft" && (row.type === "draft" || row.data.status !== statusFilter)) return false;
      }
      if (dateRange?.from) {
        const date = new Date(row.type === "draft" ? Date.now() : row.data.created_at);
        if (date < dateRange.from) return false;
        if (dateRange.to && date > dateRange.to) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (row.type === "draft") {
          if (!sellerName.toLowerCase().includes(q) && !"draft".includes(q)) return false;
        } else {
          if (!row.data.invoice_number.toLowerCase().includes(q) && !sellerName.toLowerCase().includes(q)) return false;
        }
      }
      return true;
    });
  }, [combined, sellerFilter, statusFilter, dateRange, searchQuery, sellerNameMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Stats
  const totalAmount = filtered.reduce((s, r) => s + (r.type === "draft" ? r.data.netPayable : r.data.netPayable), 0);
  const paidAmount = filtered.filter(r => r.type === "invoice" && r.data.status === "paid").reduce((s, r) => s + (r as any).data.netPayable, 0);
  const needToPay = filtered.filter(r => r.type === "invoice" && r.data.status === "ready").reduce((s, r) => s + (r as any).data.netPayable, 0);

  const sellerOptions = useMemo(() => {
    return allSellerIds.map(id => ({
      value: id,
      label: sellerNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allSellerIds, sellerNameMap]);

  // Finalize draft mutation
  const finalizeMutation = useMutation({
    mutationFn: async (draft: typeof draftInvoices[0]) => {
      const { data: invoice, error: invError } = await supabase
        .from("invoices")
        .insert({ seller_id: draft.sellerId, status: "ready", finalized_at: new Date().toISOString() } as any)
        .select()
        .single();
      if (invError) throw invError;
      const orderIds = draft.orders.map(o => o.id);
      const { error: updateError } = await supabase
        .from("orders")
        .update({ invoice_id: invoice.id } as any)
        .in("id", orderIds);
      if (updateError) throw updateError;
      return invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-delivered-orders"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-orders-summary"] });
      toast.success("Invoice finalized and sent to seller");
    },
    onError: () => toast.error("Failed to finalize invoice"),
  });

  // Toggle paid
  const togglePaidMutation = useMutation({
    mutationFn: async ({ invoiceId, currentStatus }: { invoiceId: string; currentStatus: string }) => {
      const isPaid = currentStatus === "paid";
      const { error } = await supabase
        .from("invoices")
        .update({
          status: isPaid ? "ready" : "paid",
          paid_at: isPaid ? null : new Date().toISOString(),
          paid_by: isPaid ? null : "CIH",
        } as any)
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Payment status updated");
    },
  });

  // Toggle ready (un-ready a ready invoice)
  const toggleReadyMutation = useMutation({
    mutationFn: async ({ invoiceId, currentStatus }: { invoiceId: string; currentStatus: string }) => {
      if (currentStatus === "ready") {
        // Un-ready: remove orders from invoice, delete invoice
        const { error: orderErr } = await supabase
          .from("orders")
          .update({ invoice_id: null } as any)
          .eq("invoice_id", invoiceId);
        if (orderErr) throw orderErr;
        const { error: delErr } = await supabase.from("invoices").delete().eq("id", invoiceId);
        if (delErr) throw delErr;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["unassigned-delivered-orders"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-orders-summary"] });
      toast.success("Invoice reverted to draft");
    },
  });

  // Add addon
  const addAddonMutation = useMutation({
    mutationFn: async ({ invoiceId, type, amount, reason }: { invoiceId: string; type: string; amount: number; reason: string }) => {
      const { error } = await supabase.from("invoice_addons").insert({ invoice_id: invoiceId, type, amount, reason } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-addons"] });
      setAddonInvoiceId(null);
      setAddonAmount("");
      setAddonReason("");
      toast.success("Addon added");
    },
  });

  // Upload proof
  const uploadProofMutation = useMutation({
    mutationFn: async ({ invoiceId, file }: { invoiceId: string; file: File }) => {
      const filePath = `proofs/${invoiceId}-${Date.now()}.${file.name.split('.').pop()}`;
      const { error: upErr } = await supabase.storage.from("sourcing-images").upload(filePath, file);
      if (upErr) throw upErr;
      const { data: urlData } = supabase.storage.from("sourcing-images").getPublicUrl(filePath);
      const { error } = await supabase
        .from("invoices")
        .update({ payment_proof_url: urlData.publicUrl } as any)
        .eq("id", invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Proof uploaded");
    },
  });

  const openDetail = (row: CombinedRow) => {
    const sellerId = row.type === "draft" ? row.data.sellerId : row.data.seller_id;
    setDetailSellerName(sellerNameMap[sellerId] || "—");
    setDetailSellerRates(sellerRatesMap[sellerId] || null);
    setDetailSellerId(sellerId);
    if (row.type === "draft") {
      setDetailInvoiceId(null);
      setDetailInvoiceNumber("Draft Invoice");
      setDetailIsDraft(true);
      setDetailDraftOrders(row.data.orders);
    } else {
      setDetailInvoiceId(row.data.id);
      setDetailInvoiceNumber(row.data.invoice_number);
      setDetailIsDraft(false);
      setDetailDraftOrders([]);
    }
  };

  const handleReset = () => {
    setSellerFilter("all"); setStatusFilter("all"); setSearchQuery("");
    setDatePreset("maximum"); setDateRange(undefined); setCurrentPage(1);
  };

  if (loadingInvoices || loadingDrafts) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{isSeller ? "My Invoices" : t("invoices")}</h1>
            <p className="text-xs text-muted-foreground">{isSeller ? "View your invoices and payment status" : t("manage_invoices")}</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-end gap-1">
              <CheckCircle2 className="h-3 w-3 text-success" /> {t("paid")}
            </p>
            <p className="text-base font-bold text-success">{paidAmount.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">MAD</span></p>
          </div>
          {!isSeller && (
            <>
              <div className="h-8 w-px bg-border" />
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3 text-warning" /> {t("need_to_pay")}
                </p>
                <p className="text-base font-bold text-warning">{needToPay.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">MAD</span></p>
              </div>
            </>
          )}
          <div className="h-8 w-px bg-border" />
          <Badge variant="secondary" className="text-xs gap-1.5 py-1">
            <span className="font-bold">{filtered.length}</span> {t("invoices").toLowerCase()}
          </Badge>
        </div>
      </div>

      {/* Filters */}
      <Card className="border-dashed">
        <CardContent className="p-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 min-w-[180px] flex-1 max-w-[260px]">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <Search className="h-3 w-3" /> {t("search")}
              </Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setCurrentPage(1); }} placeholder="INV-..., seller..." className="h-9 pl-8 text-xs" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {t("date_range")}
              </Label>
              <DatePresetFilter dateRange={dateRange} onDateRangeChange={r => { setDateRange(r); setCurrentPage(1); }} preset={datePreset} onPresetChange={setDatePreset} />
            </div>
            {!isSeller && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Store className="h-3 w-3" /> {t("seller")}
                </Label>
                <SearchableSelect value={sellerFilter} onValueChange={v => { setSellerFilter(v); setCurrentPage(1); }} options={sellerOptions} placeholder={t("seller")} allLabel={`🏪 ${t("all")}`} className="w-[155px]" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <CreditCard className="h-3 w-3" /> Status
              </Label>
              <SearchableSelect
                value={statusFilter}
                onValueChange={v => { setStatusFilter(v); setCurrentPage(1); }}
                options={[
                  ...(isSeller ? [] : [{ value: "draft", label: "📝 Draft" }]),
                  { value: "ready", label: "✅ Ready" },
                  { value: "paid", label: "💰 Paid" },
                ]}
                placeholder="Status"
                allLabel="📦 All"
                className="w-[140px]"
              />
            </div>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" onClick={handleReset} className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> {t("reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-muted/30">
                <TableHead className="text-[11px] font-semibold">Invoice #</TableHead>
                <TableHead className="text-[11px] font-semibold">Date</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold">Seller</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">Orders</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">Amount</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">Fees</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">Net Payable</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">Ready</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">Status</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">Payment</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSeller ? 8 : 11} className="text-center text-xs text-muted-foreground py-16">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="font-medium">{t("no_invoices")}</p>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((row) => {
                  if (row.type === "draft") {
                    const d = row.data;
                    return (
                      <TableRow key={d.id} className="text-xs bg-warning/5 hover:bg-warning/10">
                        <TableCell className="font-semibold text-warning">Draft</TableCell>
                        <TableCell className="text-muted-foreground">—</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className="h-5 w-5 rounded-md bg-accent flex items-center justify-center shrink-0">
                              <Store className="h-3 w-3 text-muted-foreground" />
                            </div>
                            <span className="font-medium">{sellerNameMap[d.sellerId] || "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className="inline-flex items-center justify-center h-6 min-w-[28px] px-1.5 rounded-md bg-accent text-[11px] font-semibold">{d.ordersCount}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{d.totalAmount.toLocaleString()} <span className="text-muted-foreground text-[10px]">MAD</span></TableCell>
                        <TableCell className="text-right tabular-nums text-destructive">-{d.totalFees.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums font-bold text-success">{d.netPayable.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">MAD</span></TableCell>
                        <TableCell className="text-center">
                          <Button
                            variant="outline" size="sm"
                            className="h-7 text-[10px] gap-1 border-success/30 text-success hover:bg-success/10"
                            onClick={() => finalizeMutation.mutate(d)}
                            disabled={finalizeMutation.isPending}
                          >
                            <CheckCircle2 className="h-3 w-3" /> Ready
                          </Button>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-[10px] border-warning/30 text-warning bg-warning/10">Draft</Badge>
                        </TableCell>
                        <TableCell className="text-center text-muted-foreground/40">—</TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:bg-info/10" onClick={() => openDetail(row)}>
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-[10px]">View Orders</TooltipContent>
                            </Tooltip>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  }

                  // Finalized invoice
                  const inv = row.data;
                  const proofUrl = inv.payment_proof_url;
                  return (
                    <TableRow key={inv.id} className="text-xs">
                      <TableCell className="font-semibold text-primary">{inv.invoice_number}</TableCell>
                      <TableCell className="text-muted-foreground text-[11px]">{format(new Date(inv.created_at), "dd MMM yyyy")}</TableCell>
                      {!isSeller && (
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className="h-5 w-5 rounded-md bg-accent flex items-center justify-center shrink-0">
                              <Store className="h-3 w-3 text-muted-foreground" />
                            </div>
                            <span className="font-medium">{inv.sellerName}</span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center h-6 min-w-[28px] px-1.5 rounded-md bg-accent text-[11px] font-semibold">{inv.ordersCount}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{inv.totalAmount.toLocaleString()} <span className="text-muted-foreground text-[10px]">MAD</span></TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">-{inv.totalFees.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-success">{inv.netPayable.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">MAD</span></TableCell>
                      {!isSeller && (
                        <TableCell className="text-center">
                          {inv.status === "ready" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-warning hover:bg-warning/10"
                                  onClick={() => toggleReadyMutation.mutate({ invoiceId: inv.id, currentStatus: inv.status })}>
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-[10px]">Revert to Draft</TooltipContent>
                            </Tooltip>
                          )}
                          {inv.status === "paid" && <span className="text-[10px] text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        {inv.status === "ready" && <Badge variant="outline" className="text-[10px] border-info/30 text-info bg-info/10">Ready</Badge>}
                        {inv.status === "paid" && <Badge variant="outline" className="text-[10px] border-success/30 text-success bg-success/10">Paid</Badge>}
                      </TableCell>
                      {!isSeller && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch
                              checked={inv.status === "paid"}
                              onCheckedChange={() => togglePaidMutation.mutate({ invoiceId: inv.id, currentStatus: inv.status })}
                              disabled={inv.status !== "ready" && inv.status !== "paid"}
                              className="data-[state=checked]:bg-success scale-90"
                            />
                            <span className={`text-[10px] font-semibold ${inv.status === "paid" ? "text-success" : "text-muted-foreground"}`}>
                              {inv.status === "paid" ? t("paid") : t("not_paid")}
                            </span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center justify-center">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:bg-info/10" onClick={() => openDetail(row)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-[10px]">View Orders</TooltipContent>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t("show")}</span>
                <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="h-8 w-[65px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map(n => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{t("of")} {filtered.length}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 text-xs px-3" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span className="text-xs px-2 text-muted-foreground">Page {currentPage}/{totalPages}</span>
                <Button variant="outline" size="sm" className="h-8 text-xs px-3" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Addon Dialog */}
      <Dialog open={!!addonInvoiceId} onOpenChange={open => { if (!open) setAddonInvoiceId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <PlusCircle className="h-4 w-4 text-primary" /> {t("add_addon")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("type")}</Label>
              <div className="flex gap-2">
                <Button variant={addonType === "in" ? "default" : "outline"} size="sm"
                  className={`flex-1 text-xs gap-1.5 ${addonType === "in" ? "bg-green-500 hover:bg-green-600 text-white" : ""}`}
                  onClick={() => setAddonType("in")}>
                  <ArrowDownCircle className="h-3.5 w-3.5" /> {t("money_in")}
                </Button>
                <Button variant={addonType === "out" ? "default" : "outline"} size="sm"
                  className={`flex-1 text-xs gap-1.5 ${addonType === "out" ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}
                  onClick={() => setAddonType("out")}>
                  <ArrowUpCircle className="h-3.5 w-3.5" /> {t("money_out")}
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("amount")} (MAD)</Label>
              <Input type="number" value={addonAmount} onChange={e => setAddonAmount(e.target.value)} placeholder="0.00" className="h-9 text-xs" min="0" step="0.01" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("reason")}</Label>
              <Textarea value={addonReason} onChange={e => setAddonReason(e.target.value)} placeholder="Reason..." className="text-xs resize-none" rows={2} />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild><Button variant="outline" size="sm" className="text-xs">{t("cancel")}</Button></DialogClose>
            <Button size="sm" className={`text-xs ${addonType === "in" ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"}`}
              onClick={() => { if (addonInvoiceId && addonAmount && addonReason) addAddonMutation.mutate({ invoiceId: addonInvoiceId, type: addonType, amount: parseFloat(addonAmount), reason: addonReason }); }}
              disabled={!addonAmount || !addonReason}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail Modal */}
      <InvoiceDetailModal
        open={detailInvoiceId !== null || detailIsDraft}
        onOpenChange={open => { if (!open) { setDetailInvoiceId(null); setDetailIsDraft(false); } }}
        invoiceId={detailInvoiceId}
        invoiceNumber={detailInvoiceNumber}
        sellerName={detailSellerName}
        sellerId={detailSellerId}
        sellerRates={detailSellerRates}
        isDraft={detailIsDraft}
        draftOrders={detailDraftOrders}
      />
    </div>
  );
}
