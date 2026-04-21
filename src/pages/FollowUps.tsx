import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Search, ClipboardCheck, AlertTriangle, Clock, Activity } from "lucide-react";
import { format } from "date-fns";

type Segment = "all" | "failed_attempt" | "delayed" | "on_going";

const FOLLOW_UP_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "contacted_courier", label: "Contacted Courier" },
  { value: "contacted_client", label: "Contacted Client" },
  { value: "client_confirmed", label: "Client Confirmed" },
  { value: "resent_to_courier", label: "Resent to Courier" },
  { value: "closed", label: "Closed" },
];

interface FollowUpRow {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  delivery_status: string | null;
  shipping_status: string | null;
  orio_order_id: number | null;
  orio_consignment_no: string | null;
  shipped_at: string | null;
  days_since_shipped: number | null;
  follow_up_status: string;
  follow_up_updated_at: string | null;
  follow_up_updated_by: string | null;
  order_updated_at: string;
}

function computeSegment(row: FollowUpRow): "failed_attempt" | "delayed" | "on_going" | null {
  const ds = row.delivery_status;
  const days = row.days_since_shipped ?? 0;

  if (ds === "failed_attempt") return "failed_attempt";
  if (
    (ds === "in_transit" || ds === "out_for_delivery") &&
    days >= 3
  ) {
    return "delayed";
  }
  if (
    (ds === "shipped" || ds === "in_transit" || ds === "out_for_delivery") &&
    days < 3
  ) {
    return "on_going";
  }
  return null;
}

const segmentMeta: Record<
  "failed_attempt" | "delayed" | "on_going",
  { label: string; className: string; icon: typeof AlertTriangle }
> = {
  failed_attempt: {
    label: "Failed Attempt",
    className: "bg-destructive/12 text-destructive border-destructive/20",
    icon: AlertTriangle,
  },
  delayed: {
    label: "Delayed",
    className: "bg-warning/12 text-warning border-warning/20",
    icon: Clock,
  },
  on_going: {
    label: "On Going",
    className: "bg-info/12 text-info border-info/20",
    icon: Activity,
  },
};

function formatDeliveryStatus(status: string | null): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function FollowUps() {
  const { authUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [segment, setSegment] = useState<Segment>("all");
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ["follow-ups-data"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!authUser && (authUser.role === "admin" || authUser.role === "agent"),
    refetchInterval: 30000,
  });

  // Realtime subscription on order_follow_ups
  useEffect(() => {
    const channel = supabase
      .channel("follow-ups-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "order_follow_ups" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["follow-ups-data"] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const enriched = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        segment: computeSegment(r),
      })),
    [rows]
  );

  const counts = useMemo(() => {
    const c = { failed_attempt: 0, delayed: 0, on_going: 0 };
    for (const r of enriched) {
      if (r.segment) c[r.segment]++;
    }
    return c;
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((r) => {
      if (segment !== "all" && r.segment !== segment) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        if (
          !r.order_id.toLowerCase().includes(q) &&
          !r.customer_name.toLowerCase().includes(q) &&
          !r.customer_phone.toLowerCase().includes(q) &&
          !r.customer_city.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [enriched, segment, search]);

  // Block sellers / unauthorized — AFTER all hooks
  if (!authLoading && authUser) {
    if (authUser.role !== "admin" && authUser.role !== "agent") {
      return <Navigate to="/" replace />;
    }
  }

  async function handleStatusChange(orderId: string, newStatus: string) {
    if (!authUser) return;
    setSavingId(orderId);
    try {
      const { error } = await supabase
        .from("order_follow_ups")
        .upsert(
          {
            order_id: orderId,
            follow_up_status: newStatus,
            updated_by: authUser.id,
          },
          { onConflict: "order_id" }
        );
      if (error) throw error;
      toast.success("Follow-up updated");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to update follow-up");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6 max-w-[1400px] animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Follow Ups</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Track shipped orders that need attention. Auto-segmented by delivery status & age.
        </p>
      </div>

      {/* Segment cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(["failed_attempt", "delayed", "on_going"] as const).map((seg) => {
          const meta = segmentMeta[seg];
          const Icon = meta.icon;
          const active = segment === seg;
          return (
            <button
              key={seg}
              onClick={() => setSegment(active ? "all" : seg)}
              className={`text-left rounded-xl border p-4 transition-all hover:shadow-soft ${
                active ? "ring-2 ring-primary border-primary" : "bg-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-md ${meta.className.split(" ").slice(0, 2).join(" ")}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-sm font-medium">{meta.label}</span>
                </div>
                <span className="text-2xl font-bold tabular-nums">{counts[seg]}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <div className="flex gap-1.5 flex-wrap">
            <Button
              size="sm"
              variant={segment === "all" ? "default" : "outline"}
              onClick={() => setSegment("all")}
            >
              All ({enriched.length})
            </Button>
            <Button
              size="sm"
              variant={segment === "failed_attempt" ? "default" : "outline"}
              onClick={() => setSegment("failed_attempt")}
            >
              Failed Attempt ({counts.failed_attempt})
            </Button>
            <Button
              size="sm"
              variant={segment === "delayed" ? "default" : "outline"}
              onClick={() => setSegment("delayed")}
            >
              Delayed ({counts.delayed})
            </Button>
            <Button
              size="sm"
              variant={segment === "on_going" ? "default" : "outline"}
              onClick={() => setSegment("on_going")}
            >
              On Going ({counts.on_going})
            </Button>
          </div>
          <div className="relative flex-1 max-w-sm sm:ml-auto">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search order ID, name, phone, city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order ID</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Delivery Status</TableHead>
              <TableHead className="text-center">Days Shipped</TableHead>
              <TableHead>Segment</TableHead>
              <TableHead className="min-w-[180px]">Follow Up Status</TableHead>
              <TableHead>Last Update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-12">
                  No follow-ups found
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const segMeta = row.segment ? segmentMeta[row.segment] : null;
                return (
                  <TableRow key={row.order_id}>
                    <TableCell className="font-mono text-xs font-medium">
                      {row.order_id}
                    </TableCell>
                    <TableCell className="text-sm">{row.customer_name || "—"}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      {row.customer_phone || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{row.customer_city || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {formatDeliveryStatus(row.delivery_status)}
                    </TableCell>
                    <TableCell className="text-center tabular-nums text-sm">
                      {row.days_since_shipped ?? "—"}
                    </TableCell>
                    <TableCell>
                      {segMeta ? (
                        <Badge
                          variant="outline"
                          className={segMeta.className}
                        >
                          {segMeta.label}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.follow_up_status}
                        onValueChange={(v) => handleStatusChange(row.order_id, v)}
                        disabled={savingId === row.order_id}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FOLLOW_UP_STATUSES.map((s) => (
                            <SelectItem key={s.value} value={s.value} className="text-xs">
                              {s.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">
                      {row.follow_up_updated_at
                        ? format(new Date(row.follow_up_updated_at), "dd MMM HH:mm")
                        : "—"}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
