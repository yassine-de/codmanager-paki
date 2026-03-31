import { useState, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  FileText, Search, RotateCcw, Eye, CalendarDays, Store, CreditCard, CheckCircle2, PlusCircle,
  Wallet, Clock, ArrowDownCircle, ArrowUpCircle, Upload, History,
  Loader2, ChevronLeft, ChevronRight, Package, Download, Printer
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
import InvoiceHistoryModal from "@/components/InvoiceHistoryModal";
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

  // History modal
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [historyInvoiceNumber, setHistoryInvoiceNumber] = useState("");
  const [historyOrderIds, setHistoryOrderIds] = useState<string[] | undefined>(undefined);

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

  // No more virtual drafts - DB trigger auto-creates draft invoices
  const loadingDrafts = false;

  // Fetch all seller profiles
  const allSellerIds = useMemo(() => {
    const ids = new Set<string>();
    invoices.forEach(i => ids.add(i.seller_id));
    return [...ids];
  }, [invoices]);

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

  // Compute invoice summaries (all invoices including drafts from DB)
  const invoiceSummaries = useMemo(() => {
    const ordersByInvoice: Record<string, typeof invoiceOrders> = {};
    invoiceOrders.forEach(o => {
      const key = o.invoice_id!;
      if (!ordersByInvoice[key]) ordersByInvoice[key] = [];
      ordersByInvoice[key].push(o);
    });

    return invoices.map(inv => {
      const orders = ordersByInvoice[inv.id] || [];
      const rates = sellerRatesMap[inv.seller_id] || null;
      const totalAmount = orders.reduce((sum, o) => sum + (o.price * o.quantity), 0);
      const totalFees = orders.reduce((sum, o) => sum + calculateFeeFromWeight(getProductWeight(inv.seller_id, o.product_name), rates), 0);
      const codFees = totalAmount * 0.05;
      const addons = addonsByInvoice[inv.id] || [];
      const addonNet = addons.reduce((sum, a) => a.type === "out" ? sum - a.amount : sum + a.amount, 0);
      return {
        ...inv,
        ordersCount: orders.length,
        totalAmount,
        totalFees,
        codFees,
        addonNet,
        netPayable: totalAmount - totalFees - codFees + addonNet,
        sellerName: sellerNameMap[inv.seller_id] || inv.seller_id.slice(0, 8),
      };
    });
  }, [invoices, invoiceOrders, sellerRatesMap, addonsByInvoice, sellerNameMap, productWeightMap]);

  // All invoices as rows (no more virtual drafts)
  const combined = useMemo(() => {
    return invoiceSummaries
      .filter(inv => isSeller ? inv.status !== "draft" : true)
      .map(inv => ({ type: "invoice" as const, data: inv }));
  }, [invoiceSummaries, isSeller]);

  // Filters
  const filtered = useMemo(() => {
    return combined.filter(row => {
      const sellerId = row.data.seller_id;
      const sellerName = sellerNameMap[sellerId] || "";
      if (sellerFilter !== "all" && sellerId !== sellerFilter) return false;
      if (statusFilter !== "all") {
        if (row.data.status !== statusFilter) return false;
      }
      if (dateRange?.from) {
        const date = new Date(row.data.created_at);
        if (date < dateRange.from) return false;
        if (dateRange.to && date > dateRange.to) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!row.data.invoice_number.toLowerCase().includes(q) && !sellerName.toLowerCase().includes(q) && !row.data.status.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [combined, sellerFilter, statusFilter, dateRange, searchQuery, sellerNameMap]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  // Stats
  const totalAmount = filtered.reduce((s, r) => s + r.data.netPayable, 0);
  const paidAmount = filtered.filter(r => r.data.status === "paid").reduce((s, r) => s + r.data.netPayable, 0);
  const needToPay = filtered.filter(r => r.data.status === "ready").reduce((s, r) => s + r.data.netPayable, 0);

  const sellerOptions = useMemo(() => {
    return allSellerIds.map(id => ({
      value: id,
      label: sellerNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [allSellerIds, sellerNameMap]);

  // Helper: log invoice history
  const logInvoiceHistory = async (invoiceId: string, eventType: string, fieldChanged: string | null, oldValue: string | null, newValue: string | null, orderId: string | null = null) => {
    if (!authUser) return;
    await supabase.from("invoice_history").insert({
      invoice_id: invoiceId,
      event_type: eventType,
      field_changed: fieldChanged,
      old_value: oldValue,
      new_value: newValue,
      order_id: orderId,
      changed_by: authUser.id,
    } as any);
  };

  // Finalize draft invoice → mark as ready
  const finalizeMutation = useMutation({
    mutationFn: async (invoiceId: string) => {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "ready", finalized_at: new Date().toISOString() } as any)
        .eq("id", invoiceId);
      if (error) throw error;
      await logInvoiceHistory(invoiceId, "status_change", "status", "draft", "ready");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-orders-summary"] });
      toast.success("Invoice finalized and sent to seller");
    },
    onError: () => toast.error("Failed to finalize invoice"),
  });

  // Toggle paid
  const togglePaidMutation = useMutation({
    mutationFn: async ({ invoiceId, currentStatus, netPayable, sellerId }: { invoiceId: string; currentStatus: string; netPayable?: number; sellerId?: string }) => {
      const isPaid = currentStatus === "paid";
      const newStatus = isPaid ? "ready" : "paid";
      const { error } = await supabase
        .from("invoices")
        .update({
          status: newStatus,
          paid_at: isPaid ? null : new Date().toISOString(),
          paid_by: isPaid ? null : "CIH",
        } as any)
        .eq("id", invoiceId);
      if (error) throw error;
      await logInvoiceHistory(invoiceId, "status_change", "status", currentStatus, newStatus);
      if (!isPaid) {
        await logInvoiceHistory(invoiceId, "status_change", "paid_at", null, new Date().toISOString());

        // If netPayable is negative, carry over to next draft invoice as addon
        if (netPayable !== undefined && netPayable < 0 && sellerId) {
          const carryAmount = Math.abs(netPayable);

          // Find or create a draft invoice for this seller (exclude current one)
          const { data: existingDraft } = await supabase
            .from("invoices")
            .select("id")
            .eq("seller_id", sellerId)
            .eq("status", "draft")
            .neq("id", invoiceId)
            .order("created_at", { ascending: false })
            .limit(1)
            .single();

          let targetInvoiceId: string;
          if (existingDraft) {
            targetInvoiceId = existingDraft.id;
          } else {
            const { data: newInv, error: newErr } = await supabase
              .from("invoices")
              .insert({ seller_id: sellerId, status: "draft" } as any)
              .select("id")
              .single();
            if (newErr) throw newErr;
            targetInvoiceId = newInv.id;
          }

          // Add the negative carry-over as an "out" addon
          const { error: addonErr } = await supabase
            .from("invoice_addons")
            .insert({
              invoice_id: targetInvoiceId,
              type: "out",
              amount: carryAmount,
              reason: `From last invoice (${invoiceId.slice(0, 8)})`,
            } as any);
          if (addonErr) throw addonErr;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-addons"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-orders-summary"] });
      toast.success("Payment status updated");
    },
  });

  // Toggle ready (un-ready a ready invoice → revert to draft)
  const toggleReadyMutation = useMutation({
    mutationFn: async ({ invoiceId, currentStatus }: { invoiceId: string; currentStatus: string }) => {
      if (currentStatus === "ready") {
        await logInvoiceHistory(invoiceId, "status_change", "status", "ready", "draft");
        const { error } = await supabase
          .from("invoices")
          .update({ status: "draft", finalized_at: null } as any)
          .eq("id", invoiceId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-orders-summary"] });
      toast.success("Invoice reverted to draft");
    },
  });

  // No more finalizeAndAddonMutation - addons can be added directly to DB draft invoices

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

  const openDetail = (inv: typeof invoiceSummaries[0]) => {
    setDetailSellerName(sellerNameMap[inv.seller_id] || "—");
    setDetailSellerRates(sellerRatesMap[inv.seller_id] || null);
    setDetailSellerId(inv.seller_id);
    setDetailInvoiceId(inv.id);
    setDetailInvoiceNumber(inv.status === "draft" ? "Draft Invoice" : inv.invoice_number);
    setDetailIsDraft(false);
    setDetailDraftOrders([]);
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
            <p className="text-base font-bold text-success">{paidAmount.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">PKR</span></p>
          </div>
          {!isSeller && (
            <>
              <div className="h-8 w-px bg-border" />
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center justify-end gap-1">
                  <Clock className="h-3 w-3 text-warning" /> {t("need_to_pay")}
                </p>
                <p className="text-base font-bold text-warning">{needToPay.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">PKR</span></p>
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
                <TableHead className="text-[11px] font-semibold text-right">COD 5%</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">Paid Amount</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">Ready</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">Status</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">Payment</TableHead>}
                {isSeller && <TableHead className="text-[11px] font-semibold text-center">Payment</TableHead>}
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
                  const inv = row.data;
                  const proofUrl = inv.payment_proof_url;
                  const isDraft = inv.status === "draft";
                  return (
                    <TableRow key={inv.id} className={`text-xs ${isDraft ? "bg-warning/5 hover:bg-warning/10" : ""}`}>
                      <TableCell className={`font-semibold ${isDraft ? "text-warning" : "text-primary"}`}>
                        {isDraft ? "Draft" : inv.invoice_number}
                      </TableCell>
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
                      <TableCell className="text-right tabular-nums">{inv.totalAmount.toLocaleString()} <span className="text-muted-foreground text-[10px]">PKR</span></TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">-{inv.totalFees.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums text-destructive">-{inv.codFees.toFixed(2)}</TableCell>
                      <TableCell className="text-right tabular-nums font-bold text-success">{inv.netPayable.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">PKR</span></TableCell>
                      {!isSeller && (
                        <TableCell className="text-center">
                          <Switch
                            checked={inv.status === "ready" || inv.status === "paid"}
                            onCheckedChange={() => {
                              if (inv.status === "ready") {
                                toggleReadyMutation.mutate({ invoiceId: inv.id, currentStatus: inv.status });
                              } else if (inv.status === "draft") {
                                finalizeMutation.mutate(inv.id);
                              }
                            }}
                            disabled={inv.status === "paid"}
                            className="data-[state=checked]:bg-success scale-90"
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                      {inv.status === "draft" && <Badge variant="outline" className="text-[10px] border-warning/30 text-warning bg-warning/10">Draft</Badge>}
                        {inv.status === "ready" && <Badge variant="outline" className="text-[10px] border-info/30 text-info bg-info/10">Ready</Badge>}
                        {inv.status === "paid" && <Badge variant="outline" className="text-[10px] border-success/30 text-success bg-success/10">Paid</Badge>}
                      </TableCell>
                      {!isSeller && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch
                              checked={inv.status === "paid"}
                              onCheckedChange={() => togglePaidMutation.mutate({ invoiceId: inv.id, currentStatus: inv.status, netPayable: inv.netPayable, sellerId: inv.seller_id })}
                              disabled={inv.status !== "ready" && inv.status !== "paid"}
                              className="data-[state=checked]:bg-success scale-90"
                            />
                            <span className={`text-[10px] font-semibold ${inv.status === "paid" ? "text-success" : "text-muted-foreground"}`}>
                              {inv.status === "paid" ? t("paid") : t("not_paid")}
                            </span>
                          </div>
                        </TableCell>
                      )}
                      {isSeller && (
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-[10px] ${inv.status === "paid" ? "border-success/30 text-success bg-success/10" : "border-destructive/30 text-destructive bg-destructive/10"}`}>
                            {inv.status === "paid" ? t("paid") : t("not_paid")}
                          </Badge>
                          {inv.status === "paid" && inv.paid_at && (
                            <p className="text-[9px] text-muted-foreground mt-0.5">{format(new Date(inv.paid_at), "dd MMM yyyy")}</p>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center justify-center gap-0.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:bg-info/10" onClick={() => openDetail(inv)}>
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="text-[10px]">View Orders</TooltipContent>
                          </Tooltip>
                          {!isSeller && (
                             <>
                              <Tooltip>
                                 <TooltipTrigger asChild>
                                   <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/10"
                                     onClick={() => { setAddonInvoiceId(inv.id); setAddonType("in"); setAddonAmount(""); setAddonReason(""); }}>
                                     <PlusCircle className="h-3.5 w-3.5" />
                                   </Button>
                                 </TooltipTrigger>
                                 <TooltipContent className="text-[10px]">{t("add_addon")}</TooltipContent>
                               </Tooltip>
                              {proofUrl ? (
                                <Dialog>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <DialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:bg-success/10">
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                      </DialogTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">{t("proof")}</TooltipContent>
                                  </Tooltip>
                                  <DialogContent className="max-w-md">
                                    <DialogHeader><DialogTitle className="text-sm">{t("proof")} — {inv.invoice_number}</DialogTitle></DialogHeader>
                                    <img src={proofUrl} alt="Payment proof" className="w-full rounded-lg border" />
                                    <div className="flex justify-end pt-2">
                                      <label className="cursor-pointer">
                                        <input type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) uploadProofMutation.mutate({ invoiceId: inv.id, file }); }} />
                                        <Button variant="outline" size="sm" className="gap-1.5" asChild>
                                          <span><Upload className="h-3.5 w-3.5" /> Replace Proof</span>
                                        </Button>
                                      </label>
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="cursor-pointer">
                                      <input type="file" accept="image/*" className="hidden" onChange={e => { const file = e.target.files?.[0]; if (file) uploadProofMutation.mutate({ invoiceId: inv.id, file }); }} />
                                      <div className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-warning/10 text-warning transition-colors">
                                        <Upload className="h-3.5 w-3.5" />
                                      </div>
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-[10px]">Upload proof</TooltipContent>
                                </Tooltip>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted"
                                    onClick={() => {
                                      setHistoryInvoiceId(inv.id);
                                      setHistoryInvoiceNumber(inv.invoice_number);
                                      setHistoryOrderIds(undefined);
                                    }}>
                                    <History className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[10px]">History</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          {isSeller && (
                            <>
                              {proofUrl && (
                                <Dialog>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <DialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:bg-success/10">
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                      </DialogTrigger>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-[10px]">{t("proof")}</TooltipContent>
                                  </Tooltip>
                                  <DialogContent className="max-w-md">
                                    <DialogHeader><DialogTitle className="text-sm">{t("proof")} — {inv.invoice_number}</DialogTitle></DialogHeader>
                                    <img src={proofUrl} alt="Payment proof" className="w-full rounded-lg border" />
                                  </DialogContent>
                                </Dialog>
                              )}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:bg-primary/10" onClick={() => {
                                    openDetail(inv);
                                    setTimeout(() => window.print(), 500);
                                  }}>
                                    <Printer className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[10px]">Print</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:bg-muted" onClick={() => openDetail(inv)}>
                                    <Download className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent className="text-[10px]">Download</TooltipContent>
                              </Tooltip>
                            </>
                          )}
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
              <Label className="text-xs">{t("amount")} (PKR)</Label>
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

      {/* History Modal */}
      <InvoiceHistoryModal
        open={historyInvoiceId !== null || (historyOrderIds !== undefined && historyOrderIds.length > 0)}
        onOpenChange={open => { if (!open) { setHistoryInvoiceId(null); setHistoryOrderIds(undefined); } }}
        invoiceId={historyInvoiceId}
        invoiceNumber={historyInvoiceNumber}
        orderIds={historyOrderIds}
      />
    </div>
  );
}
