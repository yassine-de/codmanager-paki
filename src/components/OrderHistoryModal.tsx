import { useEffect, useState, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, ArrowRightLeft, UserCheck, PlusCircle, PhoneOff, CalendarClock, XCircle, DollarSign, RotateCcw, Pencil, ChevronDown } from "lucide-react";

interface HistoryEntry {
  id: string;
  order_id: string;
  changed_by: string;
  changed_by_role: string;
  field_changed: string;
  old_value: string | null;
  new_value: string | null;
  action_type: string;
  attempt_number: number | null;
  group_id: string | null;
  created_at: string;
  agent_name?: string;
}

interface GroupedEntry {
  group_id: string;
  action_type: string;
  entries: HistoryEntry[];
  created_at: string;
  agent_name: string;
  changed_by_role: string;
  attempt_number: number | null;
}

const PAGE_SIZE = 20;

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
  postpone_note: "Postpone Note",
  manual_price: "Manual Price Override",
};

function getActionIcon(actionType: string) {
  switch (actionType) {
    case "status_change": return ArrowRightLeft;
    case "retry": return RotateCcw;
    case "cancel": return XCircle;
    case "postpone": return CalendarClock;
    case "pricing": return DollarSign;
    case "edit": return Pencil;
    default: return PlusCircle;
  }
}

function getActionColor(actionType: string) {
  switch (actionType) {
    case "status_change": return "text-info bg-info/10";
    case "retry": return "text-blue-500 bg-blue-500/10";
    case "cancel": return "text-destructive bg-destructive/10";
    case "postpone": return "text-amber-500 bg-amber-500/10";
    case "pricing": return "text-emerald-500 bg-emerald-500/10";
    case "edit": return "text-warning bg-warning/10";
    default: return "text-muted-foreground bg-muted";
  }
}

function buildReadableMessage(group: GroupedEntry): string {
  const { action_type, entries, attempt_number } = group;
  const actor = group.changed_by_role === "admin" ? "Admin" : "Agent";

  if (action_type === "retry") {
    const statusEntry = entries.find(e => e.field_changed === "confirmation_status");
    const newStatus = statusEntry?.new_value || "no_answer";
    if (newStatus === "unreachable") {
      return `Attempt ${attempt_number || "?"} → NO ANSWER (Final — UNREACHABLE)`;
    }
    return `Retry Attempt ${attempt_number || "?"} → NO ANSWER`;
  }

  if (action_type === "cancel") {
    const reasonEntry = entries.find(e => e.field_changed === "cancel_reason");
    return `${actor} cancelled order${reasonEntry?.new_value ? ` (reason: ${reasonEntry.new_value})` : ""}`;
  }

  if (action_type === "postpone") {
    const dateEntry = entries.find(e => e.field_changed === "postpone_date");
    const dateStr = dateEntry?.new_value ? format(new Date(dateEntry.new_value), "dd MMM yyyy HH:mm") : "unknown date";
    return `${actor} postponed order to ${dateStr}`;
  }

  if (action_type === "status_change") {
    const statusEntry = entries.find(e => e.field_changed === "confirmation_status" || e.field_changed === "delivery_status");
    if (statusEntry) {
      return `${actor} changed ${fieldLabels[statusEntry.field_changed] || statusEntry.field_changed} from ${statusEntry.old_value?.toUpperCase() || "—"} → ${statusEntry.new_value?.toUpperCase() || "—"}`;
    }
  }

  if (action_type === "pricing") {
    return `${actor} updated pricing`;
  }

  // Generic edit
  if (entries.length === 1) {
    const e = entries[0];
    return `${actor} updated ${fieldLabels[e.field_changed] || e.field_changed}`;
  }
  return `${actor} updated order details (${entries.length} fields)`;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  customerName: string;
}

export default function OrderHistoryModal({ open, onOpenChange, orderId, customerName }: Props) {
  const [groups, setGroups] = useState<GroupedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(0);

  const fetchHistory = useCallback(async (pageNum: number) => {
    const from = pageNum * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data, error } = await supabase
      .from("order_history")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      console.error("Error fetching history:", error);
      return { entries: [], hasMore: false };
    }

    const rows = data || [];
    // Resolve names
    const userIds = [...new Set(rows.map(h => h.changed_by))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, name")
      .in("user_id", userIds);
    const nameMap = new Map((profiles || []).map(p => [p.user_id, p.name]));

    const entries: HistoryEntry[] = rows.map(h => ({
      ...h,
      action_type: (h as any).action_type || "edit",
      attempt_number: (h as any).attempt_number || null,
      group_id: (h as any).group_id || h.id,
      agent_name: nameMap.get(h.changed_by) || "Unknown",
    }));

    return { entries, hasMore: rows.length === PAGE_SIZE };
  }, [orderId]);

  const groupEntries = (entries: HistoryEntry[]): GroupedEntry[] => {
    const map = new Map<string, HistoryEntry[]>();
    for (const e of entries) {
      const key = e.group_id || e.id;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).map(([gid, items]) => ({
      group_id: gid,
      action_type: items[0].action_type,
      entries: items,
      created_at: items[0].created_at,
      agent_name: items[0].agent_name || "Unknown",
      changed_by_role: items[0].changed_by_role,
      attempt_number: items[0].attempt_number,
    }));
  };

  useEffect(() => {
    if (!open || !orderId) return;
    setLoading(true);
    setPage(0);
    setGroups([]);
    fetchHistory(0).then(({ entries, hasMore: more }) => {
      setGroups(groupEntries(entries));
      setHasMore(more);
      setLoading(false);
    });
  }, [open, orderId, fetchHistory]);

  const loadMore = async () => {
    const nextPage = page + 1;
    setLoadingMore(true);
    const { entries, hasMore: more } = await fetchHistory(nextPage);
    setGroups(prev => [...prev, ...groupEntries(entries)]);
    setHasMore(more);
    setPage(nextPage);
    setLoadingMore(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Order History
            <span className="ml-2 text-xs font-normal text-muted-foreground">{orderId} · {customerName}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="px-5 py-4">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No history recorded yet</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />
                <div className="space-y-0">
                  {groups.map((group) => {
                    const Icon = getActionIcon(group.action_type);
                    const color = getActionColor(group.action_type);
                    const message = buildReadableMessage(group);

                    return (
                      <div key={group.group_id} className="relative flex gap-3 pb-5 last:pb-0">
                        <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${color}`}>
                          <Icon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0 pt-0.5">
                          <p className="text-sm font-medium leading-snug">{message}</p>

                          {/* Show field changes for edits with multiple fields */}
                          {group.entries.length > 0 && group.action_type !== "retry" && (
                            <div className="mt-1.5 space-y-1">
                              {group.entries.map(e => (
                                <div key={e.id} className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-[10px] text-muted-foreground font-medium">{fieldLabels[e.field_changed] || e.field_changed}:</span>
                                  {e.old_value && (
                                    <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground line-through">
                                      {e.old_value}
                                    </span>
                                  )}
                                  {e.old_value && e.new_value && <span className="text-muted-foreground text-[10px]">→</span>}
                                  {e.new_value && (
                                    <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                      {e.new_value}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[11px] text-muted-foreground tabular-nums">
                              {format(new Date(group.created_at), "dd MMM yyyy · HH:mm")}
                            </span>
                            <span className="text-[11px] text-muted-foreground">
                              by <span className="font-medium text-foreground/70">{group.agent_name}</span>
                            </span>
                            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
                              {group.changed_by_role}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {hasMore && (
                  <div className="pt-4 text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="gap-1.5 text-xs"
                    >
                      {loadingMore ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronDown className="h-3 w-3" />}
                      Load more
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
