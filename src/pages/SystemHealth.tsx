import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity, AlertTriangle, CheckCircle2, Clock, Database, Globe,
  Loader2, Package, RefreshCw, Server, ShieldAlert, Truck, XCircle, Zap
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { formatPKT as format } from "@/lib/timezone";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
interface SyncIssueOrder {
  id: string;
  order_id: string;
  system_id: number | null;
  carrier_order_id: string | null;
  sync_status: string | null;
  sync_error: string | null;
  carrier_status: string | null;
  delivery_status: string | null;
  customer_name: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function SystemHealth() {
  const [retrying, setRetrying] = useState<string | null>(null);

  // ---- KPI queries (parallel) ----
  const { data: syncErrors = [], isLoading: loadingSyncErrors, refetch: refetchSyncErrors } = useQuery({
    queryKey: ["system-health-sync-errors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments" as any)
        .select("id, order_id, carrier_order_id, sync_status, sync_error, carrier_status, normalized_status, created_at, orders(system_id, delivery_status, customer_name)")
        .eq("sync_status", "failed")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as SyncIssueOrder[];
    },
    refetchInterval: 30000,
  });

  const { data: unmappedOrders = [], isLoading: loadingUnmapped } = useQuery({
    queryKey: ["system-health-unmapped"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments" as any)
        .select("id, order_id, carrier_order_id, sync_status, sync_error, carrier_status, normalized_status, created_at, orders(system_id, delivery_status, customer_name)")
        .eq("normalized_status", "booked")
        .not("carrier_status", "is", null)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as SyncIssueOrder[];
    },
    refetchInterval: 30000,
  });

  const { data: pendingSync = [], isLoading: loadingPending } = useQuery({
    queryKey: ["system-health-pending-sync"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipments" as any)
        .select("id, order_id, carrier_order_id, sync_status, sync_error, carrier_status, normalized_status, created_at, orders(system_id, delivery_status, customer_name)")
        .eq("sync_status", "pending")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as SyncIssueOrder[];
    },
    refetchInterval: 30000,
  });

  const { data: lastSync } = useQuery({
    queryKey: ["system-health-last-sync"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "orio_last_status_sync")
        .maybeSingle();
      return data?.value || null;
    },
    refetchInterval: 30000,
  });

  const { data: orioEnabled } = useQuery({
    queryKey: ["system-health-orio-enabled"],
    queryFn: async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "orio_api_enabled")
        .maybeSingle();
      return data?.value === "true";
    },
  });

  const { data: totalCarrierShipments = 0 } = useQuery({
    queryKey: ["system-health-total-orio"],
    queryFn: async () => {
      const { count } = await supabase
        .from("shipments" as any)
        .select("*", { count: "exact", head: true })
      return count || 0;
    },
    refetchInterval: 60000,
  });

  const { data: totalOrders = 0 } = useQuery({
    queryKey: ["system-health-total"],
    queryFn: async () => {
      const { count } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
    refetchInterval: 60000,
  });

  // ---- Actions ----
  const handleRetrySync = async (order: SyncIssueOrder) => {
    setRetrying(order.id);
    try {
      await supabase
        .from("shipments" as any)
        .update({ sync_status: "pending", sync_error: null })
        .eq("id", order.id);

      const { error } = await supabase.functions.invoke("orio-sync", {
        body: { action: "sync-order", order_id: order.order_id },
      });
      if (error) throw error;
      toast.success(`Retry triggered for ${order.order_id}`);
      refetchSyncErrors();
    } catch (e: any) {
      toast.error(e.message || "Retry failed");
    } finally {
      setRetrying(null);
    }
  };

  const handleTriggerStatusSync = async () => {
    try {
      const { error } = await supabase.functions.invoke("orio-status-sync");
      if (error) throw error;
      toast.success("Status sync triggered");
    } catch (e: any) {
      toast.error(e.message || "Failed");
    }
  };

  // ---- Derived ----
  const isLoading = loadingSyncErrors || loadingUnmapped || loadingPending;
  const healthScore = totalCarrierShipments > 0
    ? Math.round(((totalCarrierShipments - syncErrors.length) / totalCarrierShipments) * 100)
    : 100;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            System Health
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Technical overview and issue monitoring</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={handleTriggerStatusSync}>
          <RefreshCw className="h-3.5 w-3.5" /> Trigger Status Sync
        </Button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <KpiCard
          icon={<Zap className="h-4 w-4" />}
          label="Health Score"
          value={`${healthScore}%`}
          color={healthScore >= 95 ? "text-emerald-600" : healthScore >= 80 ? "text-amber-500" : "text-red-500"}
        />
        <KpiCard icon={<Database className="h-4 w-4" />} label="Total Orders" value={String(totalOrders)} />
        <KpiCard icon={<Truck className="h-4 w-4" />} label="Carrier Synced" value={String(totalCarrierShipments)} />
        <KpiCard
          icon={<XCircle className="h-4 w-4" />}
          label="Sync Errors"
          value={String(syncErrors.length)}
          color={syncErrors.length > 0 ? "text-red-500" : "text-emerald-600"}
        />
        <KpiCard
          icon={<Clock className="h-4 w-4" />}
          label="Pending Sync"
          value={String(pendingSync.length)}
          color={pendingSync.length > 0 ? "text-amber-500" : "text-emerald-600"}
        />
        <KpiCard
          icon={<Globe className="h-4 w-4" />}
          label="Last Sync"
          value={lastSync ? formatDistanceToNow(new Date(lastSync), { addSuffix: true }) : "Never"}
          small
        />
      </div>

      {/* Service Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ServiceCard
          title="Shipping API"
          status={orioEnabled ? "operational" : "disabled"}
          detail={orioEnabled ? "Integration active" : "Integration disabled"}
        />
        <ServiceCard
          title="Status Sync (Cron)"
          status={lastSync && (Date.now() - new Date(lastSync).getTime()) < 10 * 60 * 1000 ? "operational" : "warning"}
          detail={lastSync ? `Last run: ${format(new Date(lastSync), "dd MMM HH:mm")}` : "No data"}
        />
        <ServiceCard
          title="Database"
          status="operational"
          detail={`${totalOrders} orders tracked`}
        />
      </div>

      {/* Issue Tabs */}
      <Tabs defaultValue="sync-errors" className="space-y-3">
        <TabsList className="bg-muted/60">
          <TabsTrigger value="sync-errors" className="text-xs gap-1.5">
            <XCircle className="h-3.5 w-3.5" /> Sync Errors
            {syncErrors.length > 0 && <Badge variant="destructive" className="ml-1 text-[9px] px-1.5 py-0">{syncErrors.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="unmapped" className="text-xs gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" /> Booked w/ Carrier Status
            {unmappedOrders.length > 0 && <Badge variant="warning" className="ml-1 text-[9px] px-1.5 py-0">{unmappedOrders.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-xs gap-1.5">
            <Clock className="h-3.5 w-3.5" /> Pending
            {pendingSync.length > 0 && <Badge variant="info" className="ml-1 text-[9px] px-1.5 py-0">{pendingSync.length}</Badge>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sync-errors">
          <IssueTable
            orders={syncErrors}
            loading={loadingSyncErrors}
            emptyMessage="No sync errors — all systems running smoothly."
            showError
            retrying={retrying}
            onRetry={handleRetrySync}
          />
        </TabsContent>

        <TabsContent value="unmapped">
          <IssueTable
            orders={unmappedOrders}
            loading={loadingUnmapped}
            emptyMessage="No orders stuck in booked status with a carrier status."
            showOrioStatus
          />
        </TabsContent>

        <TabsContent value="pending">
          <IssueTable
            orders={pendingSync}
            loading={loadingPending}
            emptyMessage="No orders pending sync."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */
function KpiCard({ icon, label, value, color, small }: {
  icon: React.ReactNode; label: string; value: string; color?: string; small?: boolean;
}) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className={`${small ? "text-xs" : "text-lg"} font-bold ${color || "text-foreground"} truncate`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function ServiceCard({ title, status, detail }: {
  title: string; status: "operational" | "warning" | "error" | "disabled"; detail: string;
}) {
  const config = {
    operational: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, badge: <Badge variant="success" className="text-[10px]">Operational</Badge> },
    warning: { icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, badge: <Badge variant="warning" className="text-[10px]">Warning</Badge> },
    error: { icon: <XCircle className="h-4 w-4 text-red-500" />, badge: <Badge variant="destructive" className="text-[10px]">Error</Badge> },
    disabled: { icon: <ShieldAlert className="h-4 w-4 text-muted-foreground" />, badge: <Badge variant="secondary" className="text-[10px]">Disabled</Badge> },
  };
  const c = config[status];

  return (
    <Card className="border-border/60">
      <CardContent className="p-3 flex items-center gap-3">
        {c.icon}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          <p className="text-[10px] text-muted-foreground truncate">{detail}</p>
        </div>
        {c.badge}
      </CardContent>
    </Card>
  );
}

function IssueTable({ orders, loading, emptyMessage, showError, showOrioStatus, retrying, onRetry }: {
  orders: SyncIssueOrder[];
  loading: boolean;
  emptyMessage: string;
  showError?: boolean;
  showOrioStatus?: boolean;
  retrying?: string | null;
  onRetry?: (o: SyncIssueOrder) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <Card className="border-border/60">
        <CardContent className="py-10 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60">
      <CardContent className="p-0">
        <div className="rounded-md border-0 overflow-auto max-h-[420px]">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40">
                <TableHead className="text-[11px] font-semibold h-9">Order ID</TableHead>
                <TableHead className="text-[11px] font-semibold h-9">System ID</TableHead>
                <TableHead className="text-[11px] font-semibold h-9">Customer</TableHead>
                <TableHead className="text-[11px] font-semibold h-9">Delivery Status</TableHead>
                {showOrioStatus && <TableHead className="text-[11px] font-semibold h-9">Carrier Status</TableHead>}
                {showError && <TableHead className="text-[11px] font-semibold h-9">Error</TableHead>}
                <TableHead className="text-[11px] font-semibold h-9">Date</TableHead>
                {onRetry && <TableHead className="text-[11px] font-semibold h-9 text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} className="hover:bg-muted/30">
                  <TableCell className="text-xs font-medium py-2">{o.order_id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground py-2">{(o as any).orders?.system_id || "—"}</TableCell>
                  <TableCell className="text-xs py-2">{(o as any).orders?.customer_name || ""}</TableCell>
                  <TableCell className="py-2">
                    <Badge variant="secondary" className="text-[10px]">{(o as any).orders?.delivery_status || (o as any).normalized_status || "—"}</Badge>
                  </TableCell>
                  {showOrioStatus && (
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px]">{o.carrier_status || "—"}</Badge>
                    </TableCell>
                  )}
                  {showError && (
                    <TableCell className="text-xs text-destructive py-2 max-w-[250px] truncate" title={o.sync_error || ""}>
                      {o.sync_error || "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground py-2">
                    {format(new Date(o.created_at), "dd MMM HH:mm")}
                  </TableCell>
                  {onRetry && (
                    <TableCell className="text-right py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] gap-1"
                        disabled={retrying === o.id}
                        onClick={() => onRetry(o)}
                      >
                        {retrying === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Retry
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
