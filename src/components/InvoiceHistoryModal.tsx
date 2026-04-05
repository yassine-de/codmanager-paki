import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Loader2, ArrowRightLeft, UserCheck, PlusCircle, Package,
  ArrowDownCircle, ArrowUpCircle, CheckCircle2, XCircle, LogIn, LogOut, RefreshCw
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface TimelineEntry {
  id: string;
  type: "order_change" | "addon" | "status_change" | "order_added" | "order_removed" | "addon_added" | "addon_removed" | "adjustment_created" | "adjustment_approved" | "adjustment_rejected" | string;
  created_at: string;
  // Order change fields
  order_id?: string;
  field_changed?: string;
  old_value?: string | null;
  new_value?: string | null;
  changed_by_role?: string;
  agent_name?: string;
  // Addon fields
  addon_type?: string;
  amount?: number;
  reason?: string;
  // History fields
  description?: string;
  metadata?: Record<string, any>;
}

const fieldLabels: Record<string, string> = {
  confirmation_status: "Confirmation Status",
  delivery_status: "Delivery Status",
  customer_name: "Customer Name",
  customer_phone: "Phone",
  customer_city: "City",
  customer_address: "Address",
  product_name: "Product",
  quantity: "Quantity",
  price: "Price",
  total_amount: "Total Amount",
  note: "Note",
  agent_id: "Assigned Agent",
  shipping_status: "Shipping Status",
  cancel_reason: "Cancel Reason",
  postpone_date: "Postpone Date",
  status: "Invoice Status",
  paid_at: "Payment Date",
};

const fieldIcon = (field: string) => {
  if (field === "agent_id") return UserCheck;
  if (field === "created") return PlusCircle;
  return ArrowRightLeft;
};

const fieldColor = (field: string) => {
  if (field === "confirmation_status") return "text-info bg-info/10";
  if (field === "delivery_status") return "text-success bg-success/10";
  if (field === "agent_id") return "text-[hsl(270,50%,55%)] bg-[hsl(270,50%,55%)]/10";
  if (field === "cancel_reason") return "text-destructive bg-destructive/10";
  return "text-warning bg-warning/10";
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  orderIds?: string[];
}

export default function InvoiceHistoryModal({ open, onOpenChange, invoiceId, invoiceNumber, orderIds }: Props) {
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    const fetchAll = async () => {
      setLoading(true);
      const entries: TimelineEntry[] = [];

      // 1. Fetch order history
      let resolvedOrderIds = orderIds || [];
      if (!orderIds?.length && invoiceId) {
        const { data: orders } = await supabase
          .from("orders")
          .select("order_id")
          .eq("invoice_id", invoiceId);
        resolvedOrderIds = (orders || []).map(o => o.order_id);
      }

      if (resolvedOrderIds.length > 0) {
        const { data: histData } = await supabase
          .from("order_history")
          .select("*")
          .in("order_id", resolvedOrderIds)
          .order("created_at", { ascending: false });

        const userIds = [...new Set((histData || []).map(h => h.changed_by))];
        let nameMap = new Map<string, string>();
        if (userIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, name")
            .in("user_id", userIds);
          nameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));
        }

        (histData || []).forEach(h => {
          entries.push({
            id: h.id,
            type: "order_change",
            created_at: h.created_at,
            order_id: h.order_id,
            field_changed: h.field_changed,
            old_value: h.old_value,
            new_value: h.new_value,
            changed_by_role: h.changed_by_role,
            agent_name: nameMap.get(h.changed_by) || "Unknown",
          });
        });
      }

      // 2. Fetch addons
      if (invoiceId) {
        const { data: addons } = await supabase
          .from("invoice_addons")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: false });

        (addons || []).forEach(a => {
          entries.push({
            id: a.id,
            type: "addon",
            created_at: a.created_at || new Date().toISOString(),
            addon_type: a.type,
            amount: a.amount,
            reason: a.reason,
          });
        });

        // 3. Fetch invoice history (status changes + order movements)
        const { data: invHistory } = await supabase
          .from("invoice_history")
          .select("*")
          .eq("invoice_id", invoiceId)
          .order("created_at", { ascending: false });

        // Resolve changed_by names
        const invUserIds = [...new Set((invHistory || []).filter(h => h.changed_by).map(h => h.changed_by))];
        let invNameMap = new Map<string, string>();
        if (invUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, name")
            .in("user_id", invUserIds);
          invNameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));
        }

        (invHistory || []).forEach((h: any) => {
          entries.push({
            id: h.id,
            type: h.event_type as TimelineEntry["type"],
            created_at: h.created_at,
            order_id: h.order_id,
            field_changed: h.field_changed,
            old_value: h.old_value,
            new_value: h.new_value,
            agent_name: h.changed_by ? invNameMap.get(h.changed_by) || "Unknown" : undefined,
            description: h.description,
            metadata: h.metadata,
          });
        });
      }

      // Sort by date desc
      entries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setTimeline(entries);
      setLoading(false);
    };

    fetchAll();
  }, [open, invoiceId, orderIds]);

  const orderMovements = timeline.filter(e => e.type === "order_added" || e.type === "order_removed");
  const statusChanges = timeline.filter(e => e.type === "status_change");
  const otherEvents = timeline.filter(e => e.type === "order_change" || e.type === "addon" || e.type === "addon_added" || e.type === "addon_removed");

  // Group events by order_id for the "By Order" tab
  const orderGrouped = (() => {
    const orderEvents = timeline.filter(e => e.order_id);
    const groups = new Map<string, { events: TimelineEntry[]; direction: "in" | "out" | "changed" }>();
    
    orderEvents.forEach(e => {
      const oid = e.order_id!;
      if (!groups.has(oid)) {
        groups.set(oid, { events: [], direction: "changed" });
      }
      groups.get(oid)!.events.push(e);
    });

    // Determine direction per order
    groups.forEach((group) => {
      const hasAdded = group.events.some(e => e.type === "order_added");
      const hasRemoved = group.events.some(e => e.type === "order_removed");
      if (hasAdded && !hasRemoved) group.direction = "in";
      else if (hasRemoved && !hasAdded) group.direction = "out";
      else if (hasRemoved) group.direction = "out";
      else group.direction = "changed";
    });

    return Array.from(groups.entries()).sort((a, b) => {
      const aLatest = Math.max(...a[1].events.map(e => new Date(e.created_at).getTime()));
      const bLatest = Math.max(...b[1].events.map(e => new Date(e.created_at).getTime()));
      return bLatest - aLatest;
    });
  })();

  const renderOrderGrouped = () => {
    if (orderGrouped.length === 0) {
      return <p className="text-sm text-muted-foreground text-center py-8">No order events recorded</p>;
    }
    return (
      <div className="space-y-3">
        {orderGrouped.map(([orderId, group]) => {
          const dirBadge = group.direction === "in"
            ? { label: "IN", cls: "bg-success/15 text-success border-success/20" }
            : group.direction === "out"
            ? { label: "OUT", cls: "bg-destructive/15 text-destructive border-destructive/20" }
            : { label: "CHANGED", cls: "bg-warning/15 text-warning border-warning/20" };

          return (
            <div key={orderId} className="rounded-lg border bg-card p-3">
              <div className="flex items-center gap-2 mb-2.5 pb-2 border-b">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-mono font-semibold">{orderId}</span>
                <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${dirBadge.cls}`}>
                  {dirBadge.label}
                </span>
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {group.events.length} event{group.events.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="space-y-2">
                {group.events
                  .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                  .map(event => {
                    const label = event.type === "order_added" ? "Added to invoice"
                      : event.type === "order_removed" ? "Removed from invoice"
                      : event.type === "adjustment_created" ? "Adjustment created"
                      : event.type === "adjustment_approved" ? "Adjustment approved"
                      : event.type === "adjustment_rejected" ? "Adjustment rejected"
                      : event.type === "order_change" ? (fieldLabels[event.field_changed || ""] || event.field_changed || "Change")
                      : event.description || event.type;

                    return (
                      <div key={event.id} className="flex items-start gap-2 text-xs">
                        <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap mt-0.5">
                          {format(new Date(event.created_at), "dd MMM · HH:mm")}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium">{label}</span>
                          {(event.old_value || event.new_value) && (
                            <span className="ml-1.5 text-muted-foreground">
                              {event.old_value && <span className="line-through">{event.old_value}</span>}
                              {event.old_value && event.new_value && " → "}
                              {event.new_value && <span className="text-foreground font-medium">{event.new_value}</span>}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderEvent = (event: TimelineEntry) => {
    // Status change
    if (event.type === "status_change") {
      const isPaidAt = event.field_changed === "paid_at";
      const statusLabel = (v: string | null | undefined) => {
        if (v === "draft") return "Draft";
        if (v === "ready") return "Ready";
        if (v === "paid") return "Paid";
        return v || "—";
      };
      const formatValue = (v: string | null | undefined) => {
        if (isPaidAt && v) {
          try { return format(new Date(v), "dd MMM yyyy · HH:mm"); } catch { return v; }
        }
        return statusLabel(v);
      };
      const eventLabel = isPaidAt ? "Payment Date Recorded" : "Invoice Status Changed";
      const EventIcon = isPaidAt ? CheckCircle2 : RefreshCw;
      const eventColor = isPaidAt ? "text-success bg-success/10" : "text-info bg-info/10";
      return (
        <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${eventColor}`}>
            <EventIcon className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-sm font-medium leading-snug">{eventLabel}</p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {event.old_value && (
                <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground line-through">
                  {formatValue(event.old_value)}
                </span>
              )}
              {event.old_value && event.new_value && <span className="text-muted-foreground text-[10px]">→</span>}
              {event.new_value && (
                <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {formatValue(event.new_value)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(new Date(event.created_at), "dd MMM yyyy · HH:mm")}
              </span>
              {event.agent_name && (
                <span className="text-[11px] text-muted-foreground">
                  by <span className="font-medium text-foreground/70">{event.agent_name}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Addon added / removed (from invoice_history)
    if (event.type === "addon_added" || event.type === "addon_removed") {
      const isAdded = event.type === "addon_added";
      const meta = event.metadata || {};
      const addonAmount = meta.amount as number | undefined;
      const addonReason = meta.reason as string | undefined;
      const addonSubType = meta.type as string | undefined;
      const isIn = addonSubType === "in";
      const AddonEvIcon = isAdded ? (isIn ? ArrowDownCircle : ArrowUpCircle) : XCircle;
      const addonEvColor = isAdded
        ? (isIn ? "text-success bg-success/10" : "text-warning bg-warning/10")
        : "text-destructive bg-destructive/10";

      return (
        <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${addonEvColor}`}>
            <AddonEvIcon className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-sm font-medium leading-snug">
              {isAdded ? "Addon Added" : "Addon Removed"}
              {isAdded && addonSubType && (
                <span className={`ml-1.5 inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isIn ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>
                  {isIn ? "Bonus" : "Deduction"}
                </span>
              )}
            </p>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {addonAmount != null && (
                <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${isIn ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                  {isIn ? "+" : "-"}{addonAmount.toFixed(2)} $
                </span>
              )}
              {addonReason && (
                <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {addonReason}
                </span>
              )}
            </div>
            {event.description && (
              <p className="text-[11px] text-muted-foreground mt-1">{event.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(new Date(event.created_at), "dd MMM yyyy · HH:mm")}
              </span>
              {event.agent_name && (
                <span className="text-[11px] text-muted-foreground">
                  by <span className="font-medium text-foreground/70">{event.agent_name}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Order added / removed
    if (event.type === "order_added" || event.type === "order_removed") {
      const isAdded = event.type === "order_added";
      return (
        <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${isAdded ? "text-success bg-success/10" : "text-destructive bg-destructive/10"}`}>
            {isAdded ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-sm font-medium leading-snug">
              Order {isAdded ? "Added" : "Removed"}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold font-mono ${isAdded ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {event.order_id}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(new Date(event.created_at), "dd MMM yyyy · HH:mm")}
              </span>
              {event.agent_name && (
                <span className="text-[11px] text-muted-foreground">
                  by <span className="font-medium text-foreground/70">{event.agent_name}</span>
                </span>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Addon
    if (event.type === "addon") {
      const isIn = event.addon_type === "in";
      const AddonIcon = isIn ? ArrowDownCircle : ArrowUpCircle;
      const addonColor = isIn ? "text-success bg-success/10" : "text-destructive bg-destructive/10";
      return (
        <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
          <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${addonColor}`}>
            <AddonIcon className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0 pt-0.5">
            <p className="text-sm font-medium leading-snug">
              Addon — {isIn ? "Bonus" : "Deduction"}
            </p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold ${isIn ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                {isIn ? "+" : "-"}{event.amount?.toFixed(2)} $
              </span>
              {event.reason && (
                <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {event.reason}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {format(new Date(event.created_at), "dd MMM yyyy · HH:mm")}
              </span>
            </div>
          </div>
        </div>
      );
    }

    // Order change
    const Icon = fieldIcon(event.field_changed || "");
    const color = fieldColor(event.field_changed || "");
    const label = fieldLabels[event.field_changed || ""] || event.field_changed;

    return (
      <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
        <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${color}`}>
          <Icon className="w-3.5 h-3.5" />
        </div>
        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium leading-snug">{label}</p>
            <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{event.order_id}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {event.old_value && (
              <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground line-through">
                {event.old_value}
              </span>
            )}
            {event.old_value && event.new_value && <span className="text-muted-foreground text-[10px]">→</span>}
            {event.new_value && (
              <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {event.new_value}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {format(new Date(event.created_at), "dd MMM yyyy · HH:mm")}
            </span>
            <span className="text-[11px] text-muted-foreground">
              by <span className="font-medium text-foreground/70">{event.agent_name}</span>
            </span>
            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
              {event.changed_by_role}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderTimeline = (events: TimelineEntry[]) => (
    events.length === 0 ? (
      <p className="text-sm text-muted-foreground text-center py-8">No events recorded</p>
    ) : (
      <div className="relative">
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
        <div className="space-y-0">
          {events.map(renderEvent)}
        </div>
      </div>
    )
  );

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
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="by-order" className="w-full">
            <div className="px-5 pt-3">
              <TabsList className="w-full h-8">
                <TabsTrigger value="by-order" className="text-[11px] flex-1">
                  By Order ({orderGrouped.length})
                </TabsTrigger>
                <TabsTrigger value="all" className="text-[11px] flex-1">
                  All ({timeline.length})
                </TabsTrigger>
                <TabsTrigger value="orders" className="text-[11px] flex-1">
                  Movements ({orderMovements.length})
                </TabsTrigger>
                <TabsTrigger value="status" className="text-[11px] flex-1">
                  Status ({statusChanges.length})
                </TabsTrigger>
              </TabsList>
            </div>
            <ScrollArea className="flex-1 overflow-auto" style={{ maxHeight: "calc(85vh - 120px)" }}>
              <div className="px-5 py-4">
                <TabsContent value="by-order" className="mt-0">
                  {renderOrderGrouped()}
                </TabsContent>
                <TabsContent value="all" className="mt-0">
                  {renderTimeline(timeline)}
                </TabsContent>
                <TabsContent value="orders" className="mt-0">
                  {renderTimeline(orderMovements)}
                </TabsContent>
                <TabsContent value="status" className="mt-0">
                  {renderTimeline(statusChanges)}
                </TabsContent>
              </div>
            </ScrollArea>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
