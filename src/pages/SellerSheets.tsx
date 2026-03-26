import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, ExternalLink, Eye, Loader2, FileSpreadsheet, RefreshCw, AlertTriangle, Mail, Download, ArrowUpRight, Database, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface Sheet {
  id: string;
  name: string;
  sheet_name: string;
  sheet_url: string;
  orders_count: number;
  errors_count: number;
  last_check: string | null;
  last_imported_row: number;
  active: boolean;
  created_at: string;
}

interface SheetError {
  id: string;
  sheet_id: string;
  order_data: Record<string, unknown>;
  error_message: string;
  created_at: string;
}

const TEMPLATE_HEADERS = [
  "Order ID",
  "Customer Name",
  "Phone Number",
  "Address",
  "City",
  "Product Name",
  "SKU",
  "Quantity",
  "Unit Price",
  "Total Amount",
];

const EXAMPLE_ROWS = [
  ["ORD-001", "Ahmed Benali", "0612345678", "Rue 10 Hay Salam", "Casablanca", "T-Shirt Premium", "PRD-00012", "2", "99.00", "198.00"],
  ["ORD-002", "Fatima Zahra", "0698765432", "Av Mohammed V N°5", "Rabat", "Sneakers Sport", "PRD-00045", "1", "350.00", "350.00"],
  ["ORD-003", "Youssef El Amrani", "0655443322", "Quartier Industriel", "Fès", "Sac à dos", "PRD-00008", "3", "120.00", "360.00"],
];

function downloadTemplate() {
  const rows = [TEMPLATE_HEADERS, ...EXAMPLE_ROWS];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "orders_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function SellerSheets() {
  const { user } = useAuth();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [linkOpen, setLinkOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sheet_name: "", sheet_url: "" });
  const [saving, setSaving] = useState(false);
  const [errorsOpen, setErrorsOpen] = useState(false);
  const [errorsSheet, setErrorsSheet] = useState<Sheet | null>(null);
  const [errors, setErrors] = useState<SheetError[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);
  const [serviceEmail, setServiceEmail] = useState("");

  const fetchServiceEmail = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "google_service_account_email")
      .maybeSingle();
    if (data) setServiceEmail(data.value);
  };

  const fetchSheets = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("integration_sheets")
      .select("*")
      .eq("seller_id", user.id)
      .order("created_at", { ascending: true });
    if (error) {
      toast.error("Error loading sheets");
    } else {
      setSheets((data as Sheet[]) || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSheets();
    fetchServiceEmail();
  }, [user]);

  const handleLink = async () => {
    if (!user || !form.name || !form.sheet_url) {
      toast.error("Please fill in all required fields");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("integration_sheets").insert({
      name: form.name,
      sheet_name: form.sheet_name,
      sheet_url: form.sheet_url,
      seller_id: user.id,
    });
    if (error) {
      toast.error("Error linking sheet");
    } else {
      toast.success("Sheet linked successfully");
      setLinkOpen(false);
      setForm({ name: "", sheet_name: "", sheet_url: "" });
      fetchSheets();
    }
    setSaving(false);
  };

  const viewErrors = async (sheet: Sheet) => {
    setErrorsSheet(sheet);
    setErrorsOpen(true);
    setErrorsLoading(true);
    const { data } = await supabase
      .from("integration_errors")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("created_at", { ascending: false });
    setErrors((data as SheetError[]) || []);
    setErrorsLoading(false);
  };

  const totalOrders = sheets.reduce((s, sh) => s + sh.orders_count, 0);
  const totalErrors = sheets.reduce((s, sh) => s + sh.errors_count, 0);
  const activeSheets = sheets.filter((s) => s.active).length;

  return (
    <div className="max-w-[1200px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">My Sheets</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            Link your Google Sheets to import orders automatically
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-1.5">
            <Download className="w-3.5 h-3.5" />
            Template
          </Button>
          <Button size="sm" onClick={() => setLinkOpen(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Link Sheet
          </Button>
        </div>
      </div>

      {/* Service account email */}
      {serviceEmail && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-start gap-3">
          <div className="bg-primary/10 rounded-lg p-2">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">Share your Google Sheet with this email:</p>
            <p className="text-sm text-primary font-mono mt-1 select-all truncate">{serviceEmail}</p>
          </div>
        </div>
      )}

      {/* KPI Cards */}
      {!loading && sheets.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <FileSpreadsheet className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Active Sheets</span>
            </div>
            <p className="text-2xl font-bold">{activeSheets}</p>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Database className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Total Imported</span>
            </div>
            <p className="text-2xl font-bold">{totalOrders}</p>
          </div>
          <div className="bg-card border rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Errors</span>
            </div>
            <p className={`text-2xl font-bold ${totalErrors > 0 ? "text-destructive" : ""}`}>{totalErrors}</p>
          </div>
        </div>
      )}

      {/* Sheets Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : sheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-muted/20">
          <div className="bg-muted rounded-full p-4 mb-4">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">No sheets linked yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px]">
            Click "Link Sheet" to connect your Google Sheet and start importing orders automatically
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sheet Name</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">With Errors</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last Check</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((sheet, idx) => (
                  <tr key={sheet.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-4 text-sm text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{sheet.name}</span>
                        {sheet.sheet_url && (
                          <a href={sheet.sheet_url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-3.5 h-3.5 text-primary hover:text-primary/80" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground">{sheet.sheet_name || "—"}</td>
                    <td className="px-4 py-4">
                      <span className="text-sm font-bold text-primary">{sheet.orders_count}</span>
                    </td>
                    <td className="px-4 py-4">
                      {sheet.errors_count > 0 ? (
                        <button
                          onClick={() => viewErrors(sheet)}
                          className="inline-flex items-center gap-1.5 text-destructive hover:underline"
                        >
                          <span className="text-sm font-medium">{sheet.errors_count}</span>
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="text-sm">0</span>
                          <Eye className="w-3.5 h-3.5 opacity-40" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4 text-sm text-muted-foreground whitespace-nowrap">
                      {sheet.last_check
                        ? formatDistanceToNow(new Date(sheet.last_check), { addSuffix: true })
                        : "Never"}
                    </td>
                    <td className="px-4 py-4">
                      <Badge
                        className={`text-[11px] font-medium ${
                          sheet.active
                            ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/20"
                            : "bg-muted text-muted-foreground"
                        }`}
                        variant="outline"
                      >
                        {sheet.active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                          onClick={fetchSheets}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </Button>
                        {sheet.errors_count > 0 && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
                            onClick={() => viewErrors(sheet)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Link Sheet Modal */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Link a Google Sheet</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Integration Name *</Label>
              <Input
                placeholder="e.g. My Orders Sheet"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sheet Name</Label>
              <Input
                placeholder="e.g. Sheet1"
                value={form.sheet_name}
                onChange={(e) => setForm({ ...form, sheet_name: e.target.value })}
                className="text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Google Sheet URL *</Label>
              <Input
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={form.sheet_url}
                onChange={(e) => setForm({ ...form, sheet_url: e.target.value })}
                className="text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setLinkOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleLink} disabled={saving}>
              {saving && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Link Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Errors Modal */}
      <Dialog open={errorsOpen} onOpenChange={setErrorsOpen}>
        <DialogContent className="max-w-2xl max-h-[70vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Errors — {errorsSheet?.name}</DialogTitle>
          </DialogHeader>
          {errorsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : errors.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No errors found</p>
          ) : (
            <div className="space-y-3">
              {errors.map((err) => (
                <div key={err.id} className="bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                  <p className="text-xs font-medium text-destructive">{err.error_message}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {formatDistanceToNow(new Date(err.created_at), { addSuffix: true })}
                  </p>
                  {err.order_data && (
                    <pre className="mt-2 text-[10px] bg-muted/50 rounded p-2 overflow-x-auto">
                      {JSON.stringify(err.order_data, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
