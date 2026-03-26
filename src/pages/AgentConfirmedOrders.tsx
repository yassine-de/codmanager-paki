import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CheckCircle2, Search, Package, MapPin, Pencil } from "lucide-react";
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

const AgentConfirmedOrders = () => {
  const { authUser } = useAuth();
  const userId = authUser?.id;
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [editOrder, setEditOrder] = useState<any>(null);
  const [newStatus, setNewStatus] = useState("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["agent-treated-orders", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("agent_id", userId)
        .neq("confirmation_status", "new")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!userId,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: string }) => {
      const confirmed_at = status === "confirmed" ? new Date().toISOString() : null;
      const { error } = await supabase
        .from("orders")
        .update({ confirmation_status: status, confirmed_at })
        .eq("id", orderId);
      if (error) throw error;

      // Log history
      if (userId) {
        await supabase.from("order_history").insert({
          order_id: editOrder?.order_id,
          changed_by: userId,
          changed_by_role: "agent",
          field_changed: "confirmation_status",
          old_value: editOrder?.confirmation_status,
          new_value: status,
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-treated-orders"] });
      queryClient.invalidateQueries({ queryKey: ["agent-dashboard-orders"] });
      toast.success("Status updated successfully");
      setEditOrder(null);
    },
    onError: () => toast.error("Failed to update status"),
  });

  const filteredOrders = useMemo(() => {
    if (!search) return orders;
    const q = search.toLowerCase();
    return orders.filter(
      (o: any) =>
        o.order_id?.toLowerCase().includes(q) ||
        o.customer_name?.toLowerCase().includes(q) ||
        o.customer_city?.toLowerCase().includes(q) ||
        o.customer_phone?.includes(q) ||
        o.product_name?.toLowerCase().includes(q)
    );
  }, [orders, search]);

  const canEdit = (order: any) => {
    return !SHIPPED_STATUSES.includes(order.delivery_status || "");
  };

  const openEdit = (order: any) => {
    setEditOrder(order);
    setNewStatus(order.confirmation_status);
  };

  const handleSave = () => {
    if (!editOrder || !newStatus || newStatus === editOrder.confirmation_status) {
      setEditOrder(null);
      return;
    }
    updateMutation.mutate({ orderId: editOrder.id, status: newStatus });
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
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-xs pl-9"
          />
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
                  <TableHead className="text-[11px]">Confirmation</TableHead>
                  <TableHead className="text-[11px]">Delivery</TableHead>
                  <TableHead className="text-[11px]">Date</TableHead>
                  <TableHead className="text-[11px] w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-12">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground py-12">
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
                        <TableCell className="text-right font-semibold">{order.total_amount} MAD</TableCell>
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

      {/* Edit Status Dialog */}
      <Dialog open={!!editOrder} onOpenChange={(open) => !open && setEditOrder(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Order — {editOrder?.order_id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Confirmation Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
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
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground">Delivery Status (read-only)</Label>
              <div className="h-9 px-3 flex items-center rounded-md border bg-muted/50 text-sm text-muted-foreground">
                {editOrder?.delivery_status
                  ? (deliveryBadge[editOrder.delivery_status]?.label || editOrder.delivery_status)
                  : "—"}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setEditOrder(null)}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AgentConfirmedOrders;
