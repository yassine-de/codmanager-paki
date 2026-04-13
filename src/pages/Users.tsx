import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Shield, Store, Headphones, UserCog } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mockProducts } from "@/lib/products-data";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";

interface UserData {
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  created_at: string;
  role: string;
  permissions: string[];
  rates: { rate_1kg: number; rate_2kg: number; rate_3kg: number } | null;
  rate_settings: { dropped_order_rate: number; confirmed_order_rate: number; cod_fee_per_delivery: number } | null;
}

interface Permission {
  key: string;
  label: string;
  description: string | null;
}

const roleConfig: Record<string, { label: string; icon: typeof Shield; color: string }> = {
  admin: { label: "Admin", icon: Shield, color: "bg-primary/10 text-primary border-primary/20" },
  seller: { label: "Seller", icon: Store, color: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  agent: { label: "Agent", icon: Headphones, color: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  custom: { label: "Custom", icon: UserCog, color: "bg-purple-500/10 text-purple-600 border-purple-500/20" },
};

const Users = () => {
  const [users, setUsers] = useState<UserData[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    phone: "",
    role: "seller" as string,
    rate_1kg: "",
    rate_2kg: "",
    rate_3kg: "",
    dropped_order_rate: "",
    confirmed_order_rate: "",
    cod_fee_per_delivery: "",
    selectedPermissions: [] as string[],
    customRoleName: "",
    agentProductScope: "all" as "all" | "specific",
    agentProducts: [] as string[],
  });

  useEffect(() => {
    fetchUsers();
    fetchPermissions();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("manage-users", {
      body: { action: "list-users" },
    });
    if (error) {
      toast.error("Erreur de chargement des utilisateurs");
      console.error(error);
    } else {
      setUsers(data.users || []);
    }
    setLoading(false);
  };

  const fetchPermissions = async () => {
    const { data } = await supabase.from("permissions").select("*").order("key");
    if (data) setPermissions(data);
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      name: "", email: "", password: "", phone: "",
      role: "seller", rate_1kg: "", rate_2kg: "", rate_3kg: "",
      dropped_order_rate: "0.2", confirmed_order_rate: "0.3", cod_fee_per_delivery: "",
      selectedPermissions: [], customRoleName: "",
      agentProductScope: "all", agentProducts: [],
    });
    setModalOpen(true);
  };

  const openEdit = async (user: UserData) => {
    setEditingUser(user);

    // Load agent product assignments
    let agentProductScope: "all" | "specific" = "all";
    let agentProducts: string[] = [];
    if (user.role === "agent") {
      const { data } = await supabase
        .from("agent_products")
        .select("product_name")
        .eq("agent_id", user.user_id);
      if (data && data.length > 0) {
        agentProductScope = "specific";
        agentProducts = data.map(d => d.product_name);
      }
    }

    setForm({
      name: user.name,
      email: user.email,
      password: "",
      phone: user.phone || "",
      role: user.role,
      rate_1kg: user.rates?.rate_1kg?.toString() || "",
      rate_2kg: user.rates?.rate_2kg?.toString() || "",
      rate_3kg: user.rates?.rate_3kg?.toString() || "",
      dropped_order_rate: user.rate_settings?.dropped_order_rate?.toString() || "",
      confirmed_order_rate: user.rate_settings?.confirmed_order_rate?.toString() || "",
      cod_fee_per_delivery: user.rate_settings?.cod_fee_per_delivery?.toString() || "",
      selectedPermissions: user.permissions || [],
      customRoleName: "",
      agentProductScope,
      agentProducts,
    });
    setModalOpen(true);
  };

  const saveAgentProducts = async (agentId: string) => {
    // Delete existing assignments
    await supabase.from("agent_products").delete().eq("agent_id", agentId);
    // Insert new ones if specific scope
    if (form.agentProductScope === "specific" && form.agentProducts.length > 0) {
      await supabase.from("agent_products").insert(
        form.agentProducts.map(name => ({ agent_id: agentId, product_name: name }))
      );
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.email || (!editingUser && !form.password)) {
      toast.error("Remplis tous les champs obligatoires");
      return;
    }

    setSaving(true);
    try {
      if (editingUser) {
        const { error } = await supabase.functions.invoke("manage-users", {
          body: {
            action: "update-user",
            userId: editingUser.user_id,
            name: form.name,
            phone: form.phone,
            role: form.role,
            rates: form.role === "seller" ? {
              rate_1kg: Number(form.rate_1kg) || 0,
              rate_2kg: Number(form.rate_2kg) || 0,
              rate_3kg: Number(form.rate_3kg) || 0,
            } : undefined,
            rateSettings: form.role === "seller" ? {
              dropped_order_rate: Number(form.dropped_order_rate) || 0,
              confirmed_order_rate: Number(form.confirmed_order_rate) || 0,
              cod_fee_per_delivery: Number(form.cod_fee_per_delivery) || 0,
            } : undefined,
            permissions: form.role === "custom" ? form.selectedPermissions : undefined,
          },
        });
        if (error) throw error;

        // Save agent product assignments
        if (form.role === "agent") {
          await saveAgentProducts(editingUser.user_id);
        }

        toast.success("Utilisateur modifié");
      } else {
        const { data, error } = await supabase.functions.invoke("manage-users", {
          body: {
            action: "create-user",
            email: form.email,
            password: form.password,
            name: form.name,
            phone: form.phone,
            role: form.role,
            rates: form.role === "seller" ? {
              rate_1kg: Number(form.rate_1kg) || 0,
              rate_2kg: Number(form.rate_2kg) || 0,
              rate_3kg: Number(form.rate_3kg) || 0,
            } : undefined,
            rateSettings: form.role === "seller" ? {
              dropped_order_rate: Number(form.dropped_order_rate) || 0,
              confirmed_order_rate: Number(form.confirmed_order_rate) || 0,
              cod_fee_per_delivery: Number(form.cod_fee_per_delivery) || 0,
            } : undefined,
            permissions: form.role === "custom" ? form.selectedPermissions : undefined,
          },
        });
        if (error || data?.error) throw new Error(data?.error || error?.message);

        // Save agent product assignments for new user
        if (form.role === "agent" && data?.userId) {
          await saveAgentProducts(data.userId);
        }

        toast.success("Utilisateur créé");
      }
      setModalOpen(false);
      fetchUsers();
    } catch (err: any) {
      toast.error(err.message || "Erreur");
    }
    setSaving(false);
  };

  const handleDelete = async (userId: string) => {
    const { error } = await supabase.functions.invoke("manage-users", {
      body: { action: "delete-user", userId },
    });
    if (error) {
      toast.error("Erreur de suppression");
    } else {
      toast.success("Utilisateur supprimé");
      fetchUsers();
    }
  };

  const toggleActive = async (user: UserData) => {
    await supabase.functions.invoke("manage-users", {
      body: {
        action: "update-user",
        userId: user.user_id,
        active: !user.active,
      },
    });
    toast.success(user.active ? "Utilisateur désactivé" : "Utilisateur activé");
    fetchUsers();
  };

  const togglePermission = (key: string) => {
    setForm((prev) => ({
      ...prev,
      selectedPermissions: prev.selectedPermissions.includes(key)
        ? prev.selectedPermissions.filter((k) => k !== key)
        : [...prev.selectedPermissions, key],
    }));
  };

  // Group permissions by category (prefix before underscore pattern)
  const groupedPermissions = permissions.reduce((groups, perm) => {
    // Extract category: access_to_X -> X, verb_noun -> noun
    let category = "other";
    if (perm.key.startsWith("access_to_")) {
      category = "access";
    } else if (perm.key.startsWith("view_") || perm.key.startsWith("show_")) {
      category = "view";
    } else if (perm.key.startsWith("create_")) {
      category = "create";
    } else if (perm.key.startsWith("update_")) {
      category = "update";
    } else if (perm.key.startsWith("delete_")) {
      category = "delete";
    }
    if (!groups[category]) groups[category] = [];
    groups[category].push(perm);
    return groups;
  }, {} as Record<string, Permission[]>);

  const categoryLabels: Record<string, string> = {
    access: "Accès aux pages",
    view: "Consultation",
    create: "Création",
    update: "Modification",
    delete: "Suppression",
    other: "Autres",
  };

  const categoryOrder = ["access", "view", "create", "update", "delete", "other"];

  const RoleBadge = ({ role }: { role: string }) => {
    const config = roleConfig[role] || roleConfig.custom;
    const Icon = config.icon;
    return (
      <Badge className={`${config.color} text-[10px] gap-1`}>
        <Icon className="h-2.5 w-2.5" />
        {config.label}
      </Badge>
    );
  };

  const [filterRole, setFilterRole] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const filteredUsers = users.filter((u) => {
    if (filterRole !== "all" && u.role !== filterRole) return false;
    if (filterStatus === "active" && !u.active) return false;
    if (filterStatus === "inactive" && u.active) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight">Utilisateurs</h1>
          <p className="text-xs text-muted-foreground mt-0.5">Gérer tous les comptes du système</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Créer Utilisateur
        </Button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Rôle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Tous les rôles</SelectItem>
            <SelectItem value="admin" className="text-xs">Admin</SelectItem>
            <SelectItem value="seller" className="text-xs">Seller</SelectItem>
            <SelectItem value="agent" className="text-xs">Agent</SelectItem>
            <SelectItem value="custom" className="text-xs">Custom</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Statut" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">Tous</SelectItem>
            <SelectItem value="active" className="text-xs">Actif</SelectItem>
            <SelectItem value="inactive" className="text-xs">Inactif</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-[11px] text-muted-foreground ml-1">{filteredUsers.length} utilisateur(s)</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-md border-0 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-[11px] font-semibold h-9">Statut</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Nom</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Email</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Rôle</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Téléphone</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9">Créé le</TableHead>
                    <TableHead className="text-[11px] font-semibold h-9 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.user_id} className={`hover:bg-muted/30 ${!u.active ? "opacity-50" : ""}`}>
                      <TableCell className="py-2.5">
                        <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} className="scale-75" />
                      </TableCell>
                      <TableCell className="text-xs font-medium py-2.5">{u.name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">{u.email}</TableCell>
                      <TableCell className="py-2.5">
                        <RoleBadge role={u.role} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">{u.phone || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground py-2.5">
                        {new Date(u.created_at).toLocaleDateString("fr-FR")}
                      </TableCell>
                      <TableCell className="text-right py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(u)}>
                            <Pencil className="h-3 w-3 text-primary" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDelete(u.user_id)}>
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredUsers.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                        Aucun utilisateur. Cliquez sur "Créer Utilisateur" pour commencer.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingUser ? "Modifier Utilisateur" : "Créer Utilisateur"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Nom complet *</Label>
                <Input className="h-9 text-xs" placeholder="Nom complet" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Email (Gmail) *</Label>
                <Input className="h-9 text-xs" type="email" placeholder="user@gmail.com" value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={!!editingUser} />
              </div>
            </div>

            {!editingUser && (
              <div className="space-y-1.5">
                <Label className="text-xs">Mot de passe *</Label>
                <Input className="h-9 text-xs" type="text" placeholder="Mot de passe" value={form.password}
                  onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Téléphone</Label>
                <Input className="h-9 text-xs" type="tel" placeholder="+212 6 XX XX XX XX" value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Rôle *</Label>
                <Select value={form.role} onValueChange={(v) => setForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin" className="text-xs">Admin</SelectItem>
                    <SelectItem value="seller" className="text-xs">Seller</SelectItem>
                    <SelectItem value="agent" className="text-xs">Agent</SelectItem>
                    <SelectItem value="custom" className="text-xs">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Seller rates */}
            {form.role === "seller" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Tarifs par poids ($)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">1 Kg</Label>
                      <Input className="h-9 text-xs" type="number" placeholder="35" value={form.rate_1kg}
                        onChange={(e) => setForm((f) => ({ ...f, rate_1kg: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">2 Kg</Label>
                      <Input className="h-9 text-xs" type="number" placeholder="45" value={form.rate_2kg}
                        onChange={(e) => setForm((f) => ({ ...f, rate_2kg: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">3 Kg</Label>
                      <Input className="h-9 text-xs" type="number" placeholder="55" value={form.rate_3kg}
                        onChange={(e) => setForm((f) => ({ ...f, rate_3kg: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Tarifs de confirmation ($)</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Dropped Lead</Label>
                      <Input className="h-9 text-xs" type="number" step="0.01" placeholder="0" value={form.dropped_order_rate}
                        onChange={(e) => setForm((f) => ({ ...f, dropped_order_rate: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">Confirmed Lead</Label>
                      <Input className="h-9 text-xs" type="number" step="0.01" placeholder="0" value={form.confirmed_order_rate}
                        onChange={(e) => setForm((f) => ({ ...f, confirmed_order_rate: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-muted-foreground">COD Fees (%)</Label>
                      <Input className="h-9 text-xs" type="number" step="0.01" placeholder="5" value={form.cod_fee_per_delivery}
                        onChange={(e) => setForm((f) => ({ ...f, cod_fee_per_delivery: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Agent product scope */}
            {form.role === "agent" && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold">Produits assignés</Label>
                <Select
                  value={form.agentProductScope}
                  onValueChange={(v: "all" | "specific") => setForm((f) => ({ ...f, agentProductScope: v, agentProducts: v === "all" ? [] : f.agentProducts }))}
                >
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all" className="text-xs">Tous les produits</SelectItem>
                    <SelectItem value="specific" className="text-xs">Produits spécifiques</SelectItem>
                  </SelectContent>
                </Select>
                {form.agentProductScope === "specific" && (
                  <div className="space-y-1.5">
                    <Label className="text-[10px] text-muted-foreground">Sélectionnez les produits</Label>
                    <ScrollArea className="h-40 rounded-md border border-input bg-background p-2">
                      {[...new Set(mockProducts.map(p => p.name))].sort().map((productName) => (
                        <label key={productName} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-accent cursor-pointer">
                          <Checkbox
                            checked={form.agentProducts.includes(productName)}
                            onCheckedChange={(checked) => {
                              setForm((f) => ({
                                ...f,
                                agentProducts: checked
                                  ? [...f.agentProducts, productName]
                                  : f.agentProducts.filter((p) => p !== productName),
                              }));
                            }}
                          />
                          <span className="text-xs">{productName}</span>
                        </label>
                      ))}
                    </ScrollArea>
                    <p className="text-[10px] text-muted-foreground">
                      {form.agentProducts.length} produit(s) sélectionné(s)
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Custom permissions - chip style */}
            {form.role === "custom" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Role Name</Label>
                  <Input className="h-9 text-xs border-amber-400 focus-visible:ring-amber-400" placeholder="Nom du rôle personnalisé" value={form.customRoleName}
                    onChange={(e) => setForm((f) => ({ ...f, customRoleName: e.target.value }))} />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">Select Permissions:</Label>
                  <div className="space-y-3">
                    {categoryOrder.map((cat) => {
                      const perms = groupedPermissions[cat];
                      if (!perms || perms.length === 0) return null;
                      return (
                        <div key={cat} className="space-y-1.5">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                            {categoryLabels[cat]}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {perms.map((perm) => {
                              const isSelected = form.selectedPermissions.includes(perm.key);
                              return (
                                <button
                                  key={perm.key}
                                  type="button"
                                  onClick={() => togglePermission(perm.key)}
                                  className={`
                                    inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium
                                    border transition-all cursor-pointer select-none
                                    ${isSelected
                                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                                    }
                                  `}
                                >
                                  {perm.key}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                  {form.selectedPermissions.length} permission(s) sélectionnée(s)
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setModalOpen(false)}>
              Annuler
            </Button>
            <Button size="sm" className="text-xs gap-1.5" onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="h-3 w-3 animate-spin" />}
              {editingUser ? "Sauvegarder" : "Créer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Users;
