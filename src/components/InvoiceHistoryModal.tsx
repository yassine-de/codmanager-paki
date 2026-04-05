import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Package, ArrowDownCircle, ArrowUpCircle, ArrowUpDown,
  LogIn, LogOut, Truck
} from "lucide-react";
import { formatUSD } from "@/lib/currency";

interface OrderEvent {
  id: string;
  order_id: string;
  direction: "in" | "out";
  old_status: string | null;
  new_status: string | null;
  created_at: string;
  by: string | null;
}

interface AddonEvent {
  id: string;
  type: "in" | "out";
  amount: number;
  reason: string;
  created_at: string;
}

interface AdjustmentEvent {
  id: string;
  order_id: string;
  old_status: string;
  new_status: string;
  difference: number;
  shipping_difference: number;
  reason: string;
  status: string;
  created_at: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  orderIds?: string[];
}

export default function InvoiceHistoryModal({ open, onOpenChange, invoiceId, invoiceNumber }: Props) {
  const [orders, setOrders] = useState<OrderEvent[]>([]);
  const [addons, setAddons] = useState<AddonEvent[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !invoiceId) return;

    const fetch = async () => {
      setLoading(true);

      // 1. Invoice history — filter delivery events only
      const { data: history } = await supabase
        .from("invoice_history")
        .select("*")
        .eq("invoice_id", invoiceId)
        .in("event_type", ["adjustment_created"])
        .eq("field_changed", "delivery_status")
        .order("created_at", { ascending: false });

      const userIds = [...new Set((history || []).filter(h => h.changed_by).map(h => h.changed_by!))];
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", userIds);
        nameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));
      }

      const orderEvents: OrderEvent[] = (history || []).map(h => {
        const isIn = h.new_value === "delivered";
        return {
          id: h.id,
          order_id: h.order_id || "—",
          direction: isIn ? "in" as const : "out" as const,
          old_status: h.old_value,
          new_status: h.new_value,
          created_at: h.created_at,
          by: h.changed_by ? nameMap.get(h.changed_by) || null : null,
        };
      });

      // 2. Addons
      const { data: addonData } = await supabase
        .from("invoice_addons")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });

      const addonEvents: AddonEvent[] = (addonData || []).map(a => ({
        id: a.id,
        type: a.type as "in" | "out",
        amount: a.amount,
        reason: a.reason,
        created_at: a.created_at || new Date().toISOString(),
      }));

      // 3. Adjustments
      const { data: adjData } = await supabase
        .from("invoice_adjustments")
        .select("*")
        .or(`invoice_id.eq.${invoiceId},applied_invoice_id.eq.${invoiceId}`)
        .order("created_at", { ascending: false });

      const adjEvents: AdjustmentEvent[] = (adjData || []).map(a => ({
        id: a.id,
        order_id: a.order_id,
        old_status: a.old_status,
        new_status: a.new_status,
        difference: a.difference,
        shipping_difference: a.shipping_difference,
        reason: a.reason,
        status: a.status,
        created_at: a.created_at,
      }));

      setOrders(orderEvents);
      setAddons(addonEvents);
      setAdjustments(adjEvents);
      setLoading(false);
    };

    fetch();
  }, [open, invoiceId]);

  const SectionHeader = ({ icon: Icon, title, count, color }: { icon: any; title: string; count: number; color: string }) => (
    <div className="flex items-center gap-2 py-2 px-1 border-b">
      <Icon className={`h-3.5 w-3.5 ${color}`} />
      <span className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</span>
      <span className="ml-auto text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{count}</span>
    </div>
  );

  const EmptyState = ({ text }: { text: string }) => (
    <p className="text-xs text-muted-foreground text-center py-4">{text}</p>
  );

  const statusLabel = (s: string | null) => {
    if (!s || s === "none") return "—";
    return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Invoice History
            <span className="text-xs font-normal text-muted-foreground">— {invoiceNumber}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 overflow-auto" style={{ maxHeight: "calc(85vh - 80px)" }}>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="px-4 py-3 space-y-4">
              {/* ORDERS — delivery events only */}
              <div>
                <SectionHeader icon={Truck} title="Orders" count={orders.length} color="text-success" />
                {orders.length === 0 ? (
                  <EmptyState text="No delivery events" />
                ) : (
                  <div className="divide-y">
                    {orders.map(o => (
                      <div key={o.id} className="flex items-center gap-3 py-2.5 px-1">
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${o.direction === "in" ? "bg-success/10" : "bg-destructive/10"}`}>
                          {o.direction === "in"
                            ? <LogIn className="w-3 h-3 text-success" />
                            : <LogOut className="w-3 h-3 text-destructive" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-mono font-semibold">{o.order_id}</span>
                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${o.direction === "in" ? "bg-success/15 text-success border-success/20" : "bg-destructive/15 text-destructive border-destructive/20"}`}>
                              {o.direction === "in" ? "IN" : "OUT"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1 mt-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {statusLabel(o.old_status)} → {statusLabel(o.new_status)}
                            </span>
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                          {format(new Date(o.created_at), "dd MMM · HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ADDONS */}
              <div>
                <SectionHeader icon={ArrowDownCircle} title="Addons" count={addons.length} color="text-primary" />
                {addons.length === 0 ? (
                  <EmptyState text="No addons" />
                ) : (
                  <div className="divide-y">
                    {addons.map(a => (
                      <div key={a.id} className="flex items-center gap-3 py-2.5 px-1">
                        <div className={`flex items-center justify-center w-6 h-6 rounded-full shrink-0 ${a.type === "in" ? "bg-success/10" : "bg-destructive/10"}`}>
                          {a.type === "in"
                            ? <ArrowDownCircle className="w-3 h-3 text-success" />
                            : <ArrowUpCircle className="w-3 h-3 text-destructive" />
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold tabular-nums ${a.type === "in" ? "text-success" : "text-destructive"}`}>
                              {a.type === "in" ? "+" : "-"}{formatUSD(a.amount)}
                            </span>
                            <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${a.type === "in" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                              {a.type === "in" ? "Bonus" : "Deduction"}
                            </span>
                          </div>
                          {a.reason && (
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{a.reason}</p>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                          {format(new Date(a.created_at), "dd MMM · HH:mm")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ADJUSTMENTS */}
              <div>
                <SectionHeader icon={ArrowUpDown} title="Adjustments" count={adjustments.length} color="text-warning" />
                {adjustments.length === 0 ? (
                  <EmptyState text="No adjustments" />
                ) : (
                  <div className="divide-y">
                    {adjustments.map(adj => {
                      const totalDiff = adj.difference + adj.shipping_difference;
                      const totalUsd = totalDiff / 290;
                      const isQuantity = adj.reason === "quantity_change";
                      return (
                        <div key={adj.id} className="py-2.5 px-1">
                          <div className="flex items-center gap-2">
                            <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                            <span className="text-xs font-mono font-semibold">{adj.order_id}</span>
                            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${adj.status === "approved" ? "bg-success/10 text-success border-success/20" : adj.status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"}`}>
                              {adj.status.toUpperCase()}
                            </span>
                            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {format(new Date(adj.created_at), "dd MMM · HH:mm")}
                            </span>
                          </div>
                          <div className="ml-5.5 mt-1.5 space-y-0.5 pl-1">
                            {!isQuantity && (
                              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span>{statusLabel(adj.old_status)} → {statusLabel(adj.new_status)}</span>
                              </div>
                            )}
                            {isQuantity && (
                              <div className="text-[10px] text-muted-foreground">Quantity changed</div>
                            )}
                            {adj.difference !== 0 && (
                              <div className="flex justify-between text-[11px]">
                                <span className="text-muted-foreground">Revenue</span>
                                <span className={`tabular-nums font-semibold ${adj.difference >= 0 ? "text-success" : "text-destructive"}`}>
                                  {adj.difference >= 0 ? "+" : ""}{formatUSD(adj.difference / 290)}
                                </span>
                              </div>
                            )}
                            {adj.shipping_difference !== 0 && (
                              <div className="flex justify-between text-[11px]">
                                <span className="text-muted-foreground">Shipping</span>
                                <span className={`tabular-nums font-semibold ${adj.shipping_difference >= 0 ? "text-success" : "text-destructive"}`}>
                                  {adj.shipping_difference >= 0 ? "+" : ""}{formatUSD(adj.shipping_difference)}
                                </span>
                              </div>
                            )}
                            {(adj.difference !== 0 || adj.shipping_difference !== 0) && (
                              <div className="flex justify-between text-[11px] border-t pt-0.5 mt-0.5">
                                <span className="font-medium">Total</span>
                                <span className={`tabular-nums font-bold ${totalUsd >= 0 ? "text-success" : "text-destructive"}`}>
                                  {totalUsd >= 0 ? "+" : ""}{formatUSD(Math.abs(totalUsd))}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
