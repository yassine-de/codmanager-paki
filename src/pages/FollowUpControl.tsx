import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { Badge } from "@/components/ui/badge";
import { Search, ListChecks, FileText } from "lucide-react";
import { formatPKT as format } from "@/lib/timezone";

interface FollowUpRow {
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  delivery_status: string | null;
  follow_up_status: string;
  follow_up_updated_at: string | null;
  follow_up_assigned_to: string | null;
  follow_up_note: string | null;
  order_created_at: string;
}

const FU_STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  { value: "contacted_courier", label: "Contacted Courier" },
  { value: "contacted_client", label: "Contacted Client" },
  { value: "client_confirmed", label: "Client Confirmed" },
  { value: "resent_to_courier", label: "Resent to Courier" },
  { value: "closed", label: "Closed" },
];

const followUpStatusStyle: Record<string, string> = {
  contacted_courier: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
  contacted_client: "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/25",
  client_confirmed: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  resent_to_courier: "bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/25",
  closed: "bg-[hsl(155,50%,42%)]/15 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/30 font-semibold",
};

const deliveryStatusStyle: Record<string, string> = {
  booked: "bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/25",
  shipped: "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/25",
  in_transit: "bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/25",
  with_courier: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  out_for_delivery: "bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/25",
  delivered: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  failed_attempt: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
  return_received: "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/25",
  returned: "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/25",
};

function formatStatus(status: string | null): string {
  if (!status) return "—";
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function StatusPill({ value, styleMap }: { value: string | null; styleMap: Record<string, string> }) {
  if (!value) return <span className="text-muted-foreground text-xs">—</span>;
  const cls = styleMap[value] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}
    >
      {formatStatus(value)}
    </span>
  );
}

export default function FollowUpControl() {
  const { authUser, loading: authLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["follow-up-control"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_follow_ups_data");
      if (error) throw error;
      return (data ?? []) as FollowUpRow[];
    },
    enabled: !!authUser && authUser.role === "follow_up",
    refetchInterval: 30000,
  });

  // Only treated orders (status != pending)
  const treated = useMemo(() => rows.filter((r) => r.follow_up_status !== "pending"), [rows]);

  const filtered = useMemo(() => {
    return treated.filter((r) => {
      if (filterStatus !== "all" && r.follow_up_status !== filterStatus) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const hay = [r.order_id, r.customer_name, r.customer_phone, r.customer_city]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [treated, filterStatus, search]);

  if (!authLoading && authUser && authUser.role !== "follow_up") {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="space-y-6 max-w-[1500px] animate-fade-in">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-semibold">Control</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          Orders you've already taken action on. Read-only history view.
        </p>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search order, customer, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FU_STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Badge variant="secondary" className="ml-auto">
            {filtered.length.toLocaleString()} {filtered.length === 1 ? "order" : "orders"}
          </Badge>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>City</TableHead>
                <TableHead>Delivery</TableHead>
                <TableHead>Follow Up Status</TableHead>
                <TableHead>My Note</TableHead>
                <TableHead>Last Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-muted-foreground text-sm">
                    No treated orders yet.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((r) => (
                  <TableRow key={r.order_id}>
                    <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                    <TableCell className="text-sm">{r.customer_name}</TableCell>
                    <TableCell className="text-sm font-mono">{r.customer_phone}</TableCell>
                    <TableCell className="text-sm">{r.customer_city}</TableCell>
                    <TableCell>
                      <StatusPill value={r.delivery_status} styleMap={deliveryStatusStyle} />
                    </TableCell>
                    <TableCell>
                      <StatusPill value={r.follow_up_status} styleMap={followUpStatusStyle} />
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      {r.follow_up_note ? (
                        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
                          <FileText className="h-3 w-3 mt-0.5 shrink-0 opacity-50" />
                          <span className="line-clamp-2">{r.follow_up_note}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground/50 text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {r.follow_up_updated_at
                        ? format(new Date(r.follow_up_updated_at), "MMM d, HH:mm")
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}
