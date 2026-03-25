import { useState, useMemo } from "react";
import { Download, Printer, Upload, FileText, Search, RotateCcw, Eye, CalendarDays, Store, CreditCard, CheckCircle2, XCircle, Wallet, Clock, History, PlusCircle, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/contexts/AuthContext";
import { sellerNames } from "@/lib/data";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import type { DateRange } from "react-day-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

type PaymentStatus = "paid" | "not_paid";
type ReadyStatus = "ready" | "not_ready";

interface HistoryEvent {
  id: string;
  timestamp: string;
  type: "created" | "ready" | "unready" | "paid" | "unpaid" | "addon_in" | "addon_out" | "proof_uploaded";
  description: string;
  amount?: number;
  reason?: string;
}

interface Addon {
  id: string;
  type: "in" | "out";
  amount: number;
  reason: string;
  date: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  seller: string;
  ordersCount: number;
  amount: number;
  paymentStatus: PaymentStatus;
  readyStatus: ReadyStatus;
  paidBy: string | null;
  paymentProof: string | null;
  generatedDate: string;
  paidDate: string | null;
  rate: number;
  history: HistoryEvent[];
  addons: Addon[];
}

function generateInvoices(): Invoice[] {
  const invoices: Invoice[] = [];
  for (let i = 1; i <= 65; i++) {
    const isReady = Math.random() > 0.4;
    const isPaid = isReady && Math.random() > 0.4;
    const seller = sellerNames[Math.floor(Math.random() * sellerNames.length)];
    const date = new Date(2026, 2, Math.floor(Math.random() * 23) + 1);
    const genDate = format(date, "yyyy-MM-dd");
    const history: HistoryEvent[] = [
      { id: `h-${i}-1`, timestamp: format(date, "yyyy-MM-dd HH:mm"), type: "created", description: "Invoice created" },
    ];
    if (isReady) {
      history.push({ id: `h-${i}-2`, timestamp: format(new Date(date.getTime() + 86400000), "yyyy-MM-dd HH:mm"), type: "ready", description: "Marked as ready" });
    }
    if (isPaid) {
      history.push({ id: `h-${i}-3`, timestamp: format(new Date(date.getTime() + 86400000 * 2), "yyyy-MM-dd HH:mm"), type: "paid", description: "Payment confirmed" });
    }
    invoices.push({
      id: `INV-${String(i).padStart(4, "0")}`,
      invoiceNumber: `#${2000 + i}`,
      seller,
      ordersCount: Math.floor(Math.random() * 50) + 5,
      amount: Math.floor(Math.random() * 5000) + 500,
      paymentStatus: isPaid ? "paid" : "not_paid",
      readyStatus: isReady ? "ready" : "not_ready",
      paidBy: isPaid ? (Math.random() > 0.5 ? "Binance" : "CIH") : null,
      paymentProof: isPaid && Math.random() > 0.3 ? "/placeholder.svg" : null,
      generatedDate: genDate,
      paidDate: isPaid ? format(new Date(date.getTime() + 86400000 * Math.floor(Math.random() * 5 + 1)), "yyyy-MM-dd") : null,
      rate: Math.round((Math.random() * 2 + 3) * 100) / 100,
      history,
      addons: [],
    });
  }
  return invoices;
}

const initialInvoices = generateInvoices();

function getHistoryIcon(type: HistoryEvent["type"]) {
  switch (type) {
    case "created": return <FileText className="h-3.5 w-3.5 text-primary" />;
    case "ready": return <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />;
    case "unready": return <XCircle className="h-3.5 w-3.5 text-orange-500" />;
    case "paid": return <Wallet className="h-3.5 w-3.5 text-green-500" />;
    case "unpaid": return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case "addon_in": return <ArrowDownCircle className="h-3.5 w-3.5 text-red-500" />;
    case "addon_out": return <ArrowUpCircle className="h-3.5 w-3.5 text-green-500" />;
    case "proof_uploaded": return <Eye className="h-3.5 w-3.5 text-violet-500" />;
  }
}

function getHistoryColor(type: HistoryEvent["type"]) {
  switch (type) {
    case "created": return "border-primary/30";
    case "ready": return "border-blue-500/30";
    case "unready": return "border-orange-500/30";
    case "paid": return "border-green-500/30";
    case "unpaid": return "border-red-500/30";
    case "addon_in": return "border-red-500/30";
    case "addon_out": return "border-green-500/30";
    case "proof_uploaded": return "border-violet-500/30";
  }
}

export default function Invoices() {
  const { t } = useLanguage();
  const { authUser } = useAuth();
  const isSeller = authUser?.role === "seller";
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [searchQuery, setSearchQuery] = useState("");
  const [sellerFilter, setSellerFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [readyFilter, setReadyFilter] = useState("all");
  const [proofUploads, setProofUploads] = useState<Record<string, string>>({});
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // History & Addon form state
  const [historyInvoiceId, setHistoryInvoiceId] = useState<string | null>(null);
  const [addonInvoiceId, setAddonInvoiceId] = useState<string | null>(null);
  const [addonType, setAddonType] = useState<"in" | "out">("in");
  const [addonAmount, setAddonAmount] = useState("");
  const [addonReason, setAddonReason] = useState("");

  const sellerOptions = sellerNames.map((s) => ({ value: s, label: s }));
  const paymentOptions = [
    { value: "paid", label: `✅ ${t("paid")}` },
    { value: "not_paid", label: `❌ ${t("not_paid")}` },
  ];
  const readyOptions = [
    { value: "ready", label: `✅ ${t("ready")}` },
    { value: "not_ready", label: `❌ ${t("not_ready")}` },
  ];

  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (sellerFilter !== "all" && inv.seller !== sellerFilter) return false;
      if (paymentFilter !== "all" && inv.paymentStatus !== paymentFilter) return false;
      if (readyFilter !== "all" && inv.readyStatus !== readyFilter) return false;
      if (dateRange?.from) {
        const genDate = new Date(inv.generatedDate);
        if (genDate < dateRange.from) return false;
        if (dateRange.to && genDate > dateRange.to) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!inv.id.toLowerCase().includes(q) && !inv.invoiceNumber.toLowerCase().includes(q) && !inv.seller.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [invoices, sellerFilter, paymentFilter, readyFilter, searchQuery, dateRange]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalAmount = filtered.reduce((s, inv) => s + getEffectiveAmount(inv), 0);
  const paidAmount = filtered.filter((inv) => inv.paymentStatus === "paid").reduce((s, inv) => s + getEffectiveAmount(inv), 0);
  const needToBePaid = filtered.filter((inv) => inv.readyStatus === "ready" && inv.paymentStatus === "not_paid").reduce((s, inv) => s + getEffectiveAmount(inv), 0);
  const paidCount = filtered.filter((inv) => inv.paymentStatus === "paid").length;

  function getEffectiveAmount(inv: Invoice) {
    const addonTotal = inv.addons.reduce((sum, a) => {
      return a.type === "out" ? sum + a.amount : sum - a.amount;
    }, 0);
    return inv.amount + addonTotal;
  }

  const addHistoryEvent = (invoiceId: string, type: HistoryEvent["type"], description: string, extra?: Partial<HistoryEvent>) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        const event: HistoryEvent = {
          id: `h-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: format(new Date(), "yyyy-MM-dd HH:mm"),
          type,
          description,
          ...extra,
        };
        return { ...inv, history: [...inv.history, event] };
      })
    );
  };

  const handleReset = () => {
    setSellerFilter("all");
    setPaymentFilter("all");
    setReadyFilter("all");
    setSearchQuery("");
    setDatePreset("maximum");
    setDateRange(undefined);
    setCurrentPage(1);
  };

  const handleProofUpload = (invoiceId: string, file: File) => {
    const url = URL.createObjectURL(file);
    setProofUploads((prev) => ({ ...prev, [invoiceId]: url }));
    addHistoryEvent(invoiceId, "proof_uploaded", "Payment proof uploaded");
  };

  const toggleReady = (invoiceId: string) => {
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== invoiceId) return inv;
        const newReady: ReadyStatus = inv.readyStatus === "ready" ? "not_ready" : "ready";
        if (newReady === "not_ready") {
          return { ...inv, readyStatus: newReady, paymentStatus: "not_paid" as PaymentStatus, paidBy: null, paidDate: null };
        }
        return { ...inv, readyStatus: newReady };
      })
    );
    const inv = invoices.find((i) => i.id === invoiceId);
    if (inv) {
      const wasReady = inv.readyStatus === "ready";
      addHistoryEvent(invoiceId, wasReady ? "unready" : "ready", wasReady ? "Marked as not ready" : "Marked as ready");
      if (wasReady && inv.paymentStatus === "paid") {
        addHistoryEvent(invoiceId, "unpaid", "Payment reversed (marked not ready)");
      }
    }
  };

  const togglePaid = (invoiceId: string) => {
    const inv = invoices.find((i) => i.id === invoiceId);
    if (!inv || inv.readyStatus !== "ready") return;
    const newPaid: PaymentStatus = inv.paymentStatus === "paid" ? "not_paid" : "paid";
    setInvoices((prev) =>
      prev.map((i) => {
        if (i.id !== invoiceId) return i;
        return {
          ...i,
          paymentStatus: newPaid,
          paidDate: newPaid === "paid" ? format(new Date(), "yyyy-MM-dd") : null,
          paidBy: newPaid === "paid" ? "CIH" : null,
        };
      })
    );
    addHistoryEvent(invoiceId, newPaid === "paid" ? "paid" : "unpaid", newPaid === "paid" ? "Payment confirmed" : "Payment reversed");
  };

  const handleAddAddon = () => {
    if (!addonInvoiceId || !addonAmount || !addonReason) return;
    const amt = parseFloat(addonAmount);
    if (isNaN(amt) || amt <= 0) return;
    const addon: Addon = {
      id: `addon-${Date.now()}`,
      type: addonType,
      amount: amt,
      reason: addonReason,
      date: format(new Date(), "yyyy-MM-dd"),
    };
    setInvoices((prev) =>
      prev.map((inv) => {
        if (inv.id !== addonInvoiceId) return inv;
        return { ...inv, addons: [...inv.addons, addon] };
      })
    );
    addHistoryEvent(
      addonInvoiceId,
      addonType === "in" ? "addon_in" : "addon_out",
      `${addonType === "in" ? "Expense" : "Addition"}: ${amt.toFixed(2)} MAD — ${addonReason}`,
      { amount: amt, reason: addonReason }
    );
    setAddonAmount("");
    setAddonReason("");
    setAddonInvoiceId(null);
  };

  const handlePrint = (invoice: Invoice) => {
    const effective = getEffectiveAmount(invoice);
    const addonsHtml = invoice.addons.length > 0
      ? `<h3 style="margin-top:24px">Addons</h3><table>${invoice.addons.map((a) =>
          `<tr><td><span style="color:${a.type === "in" ? "#dc2626" : "#16a34a"};font-weight:bold">${a.type === "in" ? "▼ Expense" : "▲ Addition"}</span></td><td>${a.amount.toFixed(2)} MAD</td><td>${a.reason}</td><td style="color:#888">${a.date}</td></tr>`
        ).join("")}</table>`
      : "";
    const historyHtml = `<h3 style="margin-top:24px">History</h3><table>${invoice.history.map((h) =>
      `<tr><td style="color:#888;width:140px">${h.timestamp}</td><td><strong>${h.type.replace("_", " ").toUpperCase()}</strong></td><td>${h.description}</td></tr>`
    ).join("")}</table>`;
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Invoice ${invoice.invoiceNumber}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;padding:40px 50px;color:#1a1a1a;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #1a1a1a}
.logo{font-size:28px;font-weight:800;letter-spacing:-0.5px}
.logo span{color:#6366f1}
.inv-info{text-align:right}
.inv-info h2{font-size:20px;color:#6366f1}
.inv-info p{font-size:12px;color:#666;margin-top:2px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:30px}
.meta-box{background:#f8f9fa;border-radius:8px;padding:16px}
.meta-box h4{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888;margin-bottom:6px}
.meta-box p{font-size:14px;font-weight:600}
.detail-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.detail-item{background:#f8f9fa;border-radius:8px;padding:12px}
.detail-item .label{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#888}
.detail-item .value{font-size:16px;font-weight:700;margin-top:4px}
.amount-box{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px}
.amount-box .label{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.8}
.amount-box .value{font-size:32px;font-weight:800;margin-top:4px}
.amount-box .sub{font-size:12px;opacity:0.7;margin-top:4px}
.status-row{display:flex;gap:12px;margin-bottom:24px}
.status-badge{padding:8px 16px;border-radius:20px;font-size:12px;font-weight:600}
.status-paid{background:#dcfce7;color:#16a34a}
.status-not-paid{background:#fef2f2;color:#dc2626}
.status-ready{background:#dbeafe;color:#2563eb}
.status-not-ready{background:#fff7ed;color:#ea580c}
table{width:100%;border-collapse:collapse;margin-top:8px;font-size:12px}
td,th{padding:8px 12px;text-align:left;border-bottom:1px solid #eee}
th{background:#f8f9fa;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#888}
h3{font-size:14px;font-weight:700;color:#1a1a1a;border-bottom:2px solid #e5e7eb;padding-bottom:6px}
.footer{margin-top:40px;padding-top:16px;border-top:2px solid #e5e7eb;text-align:center;color:#888;font-size:11px}
@media print{body{padding:20px 30px}}
</style></head><body>
<div class="header">
  <div><div class="logo">COD <span>Manager</span></div><p style="font-size:12px;color:#888;margin-top:4px">Invoice Document</p></div>
  <div class="inv-info"><h2>${invoice.invoiceNumber}</h2><p>${invoice.id}</p><p>${invoice.generatedDate}</p></div>
</div>
<div class="meta">
  <div class="meta-box"><h4>Seller</h4><p>${invoice.seller}</p></div>
  <div class="meta-box"><h4>Payment Method</h4><p>${invoice.paidBy || "—"}</p></div>
</div>
<div class="detail-grid">
  <div class="detail-item"><div class="label">Orders</div><div class="value">${invoice.ordersCount}</div></div>
  <div class="detail-item"><div class="label">Rate</div><div class="value">${invoice.rate}</div></div>
  <div class="detail-item"><div class="label">Generated</div><div class="value">${invoice.generatedDate}</div></div>
  <div class="detail-item"><div class="label">Paid Date</div><div class="value">${invoice.paidDate || "—"}</div></div>
</div>
<div class="amount-box">
  <div class="label">Total Amount</div>
  <div class="value">${effective.toLocaleString(undefined, { minimumFractionDigits: 2 })} MAD</div>
  ${invoice.addons.length > 0 ? `<div class="sub">Base: ${invoice.amount.toLocaleString()} MAD · ${invoice.addons.length} addon(s)</div>` : ""}
</div>
<div class="status-row">
  <span class="status-badge ${invoice.readyStatus === "ready" ? "status-ready" : "status-not-ready"}">${invoice.readyStatus === "ready" ? "✓ Ready" : "✗ Not Ready"}</span>
  <span class="status-badge ${invoice.paymentStatus === "paid" ? "status-paid" : "status-not-paid"}">${invoice.paymentStatus === "paid" ? "✓ Paid" : "✗ Not Paid"}</span>
</div>
${addonsHtml}
${historyHtml}
<div class="footer">Generated by COD Manager · ${format(new Date(), "yyyy-MM-dd HH:mm")}</div>
<script>window.print();</script></body></html>`);
    printWindow.document.close();
  };

  const handleDownload = (invoice: Invoice) => {
    const effective = getEffectiveAmount(invoice);
    const addonsText = invoice.addons.length > 0
      ? "\n\nAddons:\n" + invoice.addons.map((a) => `  ${a.type === "in" ? "[-] Expense" : "[+] Addition"}: ${a.amount.toFixed(2)} MAD — ${a.reason} (${a.date})`).join("\n")
      : "";
    const content = `Invoice: ${invoice.invoiceNumber}\nID: ${invoice.id}\nSeller: ${invoice.seller}\nOrders: ${invoice.ordersCount}\nBase Amount: ${invoice.amount.toFixed(2)} MAD\nEffective Amount: ${effective.toFixed(2)} MAD\nRate: ${invoice.rate}\nReady: ${invoice.readyStatus}\nPayment: ${invoice.paymentStatus}\nPaid By: ${invoice.paidBy || "N/A"}\nGenerated: ${invoice.generatedDate}\nPaid Date: ${invoice.paidDate || "N/A"}${addonsText}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${invoice.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

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
                <p className="text-base font-bold text-warning">{needToBePaid.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">MAD</span></p>
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
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  placeholder={`ID, #...`}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <CalendarDays className="h-3 w-3" /> {t("date_range")}
              </Label>
              <DatePresetFilter dateRange={dateRange} onDateRangeChange={(r) => { setDateRange(r); setCurrentPage(1); }} preset={datePreset} onPresetChange={setDatePreset} />
            </div>
            {!isSeller && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Store className="h-3 w-3" /> {t("seller")}
                </Label>
                <SearchableSelect value={sellerFilter} onValueChange={(v) => { setSellerFilter(v); setCurrentPage(1); }} options={sellerOptions} placeholder={t("seller")} allLabel={`🏪 ${t("all")}`} className="w-[155px]" />
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                <CreditCard className="h-3 w-3" /> {t("payment_status")}
              </Label>
              <SearchableSelect value={paymentFilter} onValueChange={(v) => { setPaymentFilter(v); setCurrentPage(1); }} options={paymentOptions} placeholder={t("payment_status")} allLabel={`💳 ${t("all")}`} className="w-[145px]" />
            </div>
            {!isSeller && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> {t("ready_status")}
                </Label>
                <SearchableSelect value={readyFilter} onValueChange={(v) => { setReadyFilter(v); setCurrentPage(1); }} options={readyOptions} placeholder={t("ready_status")} allLabel={`📦 ${t("all")}`} className="w-[145px]" />
              </div>
            )}
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-success/10 text-success">
                <CheckCircle2 className="h-3 w-3" />
                <span className="text-[11px] font-semibold">{paidCount} {t("paid")}</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-destructive/10 text-destructive">
                <XCircle className="h-3 w-3" />
                <span className="text-[11px] font-semibold">{filtered.length - paidCount} {t("not_paid")}</span>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleReset} className="h-9 text-xs gap-1.5 text-muted-foreground hover:text-foreground">
              <RotateCcw className="h-3 w-3" /> {t("reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* History Dialog */}
      <Dialog open={!!historyInvoiceId} onOpenChange={(open) => { if (!open) setHistoryInvoiceId(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <History className="h-4 w-4 text-amber-500" /> {t("history")} — {invoices.find((i) => i.id === historyInvoiceId)?.invoiceNumber}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-0 pl-4">
              {(invoices.find((i) => i.id === historyInvoiceId)?.history || []).map((event, idx, arr) => (
                <div key={event.id} className="relative flex gap-3 pb-4">
                  {idx < arr.length - 1 && (
                    <div className="absolute left-[7px] top-[22px] bottom-0 w-px bg-border" />
                  )}
                  <div className={`relative z-10 mt-0.5 h-4 w-4 rounded-full border-2 ${getHistoryColor(event.type)} bg-background flex items-center justify-center shrink-0`}>
                    {getHistoryIcon(event.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium">{event.description}</p>
                    {event.amount && (
                      <p className="text-[11px] font-semibold mt-0.5">
                        {event.type === "addon_in" ? "-" : "+"}{event.amount.toFixed(2)} MAD
                      </p>
                    )}
                    {event.reason && (
                      <p className="text-[10px] text-muted-foreground">{event.reason}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground mt-0.5">{event.timestamp}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Addon Dialog */}
      <Dialog open={!!addonInvoiceId} onOpenChange={(open) => { if (!open) setAddonInvoiceId(null); }}>
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
                <Button
                  variant={addonType === "in" ? "default" : "outline"}
                  size="sm"
                  className={`flex-1 text-xs gap-1.5 ${addonType === "in" ? "bg-green-500 hover:bg-green-600 text-white" : ""}`}
                  onClick={() => setAddonType("in")}
                >
                  <ArrowDownCircle className="h-3.5 w-3.5" /> {t("money_in")}
                </Button>
                <Button
                  variant={addonType === "out" ? "default" : "outline"}
                  size="sm"
                  className={`flex-1 text-xs gap-1.5 ${addonType === "out" ? "bg-red-500 hover:bg-red-600 text-white" : ""}`}
                  onClick={() => setAddonType("out")}
                >
                  <ArrowUpCircle className="h-3.5 w-3.5" /> {t("money_out")}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {addonType === "in" ? t("money_in_desc") : t("money_out_desc")}
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("amount")} (MAD)</Label>
              <Input
                type="number"
                value={addonAmount}
                onChange={(e) => setAddonAmount(e.target.value)}
                placeholder="0.00"
                className="h-9 text-xs"
                min="0"
                step="0.01"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("reason")}</Label>
              <Textarea
                value={addonReason}
                onChange={(e) => setAddonReason(e.target.value)}
                placeholder={t("reason_placeholder")}
                className="text-xs resize-none"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm" className="text-xs">{t("cancel")}</Button>
            </DialogClose>
            <Button
              size="sm"
              className={`text-xs ${addonType === "in" ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"}`}
              onClick={handleAddAddon}
              disabled={!addonAmount || !addonReason}
            >
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent bg-muted/30">
                <TableHead className="text-[11px] font-semibold">{t("invoice_number")}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t("invoice_id")}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t("generated_date")}</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold">{t("seller")}</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">{t("orders")}</TableHead>
                <TableHead className="text-[11px] font-semibold text-right">{t("amount")}</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">{t("ready_status")}</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">{t("payment_status")}</TableHead>
                <TableHead className="text-[11px] font-semibold">{t("paid_date")}</TableHead>
                {!isSeller && <TableHead className="text-[11px] font-semibold">{t("paid_by")}</TableHead>}
                {!isSeller && <TableHead className="text-[11px] font-semibold text-center">{t("rate")}</TableHead>}
                <TableHead className="text-[11px] font-semibold text-center">{t("actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isSeller ? 7 : 12} className="text-center text-xs text-muted-foreground py-16">
                    <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
                    <p className="font-medium">{t("no_invoices")}</p>
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((inv) => {
                  const proofUrl = proofUploads[inv.id] || inv.paymentProof;
                  const canPay = inv.readyStatus === "ready";
                  const effective = getEffectiveAmount(inv);
                  return (
                    <TableRow key={inv.id} className="text-xs group">
                      <TableCell className="font-semibold text-primary">{inv.invoiceNumber}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-[11px]">{inv.id}</TableCell>
                      <TableCell className="text-muted-foreground text-[11px]">{inv.generatedDate}</TableCell>
                      {!isSeller && (
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <div className="h-5 w-5 rounded-md bg-accent flex items-center justify-center shrink-0">
                              <Store className="h-3 w-3 text-muted-foreground" />
                            </div>
                            <span className="font-medium">{inv.seller}</span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        <span className="inline-flex items-center justify-center h-6 min-w-[28px] px-1.5 rounded-md bg-accent text-[11px] font-semibold">
                          {inv.ordersCount}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div>
                          <span className="font-bold">{effective.toLocaleString()}</span>
                          <span className="text-muted-foreground font-normal ml-1 text-[10px]">MAD</span>
                        </div>
                        {inv.addons.length > 0 && (
                          <p className="text-[9px] text-muted-foreground">base: {inv.amount.toLocaleString()}</p>
                        )}
                      </TableCell>
                      {!isSeller && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch checked={inv.readyStatus === "ready"} onCheckedChange={() => toggleReady(inv.id)} className="data-[state=checked]:bg-info scale-90" />
                            <span className={`text-[10px] font-semibold ${inv.readyStatus === "ready" ? "text-info" : "text-muted-foreground"}`}>
                              {inv.readyStatus === "ready" ? t("ready") : t("not_ready")}
                            </span>
                          </div>
                        </TableCell>
                      )}
                      <TableCell className="text-center">
                        {isSeller ? (
                          <Badge variant={inv.paymentStatus === "paid" ? "default" : "secondary"} className="text-[10px]">
                            {inv.paymentStatus === "paid" ? t("paid") : t("not_paid")}
                          </Badge>
                        ) : (
                          <div className="flex items-center justify-center gap-1.5">
                            <Switch checked={inv.paymentStatus === "paid"} onCheckedChange={() => togglePaid(inv.id)} disabled={!canPay} className="data-[state=checked]:bg-success scale-90" />
                            <span className={`text-[10px] font-semibold ${!canPay ? "text-muted-foreground/40" : inv.paymentStatus === "paid" ? "text-success" : "text-destructive"}`}>
                              {inv.paymentStatus === "paid" ? t("paid") : t("not_paid")}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px]">
                        {inv.paidDate ? (
                          <span className="text-success font-medium">{inv.paidDate}</span>
                        ) : (
                          <span className="text-muted-foreground/40">—</span>
                        )}
                      </TableCell>
                      {!isSeller && (
                        <TableCell>
                          {inv.paidBy ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-accent text-[11px] font-medium">
                              <Wallet className="h-3 w-3 text-muted-foreground" />
                              {inv.paidBy}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </TableCell>
                      )}
                      {!isSeller && (
                        <TableCell className="text-center">
                          <span className="font-semibold text-primary">{inv.rate}</span>
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center justify-center gap-0.5">
                          {/* Admin-only actions */}
                          {!isSeller && (
                            <>
                              {/* History */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-warning hover:text-warning hover:bg-warning/10" onClick={() => setHistoryInvoiceId(inv.id)}>
                                    <History className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[10px]">{t("history")}</TooltipContent>
                              </Tooltip>

                              {/* Addons */}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:text-info hover:bg-info/10" onClick={() => { setAddonInvoiceId(inv.id); setAddonType("in"); setAddonAmount(""); setAddonReason(""); }}>
                                    <PlusCircle className="h-3.5 w-3.5" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" className="text-[10px]">{t("add_addon")}</TooltipContent>
                              </Tooltip>

                              {/* Proof */}
                              {proofUrl ? (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:text-success hover:bg-success/10">
                                          <Eye className="h-3.5 w-3.5" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top" className="text-[10px]">{t("proof")}</TooltipContent>
                                    </Tooltip>
                                  </DialogTrigger>
                                  <DialogContent className="max-w-md">
                                    <DialogHeader>
                                      <DialogTitle className="text-sm">{t("proof")} — {inv.invoiceNumber}</DialogTitle>
                                    </DialogHeader>
                                    <img src={proofUrl} alt="Payment proof" className="w-full rounded-lg border" />
                                  </DialogContent>
                                </Dialog>
                              ) : (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="cursor-pointer">
                                      <input type="file" accept="image/*" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) handleProofUpload(inv.id, file); }} />
                                      <div className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-warning/10 text-warning transition-colors">
                                        <Upload className="h-3.5 w-3.5" />
                                      </div>
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px]">Upload proof</TooltipContent>
                                </Tooltip>
                              )}
                            </>
                          )}

                          {/* Seller: View Proof */}
                          {isSeller && proofUrl && (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-success hover:text-success hover:bg-success/10">
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-[10px]">{t("proof")}</TooltipContent>
                                </Tooltip>
                              </DialogTrigger>
                              <DialogContent className="max-w-md">
                                <DialogHeader>
                                  <DialogTitle className="text-sm">{t("proof")} — {inv.invoiceNumber}</DialogTitle>
                                </DialogHeader>
                                <img src={proofUrl} alt="Payment proof" className="w-full rounded-lg border" />
                              </DialogContent>
                            </Dialog>
                          )}

                          {/* Download */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-info hover:text-info hover:bg-info/10" onClick={() => handleDownload(inv)}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-[10px]">Download</TooltipContent>
                          </Tooltip>

                          {/* Print */}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-primary hover:text-primary hover:bg-primary/10" onClick={() => handlePrint(inv)}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-[10px]">Print</TooltipContent>
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
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}>
                  <SelectTrigger className="h-8 w-[65px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[10, 20, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{t("of")} {filtered.length} {t("invoices").toLowerCase()}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-8 text-xs px-3" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>←</Button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                  let page: number;
                  if (totalPages <= 5) page = i + 1;
                  else if (currentPage <= 3) page = i + 1;
                  else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
                  else page = currentPage - 2 + i;
                  return (
                    <Button key={page} variant={currentPage === page ? "default" : "outline"} size="sm" className="h-8 w-8 text-xs p-0" onClick={() => setCurrentPage(page)}>
                      {page}
                    </Button>
                  );
                })}
                <Button variant="outline" size="sm" className="h-8 text-xs px-3" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>→</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
