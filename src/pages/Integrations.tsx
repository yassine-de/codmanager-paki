import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, RefreshCw, Search, Eye, ExternalLink, AlertTriangle, Loader2 } from "lucide-react";
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

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationSheet | null>(null);
  const [form, setForm] = useState({ name: "", sheet_name: "", sheet_url: "", seller_id: "" });

  // Errors modal
  const [errorsModalOpen, setErrorsModalOpen] = useState(false);
  const [errorsSheet, setErrorsSheet] = useState<IntegrationSheet | null>(null);
  const [errors, setErrors] = useState<IntegrationError[]>([]);
  const [errorsLoading, setErrorsLoading] = useState(false);

  const fetchSheets = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("integration_sheets")
      .select("*")
      .order("created_at", { ascending: true });

    if (error) {
      toast.error("Erreur lors du chargement des intégrations");
      setLoading(false);
      return;
    }

    // Fetch seller names
    const sellerIds = [...new Set((data || []).map((s) => s.seller_id))];
    let sellerMap: Record<string, string> = {};
    if (sellerIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", sellerIds);
      profiles?.forEach((p) => {
        sellerMap[p.user_id] = p.name;
      });
    }

    setSheets(
      (data || []).map((s) => ({
        ...s,
        seller_name: sellerMap[s.seller_id] || "Non assigné",
      }))
    );
    setLoading(false);
  };

  const fetchSellers = async () => {
    const { data } = await supabase
      .from("user_roles")
      .select("user_id, role")
      .eq("role", "seller");

    if (data && data.length > 0) {
      const userIds = data.map((d) => d.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", userIds);
      setSellers(profiles || []);
    }
  };

  useEffect(() => {
    fetchSheets();
    fetchSellers();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: "", sheet_name: "", sheet_url: "", seller_id: "" });
    setModalOpen(true);
  };

  const openEdit = (sheet: IntegrationSheet) => {
    setEditing(sheet);
    setForm({
      name: sheet.name,
      sheet_name: sheet.sheet_name,
      sheet_url: sheet.sheet_url,
      seller_id: sheet.seller_id,
    });
    setModalOpen(true);
  };

  const saveSheet = async () => {
    if (!form.name || !form.sheet_name) {
      toast.error("Rempli le nom et le nom du sheet");
      return;
    }

    if (editing) {
      const { error } = await supabase
        .from("integration_sheets")
        .update({
          name: form.name,
          sheet_name: form.sheet_name,
          sheet_url: form.sheet_url,
          seller_id: form.seller_id || editing.seller_id,
        })
        .eq("id", editing.id);

      if (error) {
        toast.error("Erreur lors de la modification");
        return;
      }
      toast.success("Intégration modifiée");
    } else {
      if (!form.seller_id) {
        toast.error("Sélectionne un seller");
        return;
      }
      const { error } = await supabase.from("integration_sheets").insert({
        name: form.name,
        sheet_name: form.sheet_name,
        sheet_url: form.sheet_url,
        seller_id: form.seller_id,
      });

      if (error) {
        toast.error("Erreur lors de la création");
        return;
      }
      toast.success("Intégration créée");
    }

    setModalOpen(false);
    fetchSheets();
  };

  const deleteSheet = async (id: string) => {
    const { error } = await supabase.from("integration_sheets").delete().eq("id", id);
    if (error) {
      toast.error("Erreur lors de la suppression");
      return;
    }
    toast.success("Intégration supprimée");
    fetchSheets();
  };

  const syncSheet = async (sheet: IntegrationSheet) => {
    // Update last_check timestamp
    await supabase
      .from("integration_sheets")
      .update({ last_check: new Date().toISOString() })
      .eq("id", sheet.id);
    toast.success(`Synchronisation de "${sheet.name}" lancée`);
    fetchSheets();
  };

  const viewErrors = async (sheet: IntegrationSheet) => {
    setErrorsSheet(sheet);
    setErrorsLoading(true);
    setErrorsModalOpen(true);

    const { data, error } = await supabase
      .from("integration_errors")
      .select("*")
      .eq("sheet_id", sheet.id)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Erreur lors du chargement des erreurs");
    }
    setErrors((data as IntegrationError[]) || []);
    setErrorsLoading(false);
  };

  const filtered = sheets.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.sheet_name.toLowerCase().includes(search.toLowerCase()) ||
      (s.seller_name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Intégrations</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Gérer les Google Sheets connectés au système
        </p>
      </div>

      {/* Search + Create */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Sheet ID, Name..."
            className="pl-9 h-9 text-xs"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button size="sm" className="h-9 text-xs gap-1.5 bg-primary" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Create
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="rounded-md border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">ID</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Marketer</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Name</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Sheet Name</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Orders</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">
                    <span className="bg-accent/60 px-2 py-0.5 rounded">With Errors</span>
                  </TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Last Check</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider">Status</TableHead>
                  <TableHead className="text-[11px] font-semibold h-10 uppercase tracking-wider text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12">
                      <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-xs text-muted-foreground">
                      Aucune intégration trouvée
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((sheet, idx) => (
                    <TableRow key={sheet.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs font-medium py-3">{idx + 1}</TableCell>
                      <TableCell className="text-xs py-3">
                        {sheet.seller_name === "Non assigné" ? (
                          <span className="italic text-muted-foreground">Not Selected</span>
                        ) : (
                          sheet.seller_name
                        )}
                      </TableCell>
                      <TableCell className="text-xs py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium">{sheet.name}</span>
                          {sheet.sheet_url && (
                            <a
                              href={sheet.sheet_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs py-3">{sheet.sheet_name}</TableCell>
                      <TableCell className="py-3">
                        <span className="text-xs font-semibold text-emerald-600">{sheet.orders_count}</span>
                      </TableCell>
                      <TableCell className="py-3">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`text-xs font-semibold ${
                              sheet.errors_count > 0 ? "text-red-500" : "text-muted-foreground"
                            }`}
                          >
                            {sheet.errors_count}
                          </span>
                          {sheet.errors_count > 0 && (
                            <button
                              onClick={() => viewErrors(sheet)}
                              className="text-muted-foreground hover:text-primary transition-colors"
                              title="Voir les erreurs"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-3">
                        {sheet.last_check
                          ? formatDistanceToNow(new Date(sheet.last_check), { addSuffix: true })
                          : "Jamais"}
                      </TableCell>
                      <TableCell className="py-3">
                        <Badge
                          className={`text-[10px] ${
                            sheet.active
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-red-100 text-red-700 border-red-200"
                          }`}
                        >
                          {sheet.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-emerald-50 hover:bg-emerald-100"
                            onClick={() => syncSheet(sheet)}
                            title="Synchroniser"
                          >
                            <RefreshCw className="h-3.5 w-3.5 text-emerald-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-purple-50 hover:bg-purple-100"
                            onClick={() => openEdit(sheet)}
                            title="Modifier"
                          >
                            <Pencil className="h-3.5 w-3.5 text-purple-600" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-full bg-red-50 hover:bg-red-100"
                            onClick={() => deleteSheet(sheet.id)}
                            title="Supprimer"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editing ? "Modifier l'intégration" : "Nouvelle intégration"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Seller</Label>
              <Select value={form.seller_id} onValueChange={(v) => setForm((f) => ({ ...f, seller_id: v }))}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Sélectionner un seller" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id} className="text-xs">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nom de l'intégration</Label>
              <Input
                className="h-9 text-xs"
                placeholder="ex: Google Sheet"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Nom du Sheet</Label>
              <Input
                className="h-9 text-xs"
                placeholder="ex: Youcan-Orders"
                value={form.sheet_name}
                onChange={(e) => setForm((f) => ({ ...f, sheet_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">URL du Sheet</Label>
              <Input
                className="h-9 text-xs"
                placeholder="https://docs.google.com/spreadsheets/d/..."
                value={form.sheet_url}
                onChange={(e) => setForm((f) => ({ ...f, sheet_url: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" className="text-xs" onClick={saveSheet}>
              {editing ? "Enregistrer" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Errors Modal */}
      <Dialog open={errorsModalOpen} onOpenChange={setErrorsModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Erreurs - {errorsSheet?.name}
            </DialogTitle>
          </DialogHeader>
          {errorsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : errors.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground">
              Aucune erreur trouvée
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-[11px] font-semibold h-9">#</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Données</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Erreur</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((err, idx) => (
                    <TableRow key={err.id} className="hover:bg-muted/30">
                      <TableCell className="text-xs py-2">{idx + 1}</TableCell>
                      <TableCell className="text-xs py-2 max-w-[200px]">
                        <pre className="text-[10px] bg-muted/50 p-1.5 rounded overflow-x-auto max-h-20">
                          {JSON.stringify(err.order_data, null, 2)}
                        </pre>
                      </TableCell>
                      <TableCell className="text-xs py-2 text-red-600 font-medium">
                        {err.error_message}
                      </TableCell>
                      <TableCell className="text-xs py-2 text-muted-foreground">
                        {new Date(err.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Integrations;
