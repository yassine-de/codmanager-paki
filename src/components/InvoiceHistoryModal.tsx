import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowRightLeft, UserCheck, PlusCircle, Package } from "lucide-react";

interface HistoryEntry {
  id: string;
  order_id: string;
  changed_by: string;
  changed_by_role: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  agent_name?: string;
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
  /** For virtual drafts, pass order IDs directly */
  orderIds?: string[];
}

export default function InvoiceHistoryModal({ open, onOpenChange, invoiceId, invoiceNumber, orderIds }: Props) {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;

    const fetchHistory = async () => {
      setLoading(true);

      // Get order_ids for this invoice
      let resolvedOrderIds = orderIds || [];

      if (!orderIds?.length && invoiceId) {
        const { data: orders } = await supabase
          .from("orders")
          .select("order_id")
          .eq("invoice_id", invoiceId);
        resolvedOrderIds = (orders || []).map(o => o.order_id);
      }

      if (resolvedOrderIds.length === 0) {
        setHistory([]);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("order_history")
        .select("*")
        .in("order_id", resolvedOrderIds)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching history:", error);
        setHistory([]);
        setLoading(false);
        return;
      }

      // Resolve user names
      const userIds = [...new Set((data || []).map(h => h.changed_by))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", userIds);

      const nameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));

      setHistory((data || []).map(h => ({
        ...h,
        agent_name: nameMap.get(h.changed_by) || "Unknown",
      })));
      setLoading(false);
    };

    fetchHistory();
  }, [open, invoiceId, orderIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            Invoice History
            <span className="text-xs font-normal text-muted-foreground">— {invoiceNumber}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No history recorded yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
                <div className="space-y-0">
                  {history.map((event) => {
                    const Icon = fieldIcon(event.field_changed);
                    const color = fieldColor(event.field_changed);
                    const label = fieldLabels[event.field_changed] || event.field_changed;

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
                  })}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
