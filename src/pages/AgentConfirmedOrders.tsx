import { useMemo, useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CheckCircle2, Search, Package, MapPin, Pencil, DollarSign, Tag, Store, Video, ExternalLink, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const confirmationBadge: Record<string, { label: string; className: string }> = {
  confirmed: { label: "✅ Confirmed", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  cancelled: { label: "❌ Cancelled", className: "bg-destructive/10 text-destructive border-destructive/20" },
  postponed: { label: "⏰ Postponed", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  no_answer: { label: "📞 No Answer", className: "bg-muted text-muted-foreground border-border" },
  double: { label: "📋 Double", className: "bg-orange-500/10 text-orange-600 border-orange-500/20" },
  wrong_number: { label: "📵 Wrong Number", className: "bg-rose-500/10 text-rose-500 border-rose-500/20" },
};

const deliveryBadge: Record<string, { label: string; className: string }> = {
  shipped: { label: "📦 Shipped", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  in_transit: { label: "🚚 In Transit", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  with_courier: { label: "🏍️ With Courier", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  delivered: { label: "🎉 Delivered", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  paid: { label: "💰 Paid", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  returned: { label: "↩️ Returned", className: "bg-destructive/10 text-destructive border-destructive/20" },
  cancelled: { label: "❌ Cancelled", className: "bg-destructive/10 text-destructive border-destructive/20" },
  no_answer: { label: "📞 No Answer", className: "bg-muted text-muted-foreground border-border" },
  postponed: { label: "⏰ Postponed", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
};

const SHIPPED_STATUSES = ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned"];

const CONFIRMATION_OPTIONS = [
  { value: "confirmed", label: "Confirmed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "postponed", label: "Postponed" },
  { value: "no_answer", label: "No Answer" },
  { value: "double", label: "Double" },
  { value: "wrong_number", label: "Wrong Number" },
];

interface EditForm {
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_address: string;
  product_name: string;
  price: number;
  quantity: number;
  confirmation_status: string;
  note: string;
}

const AgentConfirmedOrders = () => {
  const { authUser } = useAuth();
  const userId = authUser?.id;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [filterConfirmation, setFilterConfirmation] = useState<string>("all");
  const [filterDelivery, setFilterDelivery] = useState<string>("all");
  const [editOrder, setEditOrder] = useState<any>(null);
  const [sellerProducts, setSellerProducts] = useState<{ id: string; name: string; price: number; product_url: string | null; video_url: string | null }[]>([]);
  const [editForm, setEditForm] = useState<EditForm>({
    customer_name: "",
    customer_phone: "",
    customer_city: "",
    customer_address: "",
    product_name: "",
    price: 0,
    quantity: 1,
    confirmation_status: "",
    note: "",
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["agent-treated-orders", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .or(`agent_id.eq.${userId},original_agent_id.eq.${userId}`)
        .neq("confirmation_status", "new")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editOrder) return;
      const totalAmount = editForm.price * editForm.quantity;
      const confirmed_at = editForm.confirmation_status === "confirmed" ? new Date().toISOString() : null;

      const { error } = await supabase
        .from("orders")
        .update({
          customer_name: editForm.customer_name.trim(),
          customer_phone: editForm.customer_phone.trim(),
          customer_city: editForm.customer_city.trim(),
          customer_address: editForm.customer_address.trim(),
          product_name: editForm.product_name.trim(),
          price: editForm.price,
          quantity: editForm.quantity,
          total_amount: totalAmount,
          confirmation_status: editForm.confirmation_status,
          confirmed_at,
          note: editForm.note.trim(),
        })
        .eq("id", editOrder.id);
      if (error) throw error;

      // Log changed fields
      if (userId) {
        const changes: { field: string; old_val: string; new_val: string }[] = [];
        const fields: (keyof EditForm)[] = ["customer_name", "customer_phone", "customer_city", "product_name", "price", "quantity", "confirmation_status"];
        for (const f of fields) {
          if (String(editOrder[f]) !== String(editForm[f])) {
            changes.push({ field: f, old_val: String(editOrder[f]), new_val: String(editForm[f]) });
          }
        }
        if (changes.length > 0) {
          await supabase.from("order_history").insert(
            changes.map((c) => ({
              order_id: editOrder.order_id,
              changed_by: userId,
              changed_by_role: "agent",
              field_changed: c.field,
              old_value: c.old_val,
              new_value: c.new_val,
            }))
          );
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-treated-orders"] });
      queryClient.invalidateQueries({ queryKey: ["agent-dashboard-orders"] });
      toast.success("Order updated successfully");
      setEditOrder(null);
    },
    onError: () => toast.error("Failed to update order"),
  });

  const filteredOrders = useMemo(() => {
    return orders.filter((o: any) => {
      if (filterConfirmation !== "all" && o.confirmation_status !== filterConfirmation) return false;
      if (filterDelivery !== "all" && (o.delivery_status || "none") !== filterDelivery) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return (
        o.order_id?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_city?.toLowerCase().includes(q) ||
        o.customer_phone?.includes(q) ||
        o.product_name?.toLowerCase().includes(q)
      );
    });
  }, [orders, search, filterConfirmation, filterDelivery]);

  const canEdit = (order: any) => !SHIPPED_STATUSES.includes(order.delivery_status || "");

  const openEdit = (order: any) => {
    setEditOrder(order);
    setEditForm({
      customer_name: order.customer_name || "",
      customer_phone: order.customer_phone || "",
      customer_city: order.customer_city || "",
      customer_address: order.customer_address || "",
      product_name: order.product_name || "",
      price: Number(order.price) || 0,
      quantity: order.quantity || 1,
      confirmation_status: order.confirmation_status || "",
      note: order.note || "",
    });
    // Fetch seller's products for links and add-item
    supabase
      .from("products")
      .select("id, name, price, product_url, video_url")
      .eq("seller_id", order.seller_id)
      .then(({ data }) => {
        setSellerProducts((data || []).map(p => ({ ...p, price: Number(p.price) })));
      });
  };

  const updateField = (field: keyof EditForm, value: string | number) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Treated Orders
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            All orders you've processed — {filteredOrders.length} total
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterConfirmation} onValueChange={setFilterConfirmation}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="Confirmation" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Confirmation</SelectItem>
              {CONFIRMATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterDelivery} onValueChange={setFilterDelivery}>
            <SelectTrigger className="h-9 w-[150px] text-xs">
              <SelectValue placeholder="Delivery" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Delivery</SelectItem>
              <SelectItem value="none">No Status</SelectItem>
              {Object.entries(deliveryBadge).map(([key, val]) => (
                <SelectItem key={key} value={key}>{val.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative w-full md:w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search orders..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 text-xs pl-9"
            />
          </div>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] w-[100px]">Order ID</TableHead>
                  <TableHead className="text-[11px]">Customer</TableHead>
                  <TableHead className="text-[11px]">City</TableHead>
                  <TableHead className="text-[11px]">Product</TableHead>
                  <TableHead className="text-[11px] text-right">Total</TableHead>
                  <TableHead className="text-[11px]">Last Price</TableHead>
                  <TableHead className="text-[11px]">Offers</TableHead>
                  <TableHead className="text-[11px]">Confirmation</TableHead>
                  <TableHead className="text-[11px]">Delivery</TableHead>
                  <TableHead className="text-[11px]">Date</TableHead>
                  <TableHead className="text-[11px] w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-12">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-12">
                      No orders found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order: any) => {
                    const cBadge = confirmationBadge[order.confirmation_status] || { label: order.confirmation_status, className: "bg-muted text-muted-foreground" };
                    const dBadge = order.delivery_status ? (deliveryBadge[order.delivery_status] || { label: order.delivery_status, className: "bg-muted text-muted-foreground" }) : null;
                    const editable = canEdit(order);
                    return (
                      <TableRow key={order.id} className="text-xs">
                        <TableCell className="font-mono font-semibold text-primary">{order.order_id}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{order.customer_name}</p>
                            <p className="text-[10px] text-muted-foreground">{order.customer_phone}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground" /> {order.customer_city}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 text-[11px]">
                            <Package className="h-3 w-3 text-muted-foreground" /> {order.product_name} ×{order.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{order.total_amount} PKR</TableCell>
                        <TableCell>
                          {order.last_price != null && Number(order.last_price) > 0 ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary bg-accent/60 px-1.5 py-0.5 rounded">
                              <DollarSign className="h-3 w-3" /> {order.last_price} PKR
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {order.offers && order.offers.trim() ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded max-w-[120px] truncate">
                              <Tag className="h-3 w-3 shrink-0" /> {order.offers}
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", cBadge.className)}>
                            {cBadge.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {dBadge ? (
                            <Badge variant="outline" className={cn("text-[10px]", dBadge.className)}>
                              {dBadge.label}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(order.updated_at), "dd/MM/yy HH:mm")}
                        </TableCell>
                        <TableCell>
                          {editable && (
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(order)}>
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit Order Dialog */}
      <Dialog open={!!editOrder} onOpenChange={(open) => !open && setEditOrder(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Order — {editOrder?.order_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto">
            {/* Customer Info */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer Info</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input
                    className="h-9 text-sm"
                    value={editForm.customer_name}
                    onChange={(e) => updateField("customer_name", e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Phone</Label>
                  <Input
                    className="h-9 text-sm"
                    value={editForm.customer_phone}
                    onChange={(e) => updateField("customer_phone", e.target.value)}
                    maxLength={20}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">City</Label>
                  <Input
                    className="h-9 text-sm"
                    value={editForm.customer_city}
                    onChange={(e) => updateField("customer_city", e.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Address</Label>
                  <Input
                    className="h-9 text-sm"
                    value={editForm.customer_address}
                    onChange={(e) => updateField("customer_address", e.target.value)}
                    maxLength={200}
                  />
                </div>
              </div>
            </div>

            {/* Product Info */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Product Info</p>
                {sellerProducts.length > 0 && (
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" size="sm" className="h-7 text-[10px] gap-1 border-dashed">
                        <Plus className="h-3 w-3" /> Add Product
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-2" align="end">
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {sellerProducts.map(sp => (
                          <button
                            key={sp.id}
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors"
                            onClick={() => {
                              updateField("product_name", sp.name);
                              updateField("price", sp.price);
                            }}
                          >
                            <span className="truncate font-medium">{sp.name}</span>
                            <span className="text-muted-foreground shrink-0">{sp.price} PKR</span>
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Product Name</Label>
                <Input
                  className="h-9 text-sm"
                  value={editForm.product_name}
                  onChange={(e) => updateField("product_name", e.target.value)}
                  maxLength={200}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Price ($)</Label>
                  <Input
                    className="h-9 text-sm"
                    type="number"
                    min={0}
                    value={editForm.price}
                    onChange={(e) => updateField("price", Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Quantity</Label>
                  <Input
                    className="h-9 text-sm"
                    type="number"
                    min={1}
                    value={editForm.quantity}
                    onChange={(e) => updateField("quantity", Math.max(1, Number(e.target.value)))}
                  />
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{(editForm.price * editForm.quantity).toFixed(2)} PKR</span>
              </div>

              {/* Last Price & Offers */}
              {editOrder?.last_price != null && Number(editOrder.last_price) > 0 && (
                <div className="rounded-md bg-accent/60 border border-accent px-2.5 py-1.5 flex items-center gap-2">
                  <DollarSign className="h-3 w-3 text-primary shrink-0" />
                  <span className="text-[10px] text-muted-foreground">Last sold at</span>
                  <span className="text-xs font-bold text-primary tabular-nums">{editOrder.last_price} PKR</span>
                </div>
              )}
              {editOrder?.offers && editOrder.offers.trim() && (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 flex items-center gap-2">
                  <Tag className="h-3 w-3 text-amber-600 shrink-0" />
                  <span className="text-[10px] text-amber-600 font-medium">Offers:</span>
                  <span className="text-xs text-foreground">{editOrder.offers}</span>
                </div>
              )}

              {/* Store & Video Links from Product */}
              {(() => {
                const mp = sellerProducts.find(p => p.name === editForm.product_name);
                const storeUrl = editOrder?.product_url || mp?.product_url || editOrder?.store_url;
                const videoUrl = editOrder?.video_url || mp?.video_url;
                return (
                  <div className="flex flex-wrap gap-2">
                    {storeUrl ? (
                      <a href={storeUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                        <Store className="h-3 w-3" /> Store Link <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        <Store className="h-3 w-3" /> No Store Link
                      </span>
                    )}
                    {videoUrl ? (
                      <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                        <Video className="h-3 w-3" /> Video <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
                        <Video className="h-3 w-3" /> No Video
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            {/* Status */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Confirmation Status</Label>
                  <Select value={editForm.confirmation_status} onValueChange={(v) => updateField("confirmation_status", v)}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONFIRMATION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Delivery Status (read-only)</Label>
                  <div className="h-9 px-3 flex items-center rounded-md border bg-muted/50 text-sm text-muted-foreground">
                    {editOrder?.delivery_status
                      ? (deliveryBadge[editOrder.delivery_status]?.label || editOrder.delivery_status)
                      : "—"}
                  </div>
                </div>
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5">
              <Label className="text-xs">Note</Label>
              <Input
                className="h-9 text-sm"
                value={editForm.note}
                onChange={(e) => updateField("note", e.target.value)}
                maxLength={500}
                placeholder="Optional note..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOrder(null)}>Cancel</Button>
            <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentConfirmedOrders;
