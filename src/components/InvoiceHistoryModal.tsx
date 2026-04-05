import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, Package, ArrowDownCircle, ArrowUpCircle, ArrowUpDown,
  LogIn, LogOut, ChevronRight, Plus, Minus, RefreshCw
} from "lucide-react";
import { formatUSD, formatPKR } from "@/lib/currency";

interface OrderEvent {
  id: string;
  order_id: string;
  order_uuid?: string;
  direction: "in" | "out";
  event_type: string;
  old_status: string | null;
  new_status: string | null;
  description: string | null;
  metadata: any;
  created_at: string;
  by: string | null;
}

interface AddonEvent {
  id: string;
  type: "in" | "out";
  amount: number;
  reason: string;
  product_name?: string | null;
  created_at: string;
}

interface AdjustmentEvent {
  id: string;
  order_id: string;
  old_status: string;
  new_status: string;
  difference: number;
  shipping_difference: number;
  previous_amount: number;
  new_amount: number;
  reason: string;
  status: string;
  created_at: string;
}

type TimelineItem =
  | { kind: "order"; data: OrderEvent }
  | { kind: "addon"; data: AddonEvent }
  | { kind: "adjustment"; data: AdjustmentEvent };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  orderIds?: string[];
}

export default function InvoiceHistoryModal({ open, onOpenChange, invoiceId, invoiceNumber }: Props) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderEvent[]>([]);
  const [addons, setAddons] = useState<AddonEvent[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !invoiceId) return;

    const load = async () => {
      setLoading(true);

      // 1. ALL invoice_history events (not just delivery_status)
      const { data: history } = await supabase
        .from("invoice_history")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });

      // Resolve user names
      const userIds = [...new Set((history || []).filter(h => h.changed_by).map(h => h.changed_by!))];
      let nameMap = new Map<string, string>();
      if (userIds.length > 0) {
        const { data: profiles } = await supabase.from("profiles").select("user_id, name").in("user_id", userIds);
        nameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));
      }

      // Resolve order UUIDs for navigation
      const orderTextIds = [...new Set((history || []).filter(h => h.order_id).map(h => h.order_id!))];
      let orderUuidMap = new Map<string, string>();
      if (orderTextIds.length > 0) {
        const { data: orderRows } = await supabase
          .from("orders")
          .select("id, order_id")
          .in("order_id", orderTextIds);
        orderUuidMap = new Map((orderRows || []).map(o => [o.order_id, o.id]));
      }

      // Filter order-related events (IN/OUT assignments + delivery changes)
      const orderEventTypes = ["order_added", "order_removed", "status_change", "adjustment_created"];
      const orderEvents: OrderEvent[] = (history || [])
        .filter(h => {
          // Order assignment events
          if (h.event_type === "order_added" || h.event_type === "order_removed") return true;
          // Delivery IN/OUT events
          if (h.field_changed === "delivery_status" && (h.new_value === "delivered" || h.old_value === "delivered")) return true;
          return false;
        })
        .map(h => {
          let direction: "in" | "out" = "in";
          if (h.event_type === "order_removed") direction = "out";
          else if (h.event_type === "order_added") direction = "in";
          else if (h.old_value === "delivered") direction = "out";
          else direction = "in";

          return {
            id: h.id,
            order_id: h.order_id || "—",
            order_uuid: h.order_id ? orderUuidMap.get(h.order_id) : undefined,
            direction,
            event_type: h.event_type,
            old_status: h.old_value,
            new_status: h.new_value,
            description: h.description,
            metadata: h.metadata,
            created_at: h.created_at,
            by: h.changed_by ? nameMap.get(h.changed_by) || null : null,
          };
        });

      // 2. Addons with product name
      const { data: addonData } = await supabase
        .from("invoice_addons")
        .select("*, products:product_id(name)")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false });

      const addonEvents: AddonEvent[] = (addonData || []).map((a: any) => ({
        id: a.id,
        type: a.type as "in" | "out",
        amount: a.amount,
        reason: a.reason,
        product_name: a.products?.name || null,
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
        previous_amount: a.previous_amount,
        new_amount: a.new_amount,
        reason: a.reason,
        status: a.status,
        created_at: a.created_at,
      }));

      setOrders(orderEvents);
      setAddons(addonEvents);
      setAdjustments(adjEvents);
      setLoading(false);
    };

    load();
  }, [open, invoiceId]);

  const statusLabel = (s: string | null) => {
    if (!s || s === "none") return "—";
    return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  };

  const handleOrderClick = (orderUuid?: string) => {
    if (!orderUuid) return;
    onOpenChange(false);
    navigate(`/orders/${orderUuid}`);
  };

  // Build combined timeline for "All" tab
  const allItems: TimelineItem[] = [
    ...orders.map(d => ({ kind: "order" as const, data: d })),
    ...addons.map(d => ({ kind: "addon" as const, data: d })),
    ...adjustments.map(d => ({ kind: "adjustment" as const, data: d })),
  ].sort((a, b) => new Date(b.data.created_at).getTime() - new Date(a.data.created_at).getTime());

  const EmptyState = ({ text }: { text: string }) => (
    <p className="text-xs text-muted-foreground text-center py-6">{text}</p>
  );

  // ── Order row ──
  const renderOrderRow = (o: OrderEvent) => {
    const isAssignment = o.event_type === "order_added" || o.event_type === "order_removed";
    const meta = o.metadata || {};
    const productName = meta.product_name;
    const qty = meta.quantity;
    const price = meta.price;
    const totalPkr = price && qty ? price * qty : null;

    return (
      <div
        key={o.id}
        className={`flex items-center gap-3 py-2.5 px-2 rounded-md transition-colors ${o.order_uuid ? "cursor-pointer hover:bg-muted/50" : ""}`}
        onClick={() => handleOrderClick(o.order_uuid)}
      >
        <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${o.direction === "in" ? "bg-success/10" : "bg-destructive/10"}`}>
          {o.direction === "in" ? <LogIn className="w-3.5 h-3.5 text-success" /> : <LogOut className="w-3.5 h-3.5 text-destructive" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-semibold">{o.order_id}</span>
            <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none ${o.direction === "in" ? "bg-success/15 text-success border-success/20" : "bg-destructive/15 text-destructive border-destructive/20"}`}>
              {o.direction === "in" ? "IN" : "OUT"}
            </span>
            {isAssignment && (
              <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none bg-primary/10 text-primary">
                {o.event_type === "order_added" ? "Assigned" : "Removed"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {isAssignment ? (
              <>
                {productName && <span className="text-[10px] text-muted-foreground">{productName}</span>}
                {qty && <span className="text-[10px] text-muted-foreground/60">· x{qty}</span>}
                {totalPkr && <span className="text-[10px] text-muted-foreground/60">· {formatPKR(totalPkr)}</span>}
              </>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                {statusLabel(o.old_status)} → {statusLabel(o.new_status)}
              </span>
            )}
            {o.by && <span className="text-[10px] text-muted-foreground/60">· {o.by}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground tabular-nums">{format(new Date(o.created_at), "dd MMM · HH:mm")}</span>
          {o.order_uuid && <ChevronRight className="w-3 h-3 text-muted-foreground/40" />}
        </div>
      </div>
    );
  };

  // ── Addon row ──
  const renderAddonRow = (a: AddonEvent) => (
    <div key={a.id} className="flex items-center gap-3 py-2.5 px-2">
      <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${a.type === "in" ? "bg-success/10" : "bg-destructive/10"}`}>
        {a.type === "in" ? <ArrowDownCircle className="w-3.5 h-3.5 text-success" /> : <ArrowUpCircle className="w-3.5 h-3.5 text-destructive" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold tabular-nums ${a.type === "in" ? "text-success" : "text-destructive"}`}>
            {a.type === "in" ? "+" : "-"}{formatUSD(a.amount)}
          </span>
          <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none ${a.type === "in" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
            {a.type === "in" ? "Bonus" : "Deduction"}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          {a.reason && <span className="text-[10px] text-muted-foreground truncate">{a.reason}</span>}
          {a.product_name && (
            <span className="text-[10px] text-muted-foreground/60 truncate">· {a.product_name}</span>
          )}
        </div>
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
        {format(new Date(a.created_at), "dd MMM · HH:mm")}
      </span>
    </div>
  );

  // ── Adjustment row ──
  const renderAdjustmentRow = (adj: AdjustmentEvent) => {
    const totalDiff = adj.difference + adj.shipping_difference;
    const totalUsd = totalDiff / 290;
    const isQuantity = adj.reason === "quantity_change";

    return (
      <div key={adj.id} className="py-2.5 px-2">
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center w-7 h-7 rounded-full shrink-0 ${adj.status === "approved" ? "bg-success/10" : adj.status === "rejected" ? "bg-destructive/10" : "bg-warning/10"}`}>
            <ArrowUpDown className={`w-3.5 h-3.5 ${adj.status === "approved" ? "text-success" : adj.status === "rejected" ? "text-destructive" : "text-warning"}`} />
          </div>
          <span className="text-xs font-mono font-semibold">{adj.order_id}</span>
          <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold leading-none ${adj.status === "approved" ? "bg-success/10 text-success border-success/20" : adj.status === "rejected" ? "bg-destructive/10 text-destructive border-destructive/20" : "bg-warning/10 text-warning border-warning/20"}`}>
            {adj.status.toUpperCase()}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
            {format(new Date(adj.created_at), "dd MMM · HH:mm")}
          </span>
        </div>
        <div className="ml-9 mt-1.5 space-y-0.5">
          <div className="text-[10px] text-muted-foreground">
            {isQuantity ? "Quantity changed" : `${statusLabel(adj.old_status)} → ${statusLabel(adj.new_status)}`}
          </div>
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
            <div className="flex justify-between text-[11px] border-t border-border/50 pt-0.5 mt-0.5">
              <span className="font-medium text-foreground">Net Impact</span>
              <span className={`tabular-nums font-bold ${totalUsd >= 0 ? "text-success" : "text-destructive"}`}>
                {totalUsd >= 0 ? "+" : ""}{formatUSD(totalUsd)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Timeline item renderer ──
  const renderTimelineItem = (item: TimelineItem) => {
    if (item.kind === "order") return renderOrderRow(item.data);
    if (item.kind === "addon") return renderAddonRow(item.data);
    return renderAdjustmentRow(item.data);
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

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="all" className="flex flex-col flex-1 min-h-0">
            <div className="px-4 pt-3">
              <TabsList className="w-full h-8">
                <TabsTrigger value="all" className="text-[11px] flex-1">
                  All ({allItems.length})
                </TabsTrigger>
                <TabsTrigger value="orders" className="text-[11px] flex-1">
                  Orders ({orders.length})
                </TabsTrigger>
                <TabsTrigger value="addons" className="text-[11px] flex-1">
                  Addons ({addons.length})
                </TabsTrigger>
                <TabsTrigger value="adjustments" className="text-[11px] flex-1">
                  Adjustments ({adjustments.length})
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1" style={{ maxHeight: "calc(85vh - 130px)" }}>
              <div className="px-4 py-3">
                <TabsContent value="all" className="mt-0">
                  {allItems.length === 0 ? (
                    <EmptyState text="No history events" />
                  ) : (
                    <div className="divide-y">{allItems.map(renderTimelineItem)}</div>
                  )}
                </TabsContent>

                <TabsContent value="orders" className="mt-0">
                  {orders.length === 0 ? (
                    <EmptyState text="No order events" />
                  ) : (
                    <div className="divide-y">{orders.map(renderOrderRow)}</div>
                  )}
                </TabsContent>

                <TabsContent value="addons" className="mt-0">
                  {addons.length === 0 ? (
                    <EmptyState text="No addons" />
                  ) : (
                    <div className="divide-y">{addons.map(renderAddonRow)}</div>
                  )}
                </TabsContent>

                <TabsContent value="adjustments" className="mt-0">
                  {adjustments.length === 0 ? (
                    <EmptyState text="No adjustments" />
                  ) : (
                    <div className="divide-y">{adjustments.map(renderAdjustmentRow)}</div>
                  )}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
