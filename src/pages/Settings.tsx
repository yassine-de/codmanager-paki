import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Shield, Store, Headphones, Eye, EyeOff } from "lucide-react";
import { mockAdmin, mockSellers, mockAgents, SellerUser, AgentUser } from "@/lib/settings-data";
import { toast } from "sonner";

const Settings = () => {
  const [sellers, setSellers] = useState<SellerUser[]>(mockSellers);
  const [agents, setAgents] = useState<AgentUser[]>(mockAgents);

  // Seller modal
  const [sellerModalOpen, setSellerModalOpen] = useState(false);
  const [editingSeller, setEditingSeller] = useState<SellerUser | null>(null);
  const [sellerForm, setSellerForm] = useState({ name: '', email: '', password: '', rate1kg: '', rate2kg: '', rate3kg: '' });

  // Agent modal
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentUser | null>(null);
  const [agentForm, setAgentForm] = useState({ name: '', email: '', password: '', phone: '' });

  // Password visibility
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});

  const togglePasswordVisibility = (id: string) => {
    setVisiblePasswords(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Toggle active
  const toggleSellerActive = (id: string) => {
    setSellers(prev => prev.map(s => s.id === id ? { ...s, active: !s.active } : s));
    const seller = sellers.find(s => s.id === id);
    toast.success(seller?.active ? "Seller désactivé" : "Seller activé");
  };

  const toggleAgentActive = (id: string) => {
    setAgents(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a));
    const agent = agents.find(a => a.id === id);
    toast.success(agent?.active ? "Agent désactivé" : "Agent activé");
  };

  // Seller CRUD
  const openCreateSeller = () => {
    setEditingSeller(null);
    setSellerForm({ name: '', email: '', password: '', rate1kg: '', rate2kg: '', rate3kg: '' });
    setSellerModalOpen(true);
  };

  const openEditSeller = (seller: SellerUser) => {
    setEditingSeller(seller);
    setSellerForm({
      name: seller.name,
      email: seller.email,
      password: seller.password,
      rate1kg: String(seller.rates.rate1kg),
      rate2kg: String(seller.rates.rate2kg),
      rate3kg: String(seller.rates.rate3kg),
    });
    setSellerModalOpen(true);
  };

  const saveSeller = () => {
    if (!sellerForm.name || !sellerForm.email || !sellerForm.password || !sellerForm.rate1kg) {
      toast.error("Rempli tous les champs obligatoires");
      return;
    }
    const rates = {
      rate1kg: Number(sellerForm.rate1kg) || 0,
      rate2kg: Number(sellerForm.rate2kg) || 0,
      rate3kg: Number(sellerForm.rate3kg) || 0,
    };
    if (editingSeller) {
      setSellers(prev => prev.map(s => s.id === editingSeller.id ? {
        ...s,
        name: sellerForm.name,
        email: sellerForm.email,
        password: sellerForm.password,
        rates,
      } : s));
      toast.success("Seller modifié avec succès");
    } else {
      const newSeller: SellerUser = {
        id: `seller-${Date.now()}`,
        name: sellerForm.name,
        email: sellerForm.email,
        password: sellerForm.password,
        rates,
        active: true,
        role: 'seller',
        createdAt: new Date().toISOString().split('T')[0],
      };
      setSellers(prev => [...prev, newSeller]);
      toast.success("Seller créé avec succès");
    }
    setSellerModalOpen(false);
  };

  const deleteSeller = (id: string) => {
    setSellers(prev => prev.filter(s => s.id !== id));
    toast.success("Seller supprimé");
  };

  // Agent CRUD
  const openCreateAgent = () => {
    setEditingAgent(null);
    setAgentForm({ name: '', email: '', password: '', phone: '' });
    setAgentModalOpen(true);
  };

  const openEditAgent = (agent: AgentUser) => {
    setEditingAgent(agent);
    setAgentForm({ name: agent.name, email: agent.email, password: agent.password, phone: agent.phone });
    setAgentModalOpen(true);
  };

  const saveAgent = () => {
    if (!agentForm.name || !agentForm.email || !agentForm.password || !agentForm.phone) {
      toast.error("Rempli tous les champs");
      return;
    }
    if (editingAgent) {
      setAgents(prev => prev.map(a => a.id === editingAgent.id ? { ...a, ...agentForm } : a));
      toast.success("Agent modifié avec succès");
    } else {
      const newAgent: AgentUser = {
        id: `agent-${Date.now()}`,
        ...agentForm,
        active: true,
        role: 'agent',
        createdAt: new Date().toISOString().split('T')[0],
      };
      setAgents(prev => [...prev, newAgent]);
      toast.success("Agent créé avec succès");
    }
    setAgentModalOpen(false);
  };

  const deleteAgent = (id: string) => {
    setAgents(prev => prev.filter(a => a.id !== id));
    toast.success("Agent supprimé");
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-foreground tracking-tight">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Gérer les rôles et les utilisateurs</p>
      </div>

      <Tabs defaultValue="admin" className="space-y-4">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="admin" className="text-xs gap-1.5">
            <Shield className="h-3.5 w-3.5" /> Admin
          </TabsTrigger>
          <TabsTrigger value="sellers" className="text-xs gap-1.5">
            <Store className="h-3.5 w-3.5" /> Sellers
          </TabsTrigger>
          <TabsTrigger value="agents" className="text-xs gap-1.5">
            <Headphones className="h-3.5 w-3.5" /> Agents
          </TabsTrigger>
        </TabsList>

        {/* Admin Tab */}
        <TabsContent value="admin">
          <Card>
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm">Admin Principal</CardTitle>
              <CardDescription className="text-xs">Vous êtes l'administrateur principal de la plateforme</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-muted/40 border">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <Shield className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{mockAdmin.name}</p>
                  <p className="text-xs text-muted-foreground">{mockAdmin.email}</p>
                </div>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Admin</Badge>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sellers Tab */}
        <TabsContent value="sellers">
          <Card>
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Sellers</CardTitle>
                <CardDescription className="text-xs">{sellers.length} seller(s) enregistré(s)</CardDescription>
              </div>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreateSeller}>
                <Plus className="h-3.5 w-3.5" /> Ajouter Seller
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-[11px] font-semibold h-9">Statut</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Nom</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Email</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Mot de passe</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">1 Kg</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">2 Kg</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">3 Kg</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Créé le</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellers.map(seller => (
                      <TableRow key={seller.id} className={`hover:bg-muted/30 ${!seller.active ? 'opacity-50' : ''}`}>
                        <TableCell className="py-2.5">
                          <Switch
                            checked={seller.active}
                            onCheckedChange={() => toggleSellerActive(seller.id)}
                            className="scale-75"
                          />
                        </TableCell>
                        <TableCell className="text-xs font-medium py-2.5">{seller.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2.5">{seller.email}</TableCell>
                        <TableCell className="text-xs py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px]">
                              {visiblePasswords[seller.id] ? seller.password : '••••••••'}
                            </span>
                            <button onClick={() => togglePasswordVisibility(seller.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                              {visiblePasswords[seller.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="secondary" className="text-[10px] font-semibold">{seller.rates.rate1kg} $</Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="secondary" className="text-[10px] font-semibold">{seller.rates.rate2kg} $</Badge>
                        </TableCell>
                        <TableCell className="py-2.5">
                          <Badge variant="secondary" className="text-[10px] font-semibold">{seller.rates.rate3kg} $</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2.5">{seller.createdAt}</TableCell>
                        <TableCell className="text-right py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditSeller(seller)}>
                              <Pencil className="h-3 w-3 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteSeller(seller.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {sellers.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={9} className="text-center py-8 text-xs text-muted-foreground">
                          Aucun seller. Cliquez sur "Ajouter Seller" pour commencer.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Agents Tab */}
        <TabsContent value="agents">
          <Card>
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Agents de Confirmation</CardTitle>
                <CardDescription className="text-xs">{agents.length} agent(s) enregistré(s)</CardDescription>
              </div>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={openCreateAgent}>
                <Plus className="h-3.5 w-3.5" /> Ajouter Agent
              </Button>
            </CardHeader>
            <CardContent className="p-4 pt-2">
              <div className="rounded-md border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40">
                      <TableHead className="text-[11px] font-semibold h-9">Statut</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Nom</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Email</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Mot de passe</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Téléphone</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9">Créé le</TableHead>
                      <TableHead className="text-[11px] font-semibold h-9 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map(agent => (
                      <TableRow key={agent.id} className={`hover:bg-muted/30 ${!agent.active ? 'opacity-50' : ''}`}>
                        <TableCell className="py-2.5">
                          <Switch
                            checked={agent.active}
                            onCheckedChange={() => toggleAgentActive(agent.id)}
                            className="scale-75"
                          />
                        </TableCell>
                        <TableCell className="text-xs font-medium py-2.5">{agent.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2.5">{agent.email}</TableCell>
                        <TableCell className="text-xs py-2.5">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px]">
                              {visiblePasswords[agent.id] ? agent.password : '••••••••'}
                            </span>
                            <button onClick={() => togglePasswordVisibility(agent.id)} className="text-muted-foreground hover:text-foreground transition-colors">
                              {visiblePasswords[agent.id] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2.5">{agent.phone}</TableCell>
                        <TableCell className="text-xs text-muted-foreground py-2.5">{agent.createdAt}</TableCell>
                        <TableCell className="text-right py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditAgent(agent)}>
                              <Pencil className="h-3 w-3 text-primary" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteAgent(agent.id)}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                    {agents.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                          Aucun agent. Cliquez sur "Ajouter Agent" pour commencer.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Seller Modal */}
      <Dialog open={sellerModalOpen} onOpenChange={setSellerModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingSeller ? 'Modifier Seller' : 'Ajouter Seller'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nom complet</Label>
              <Input className="h-9 text-xs" placeholder="Nom du seller" value={sellerForm.name} onChange={e => setSellerForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email (Gmail)</Label>
              <Input className="h-9 text-xs" type="email" placeholder="seller@gmail.com" value={sellerForm.email} onChange={e => setSellerForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mot de passe</Label>
              <Input className="h-9 text-xs" type="text" placeholder="Mot de passe" value={sellerForm.password} onChange={e => setSellerForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Tarifs par poids ($)</Label>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">1 Kg</Label>
                  <Input className="h-9 text-xs" type="number" placeholder="35" value={sellerForm.rate1kg} onChange={e => setSellerForm(f => ({ ...f, rate1kg: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">2 Kg</Label>
                  <Input className="h-9 text-xs" type="number" placeholder="45" value={sellerForm.rate2kg} onChange={e => setSellerForm(f => ({ ...f, rate2kg: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">3 Kg</Label>
                  <Input className="h-9 text-xs" type="number" placeholder="55" value={sellerForm.rate3kg} onChange={e => setSellerForm(f => ({ ...f, rate3kg: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setSellerModalOpen(false)}>Annuler</Button>
            <Button size="sm" className="text-xs" onClick={saveSeller}>{editingSeller ? 'Sauvegarder' : 'Créer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Agent Modal */}
      <Dialog open={agentModalOpen} onOpenChange={setAgentModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">{editingAgent ? 'Modifier Agent' : 'Ajouter Agent'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nom complet</Label>
              <Input className="h-9 text-xs" placeholder="Nom de l'agent" value={agentForm.name} onChange={e => setAgentForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email (Gmail)</Label>
              <Input className="h-9 text-xs" type="email" placeholder="agent@gmail.com" value={agentForm.email} onChange={e => setAgentForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mot de passe</Label>
              <Input className="h-9 text-xs" type="text" placeholder="Mot de passe" value={agentForm.password} onChange={e => setAgentForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Téléphone</Label>
              <Input className="h-9 text-xs" type="tel" placeholder="+212 6 XX XX XX XX" value={agentForm.phone} onChange={e => setAgentForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setAgentModalOpen(false)}>Annuler</Button>
            <Button size="sm" className="text-xs" onClick={saveAgent}>{editingAgent ? 'Sauvegarder' : 'Créer'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Settings;
