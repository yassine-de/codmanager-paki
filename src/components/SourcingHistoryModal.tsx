import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Clock, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface SourcingHistoryModalProps {
  requestId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const fieldLabels: Record<string, string> = {
  status: "Status",
  payment_status: "Payment Status",
  seller_validated: "Seller Validation",
  quantity: "Quantity",
  landed_price: "Landed Price",
  seller_price: "Seller Price",
  product_weight: "Product Weight",
  payment_method: "Payment Method",
};

const statusLabels: Record<string, string> = {
  waiting_quote: "Waiting Quote",
  working_on_it: "Working On It",
  quoted: "Quoted",
  validated: "Validated",
  ordered: "Ordered",
  shipped: "Shipped",
  received: "Received",
  cancelled: "Cancelled",
  unpaid: "Unpaid",
  paid: "Paid",
  true: "Validated",
  false: "Cancelled",
  null: "Pending",
};

function formatValue(field: string, value: string | null): string {
  if (value === null || value === "null") return "—";
  if (field === "seller_validated") return statusLabels[value] || value;
  if (field === "status" || field === "payment_status") return statusLabels[value] || value;
  if (field === "landed_price" || field === "seller_price") return `$${value}`;
  if (field === "product_weight") return `${value} kg`;
  return value;
}

export function SourcingHistoryModal({ requestId, open, onOpenChange }: SourcingHistoryModalProps) {
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ["sourcing-history", requestId],
    queryFn: async () => {
      if (!requestId) return [];
      const { data, error } = await supabase
        .from("sourcing_history")
        .select("*")
        .eq("sourcing_request_id", requestId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Fetch profile names for changed_by
      const userIds = [...new Set(data.map((e: any) => e.changed_by))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", userIds);
      const nameMap: Record<string, string> = {};
      profiles?.forEach((p: any) => { nameMap[p.user_id] = p.name; });

      return data.map((e: any) => ({ ...e, changed_by_name: nameMap[e.changed_by] || "Unknown" }));
    },
    enabled: open && !!requestId,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            Sourcing History
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-2">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">No history recorded yet.</p>
          ) : (
            <div className="relative pl-6 space-y-0">
              {/* Timeline line */}
              <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

              {entries.map((entry: any, i: number) => (
                <div key={entry.id} className="relative pb-5 last:pb-0">
                  {/* Timeline dot */}
                  <div className="absolute -left-6 top-1.5 w-[10px] h-[10px] rounded-full border-2 border-primary bg-background" />

                  <div className="rounded-lg border bg-card p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-primary">
                        {fieldLabels[entry.field_changed] || entry.field_changed}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {format(new Date(entry.created_at), "dd MMM yyyy · HH:mm")}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">
                        {formatValue(entry.field_changed, entry.old_value)}
                      </span>
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">
                        {formatValue(entry.field_changed, entry.new_value)}
                      </span>
                    </div>

                    <p className="text-[10px] text-muted-foreground">
                      by <span className="font-medium text-foreground">{entry.changed_by_name}</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
