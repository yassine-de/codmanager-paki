import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, RefreshCw, Search, Eye, ExternalLink, AlertTriangle, Loader2, Mail, Save, FileSpreadsheet, Database, Copy, Check, Globe, Key, Hash } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

interface IntegrationSheet {
  id: string;
  seller_id: string;
  name: string;
  sheet_name: string;
  sheet_url: string;
  orders_count: number;
  errors_count: number;
  last_check: string | null;
  active: boolean;
  created_at: string;
  last_imported_row: number;
  seller_name?: string;
}

interface IntegrationError {
  id: string;
  sheet_id: string;
  order_data: Record<string, unknown>;
  error_message: string;
  created_at: string;
}

interface SellerOption {
  user_id: string;
  name: string;
}

const Integrations = () => {
  const [sheets, setSheets] = useState<IntegrationSheet[]>([]);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Service account email
  const [serviceEmail, setServiceEmail] = useState("");
  const [serviceEmailSaving, setServiceEmailSaving] = useState(false);
  const [serviceEmailLoaded, setServiceEmailLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  // API Config
  const [apiEnabled, setApiEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiAccountNumber, setApiAccountNumber] = useState("");
  const [apiSaving, setApiSaving] = useState(false);
  const [apiLoaded, setApiLoaded] = useState(false);
  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationSheet | null>(null);
  const [form, setForm] = useState({ name: "", sheet_name: "", sheet_url: "", seller_id: "" });

  // Errors modal
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [errorsSheet, setErrorsSheet] = useState<IntegrationSheet | null>(null);
  const [errors, setErrors] = useState<IntegrationError[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);

  const fetchServiceEmail = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "google_service_account_email")
      .maybeSingle();
    if (data) setServiceEmail(data.value);
    setServiceEmailLoaded(true);
  };

  const fetchApiConfig = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["orio_api_enabled", "orio_api_token", "orio_account_number"]);
    if (data) {
      data.forEach((d) => {
        if (d.key === "orio_api_enabled") setApiEnabled(d.value === "true");
        if (d.key === "orio_api_token") setApiKey(d.value);
        if (d.key === "orio_account_number") setApiAccountNumber(d.value);
      });
    }
    setApiLoaded(true);
  };

  const saveApiConfig = async () => {
    setApiSaving(true);
    const now = new Date().toISOString();
    const settings = [
      { key: "orio_api_enabled", value: String(apiEnabled), updated_at: now },
      { key: "orio_api_token", value: apiKey, updated_at: now },
      { key: "orio_account_number", value: apiAccountNumber, updated_at: now },
    ];
    const { error } = await supabase
      .from("app_settings")
      .upsert(settings, { onConflict: "key" });
    if (error) {
      toast.error("Error saving API configuration");
    } else {
      toast.success("API configuration saved");
    }
    setApiSaving(false);
  };

  const saveServiceEmail = async () => {
    setServiceEmailSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert(
        { key: "google_service_account_email", value: serviceEmail, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) {
      toast.error("Error saving service email");
    } else {
      toast.success("Service account email saved");
    }
    setServiceEmailSaving(false);
  };

  const copyEmail = () => {
    navigator.clipboard.writeText(serviceEmail);
    setCopied(true);
    toast.success("Email copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchSheets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("integration_sheets")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Error loading integrations");
      setLoading(false);
      return;
    }

    const sellerIds = [...new Set((data || []).map((s) => s.seller_id))];
    let sellerMap: Record<string, string> = {};
    if (sellerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", sellerIds);
      profiles?.forEach((p) => { sellerMap[p.user_id] = p.name; });
    }

    setSheets(
      (data || []).map((s) => ({
        ...s,
        seller_name: sellerMap[s.seller_id] || "Unassigned",
      }))
    );
    setLoading(false);
  };

  const fetchSellers = async () => {
    const { data } = await supabase.from("user_roles").select("user_id, role").eq("role", "seller");
    if (data && data.length > 0) {
      const userIds = data.map((d) => d.user_id);
      const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", userIds);
      setSellers(profiles || []);
    }
  };

  useEffect(() => {
    fetchSheets();
    fetchSellers();
    fetchServiceEmail();
    fetchApiConfig();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", sheet_name: "", sheet_url: "", seller_id: "" });
    setModalOpen(true);
  };

  const openEdit = (sheet: IntegrationSheet) => {
    setEditing(sheet);
    setForm({ name: sheet.name, sheet_name: sheet.sheet_name, sheet_url: sheet.sheet_url, seller_id: sheet.seller_id });
    setModalOpen(true);
  };

  const saveSheet = async () => {
    if (!form.name || !form.sheet_name) {
      toast.error("Please fill in Name and Sheet Name");
      return;
    }
    if (editing) {
      const { error } = await supabase
        .from("integration_sheets")
        .update({ name: form.name, sheet_name: form.sheet_name, sheet_url: form.sheet_url, seller_id: form.seller_id || editing.seller_id })
        .eq("id", editing.id);
      if (error) { toast.error("Error updating"); return; }
      toast.success("Integration updated");
    } else {
      if (!form.seller_id) { toast.error("Please select a seller"); return; }
      const { error } = await supabase.from("integration_sheets").insert({
        name: form.name, sheet_name: form.sheet_name, sheet_url: form.sheet_url, seller_id: form.seller_id,
      });
      if (error) { toast.error("Error creating"); return; }
      toast.success("Integration created");
    }
    setModalOpen(false);
    fetchSheets();
  };

  const deleteSheet = async (id: string) => {
    const { error } = await supabase.from("integration_sheets").delete().eq("id", id);
    if (error) { toast.error("Error deleting"); return; }
    toast.success("Integration deleted");
    fetchSheets();
  };

  const triggerSync = async () => {
    try {
      const { error } = await supabase.functions.invoke("import-sheets");
      if (error) throw error;
      toast.success("Import triggered successfully");
      setTimeout(fetchSheets, 3000);
    } catch {
      toast.error("Error triggering import");
    }
  };

  const viewErrors = async (sheet: IntegrationSheet) => {
    setErrorsSheet(sheet);
    setErrorsLoading(true);
    setErrorsModalOpen(true);
    const { data } = await supabase
      .from("integration_errors")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("created_at", { ascending: false });
    setErrors((data as IntegrationError[]) || []);
    setErrorsLoading(false);
  };

  const filtered = sheets.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.sheet_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.seller_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const totalOrders = sheets.reduce((s, sh) => s + sh.orders_count, 0);
  const totalErrors = sheets.reduce((s, sh) => s + sh.errors_count, 0);
  const activeSheets = sheets.filter((s) => s.active).length;

  return (
    <div className="max-w-[1200px] space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Integrations</h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            Manage Google Sheets connected to the system for automatic order import
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={triggerSync} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Import Now
          </Button>
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Create
          </Button>
        </div>
      </div>

      {/* API Configuration */}
      {apiLoaded && (
        <div className="bg-card border rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 rounded-lg p-2">
                <Globe className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold">API Configuration</p>
                <p className="text-xs text-muted-foreground">ORIO OMS API settings for order fulfillment</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{apiEnabled ? "Enabled" : "Disabled"}</span>
              <Switch checked={apiEnabled} onCheckedChange={async (checked) => {
                setApiEnabled(checked);
                // Auto-save the enabled state immediately
                const now = new Date().toISOString();
                await supabase
                  .from("app_settings")
                  .upsert({ key: "orio_api_enabled", value: String(checked), updated_at: now }, { onConflict: "key" });
                toast.success(checked ? "ORIO API activated" : "ORIO API deactivated");
              }} />
            </div>
          </div>

          <div className="space-y-3 pt-2 border-t">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Key className="w-3 h-3" /> API Key / Token
                </Label>
                <Input
                  className="h-9 text-xs font-mono"
                  type="password"
                  placeholder="Enter API token..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <Hash className="w-3 h-3" /> Account Number
                </Label>
                <Input
                  className="h-9 text-xs font-mono"
                  placeholder="Enter account number..."
                  value={apiAccountNumber}
                  onChange={(e) => setApiAccountNumber(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={saveApiConfig} disabled={apiSaving}>
                {apiSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save API Settings
              </Button>
            </div>
          </div>
        </div>
      )}

      {serviceEmailLoaded && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
          <div className="bg-primary/10 rounded-lg p-2">
            <Mail className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <p className="text-xs font-semibold">Google Service Account Email</p>
            <div className="flex items-center gap-2">
              <Input
                className="h-8 text-xs flex-1 max-w-md"
                placeholder="service-account@project.iam.gserviceaccount.com"
                value={serviceEmail}
                onChange={(e) => setServiceEmail(e.target.value)}
              />
              <Button size="sm" className="h-8 text-xs gap-1" onClick={saveServiceEmail} disabled={serviceEmailSaving}>
                {serviceEmailSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save
              </Button>
              {serviceEmail && (
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1 shrink-0" onClick={copyEmail}>
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              )}
            </div>
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

      {/* Search */}
      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, sheet, seller..." className="pl-9 h-9 text-xs" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {/* Sheets Table */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-dashed rounded-xl bg-muted/20">
          <div className="bg-muted rounded-full p-4 mb-4">
            <FileSpreadsheet className="w-8 h-8 text-muted-foreground/40" />
          </div>
          <p className="text-sm font-semibold text-muted-foreground">No integrations found</p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-[280px]">
            Click "Create" to connect a Google Sheet for a seller
          </p>
        </div>
      ) : (
        <div className="bg-card border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">ID</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Seller</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Sheet Name</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Orders</th>
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">With Errors</th>
                   <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last Check</th>
                   <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Last Row</th>
                   <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                   <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sheet, idx) => (
                  <tr key={sheet.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-4 text-sm text-muted-foreground">{idx + 1}</td>
                    <td className="px-4 py-4">
                      <span className="text-sm font-medium">
                        {sheet.seller_name === "Unassigned" ? (
                          <span className="italic text-muted-foreground">Not Selected</span>
                        ) : sheet.seller_name}
                      </span>
                    </td>
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
                       <Input
                         type="number"
                         min={1}
                         max={sheet.last_imported_row}
                         className="h-7 w-20 text-xs text-center tabular-nums"
                         defaultValue={sheet.last_imported_row}
                         onBlur={async (e) => {
                           const val = parseInt(e.target.value);
                           if (!val || val === sheet.last_imported_row) return;
                           if (val > sheet.last_imported_row) {
                             toast.error(`La valeur ne peut pas dépasser ${sheet.last_imported_row}`);
                             e.target.value = String(sheet.last_imported_row);
                             return;
                           }
                           const { error } = await supabase
                             .from("integration_sheets")
                             .update({ last_imported_row: val })
                             .eq("id", sheet.id);
                           if (error) { toast.error("Failed to update"); return; }
                           toast.success(`Last row updated to ${val}`);
                           fetchSheets();
                         }}
                         onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                       />
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
                           className="h-8 w-8 rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
                           disabled={syncing}
                           onClick={async () => {
                             setSyncing(true);
                             try {
                               const { data, error } = await supabase.functions.invoke("import-sheets");
                               if (error) throw error;
                               const results = data?.results || {};
                               let totalImported = 0;
                               let totalErrors = 0;
                               Object.values(results).forEach((r: any) => {
                                 totalImported += r.imported || 0;
                                 totalErrors += r.errors || 0;
                               });
                               await fetchSheets();
                               if (totalImported > 0 || totalErrors > 0) {
                                 toast.success(`Sync: ${totalImported} imported, ${totalErrors} errors`);
                               } else {
                                 toast.info("No new orders found");
                               }
                             } catch { toast.error("Sync failed"); }
                             finally { setSyncing(false); }
                           }}
                           title="Fetch orders"
                         >
                           <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
                         </Button>
                         <Button
                           variant="ghost"
                           size="icon"
                           className="h-8 w-8 rounded-full bg-primary/10 text-primary hover:bg-primary/20"
                           onClick={() => openEdit(sheet)}
                           title="Edit"
                         >
                           <Pencil className="w-3.5 h-3.5" />
                         </Button>
                         <Button
                           variant="ghost"
                           size="icon"
                           className="h-8 w-8 rounded-full bg-destructive/10 text-destructive hover:bg-destructive/20"
                           onClick={() => deleteSheet(sheet.id)}
                           title="Delete"
                         >
                           <Trash2 className="w-3.5 h-3.5" />
                         </Button>
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">{editing ? "Edit Integration" : "New Integration"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Seller *</Label>
              <Select value={form.seller_id} onValueChange={(v) => setForm((f) => ({ ...f, seller_id: v }))}>
                <SelectTrigger className="text-sm"><SelectValue placeholder="Select a seller" /></SelectTrigger>
                <SelectContent>
                  {sellers.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id} className="text-sm">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Integration Name *</Label>
              <Input className="text-sm" placeholder="e.g. Main Orders Sheet" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Sheet Name</Label>
              <Input className="text-sm" placeholder="e.g. Sheet1" value={form.sheet_name} onChange={(e) => setForm((f) => ({ ...f, sheet_name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Google Sheet URL *</Label>
              <Input className="text-sm" placeholder="https://docs.google.com/spreadsheets/d/..." value={form.sheet_url} onChange={(e) => setForm((f) => ({ ...f, sheet_url: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={saveSheet}>{editing ? "Save Changes" : "Create"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Errors Modal */}
      <Dialog open={errorsModalOpen} onOpenChange={setErrorsModalOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              Failed Orders — {errorsSheet?.name}
              {errors.length > 0 && (
                <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[11px]">
                  {errors.length} error{errors.length > 1 ? "s" : ""}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto -mx-6 px-6">
            {errorsLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : errors.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="bg-emerald-500/10 rounded-full p-3 mb-3">
                  <FileSpreadsheet className="w-6 h-6 text-emerald-500" />
                </div>
                <p className="text-sm font-medium">No errors found</p>
                <p className="text-xs text-muted-foreground mt-1">All orders imported successfully</p>
              </div>
            ) : (
              <div className="space-y-3">
                {errors.map((err, idx) => {
                  const od = err.order_data as Record<string, unknown> | null;
                  return (
                    <div key={err.id} className="border rounded-xl overflow-hidden">
                      <div className="bg-destructive/5 border-b border-destructive/15 px-4 py-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="bg-destructive/15 text-destructive text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                            {idx + 1}
                          </span>
                          <p className="text-xs font-semibold text-destructive">{err.error_message}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                          {formatDistanceToNow(new Date(err.created_at), { addSuffix: true })}
                        </span>
                      </div>
                      {od && (
                        <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2">
                          {od.customer_name && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Customer</p>
                              <p className="text-xs font-medium mt-0.5">{String(od.customer_name)}</p>
                            </div>
                          )}
                          {od.phone && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Phone</p>
                              <p className="text-xs font-medium mt-0.5">{String(od.phone)}</p>
                            </div>
                          )}
                          {od.city && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">City</p>
                              <p className="text-xs font-medium mt-0.5">{String(od.city)}</p>
                            </div>
                          )}
                          {od.product_name && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Product</p>
                              <p className="text-xs font-medium mt-0.5">{String(od.product_name)}</p>
                            </div>
                          )}
                          {od.sku && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">SKU</p>
                              <p className="text-xs font-mono font-medium mt-0.5 text-destructive">{String(od.sku)}</p>
                            </div>
                          )}
                          {od.quantity && (
                            <div>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Qty × Price</p>
                              <p className="text-xs font-medium mt-0.5">
                                {String(od.quantity)} × {od.unit_price ? String(od.unit_price) : "—"} PKR
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
