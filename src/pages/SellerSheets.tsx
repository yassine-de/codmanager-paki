import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, ExternalLink, Eye, Loader2, FileSpreadsheet, RefreshCw, AlertTriangle, Mail } from "lucide-react";
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

export default function SellerSheets() {
  const { user } = useAuth();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [loading, setLoading] = useState(true);

  // Link modal
  const [linkOpen, setLinkOpen] = useState(false);
  const [form, setForm] = useState({ name: "", sheet_name: "", sheet_url: "" });
  const [saving, setSaving] = useState(false);

  // Errors modal
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

      {/* Service account email info */}
      {serviceEmail && (
        <div className="bg-muted/50 border rounded-lg p-3 flex items-start gap-2">
          <Mail className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-xs font-medium">Share your Google Sheet with this email for automatic import:</p>
            <p className="text-xs text-primary font-mono mt-0.5 select-all">{serviceEmail}</p>
          </div>
        </div>
      )}
        <Button size="sm" onClick={() => setLinkOpen(true)} className="gap-1.5">
          <Plus className="w-3.5 h-3.5" />
          Link Sheet
        </Button>
      </div>

      {/* Sheets list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : sheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileSpreadsheet className="w-10 h-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm font-medium text-muted-foreground">No sheets linked yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            Click "Link Sheet" to connect your Google Sheet
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Name</TableHead>
                <TableHead className="text-xs">Sheet</TableHead>
                <TableHead className="text-xs text-center">Orders</TableHead>
                <TableHead className="text-xs text-center">Errors</TableHead>
                <TableHead className="text-xs text-center">Status</TableHead>
                <TableHead className="text-xs">Last Sync</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sheets.map((sheet) => (
                <TableRow key={sheet.id}>
                  <TableCell className="text-xs font-medium">{sheet.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      {sheet.sheet_name || "—"}
                      {sheet.sheet_url && (
                        <a href={sheet.sheet_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-3 h-3 text-primary" />
                        </a>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-center font-medium">{sheet.orders_count}</TableCell>
                  <TableCell className="text-xs text-center">
                    {sheet.errors_count > 0 ? (
                      <button onClick={() => viewErrors(sheet)}
                        className="inline-flex items-center gap-1 text-destructive hover:underline">
                        <AlertTriangle className="w-3 h-3" />
                        {sheet.errors_count}
                      </button>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={sheet.active ? "default" : "secondary"} className="text-[10px]">
                      {sheet.active ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {sheet.last_check
                      ? formatDistanceToNow(new Date(sheet.last_check), { addSuffix: true })
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {sheet.errors_count > 0 && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => viewErrors(sheet)}>
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchSheets}>
                        <RefreshCw className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
            <DialogTitle className="text-base">
              Errors — {errorsSheet?.name}
            </DialogTitle>
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
