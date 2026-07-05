import { FormEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Boxes, CheckCircle2, ClipboardList, PackageCheck, Printer, RotateCcw, ScanLine, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatPKT as format } from "@/lib/timezone";

type ReturnCondition = "sellable" | "damaged" | "needs_inspection" | "missing_item" | "wrong_item";

interface FulfillmentRow {
  fulfillment_item_id: string;
  fulfillment_item_status: string;
  batch_number: string | null;
  order_id: string;
  system_id: number | null;
  customer_name: string;
  customer_city: string;
  total_amount: number;
  shipment_id: string;
  tracking_number: string | null;
  carrier_name: string;
  created_at: string;
  updated_at: string;
}

interface InventoryRow {
  id: string;
  sku: string | null;
  product_name: string;
  variant_name: string | null;
  location_code: string;
  location_name: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
}

interface ScanEvent {
  id: string;
  tracking_number: string;
  scan_type: string;
  result: string;
  message: string | null;
  scanned_at: string;
  shipments?: { order_id: string | null } | null;
}

function resultVariant(result: string) {
  if (result === "ok") return "success";
  if (result === "duplicate") return "warning";
  if (result === "unknown" || result === "error") return "destructive";
  return "secondary";
}

export default function Warehouse() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const outboundInput = useRef<HTMLInputElement>(null);
  const returnInput = useRef<HTMLInputElement>(null);
  const [outboundTracking, setOutboundTracking] = useState("");
  const [returnTracking, setReturnTracking] = useState("");
  const [returnCondition, setReturnCondition] = useState<ReturnCondition>("sellable");
  const [returnNote, setReturnNote] = useState("");
  const [queueStatus, setQueueStatus] = useState<string>("pending");
  const [busy, setBusy] = useState(false);
  const [printingLabels, setPrintingLabels] = useState(false);

  const isWarehouseUser = authUser?.role === "admin" || authUser?.role === "warehouse_agent" || authUser?.role === "warehouse_manager";

  const { data: fulfillmentQueue = [], isLoading: loadingQueue } = useQuery({
    queryKey: ["warehouse-fulfillment-queue", queueStatus],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fulfillment_queue" as any, {
        p_limit: 80,
        p_status: queueStatus === "all" ? null : queueStatus,
      });
      if (error) throw error;
      return (data || []) as FulfillmentRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: inventory = [], isLoading: loadingInventory } = useQuery({
    queryKey: ["warehouse-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_balance_view" as any)
        .select("*")
        .order("product_name", { ascending: true })
        .limit(200);
      if (error) throw error;
      return (data || []) as InventoryRow[];
    },
    enabled: isWarehouseUser,
  });

  const { data: recentScans = [] } = useQuery({
    queryKey: ["warehouse-recent-scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_events" as any)
        .select("id, tracking_number, scan_type, result, message, scanned_at, shipments(order_id)")
        .order("scanned_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data || []) as ScanEvent[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 10000,
  });

  const stats = useMemo(() => {
    const pending = fulfillmentQueue.filter((row) => row.fulfillment_item_status === "pending").length;
    const packed = fulfillmentQueue.filter((row) => ["packed", "label_printed"].includes(row.fulfillment_item_status)).length;
    const scanned = fulfillmentQueue.filter((row) => row.fulfillment_item_status === "scanned").length;
    const onHand = inventory.reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0);
    return { pending, packed, scanned, onHand };
  }, [fulfillmentQueue, inventory]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouse-fulfillment-queue"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-inventory"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-recent-scans"] });
  };

  const pendingTrackingNumbers = useMemo(() => {
    return fulfillmentQueue
      .filter((row) => row.fulfillment_item_status === "pending" && row.tracking_number)
      .map((row) => row.tracking_number as string);
  }, [fulfillmentQueue]);

  const openPdf = (base64: string, label: string) => {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) {
      const link = document.createElement("a");
      link.href = url;
      link.download = label;
      link.click();
    } else {
      setTimeout(() => popup.print(), 700);
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const printLabels = async () => {
    if (pendingTrackingNumbers.length === 0) {
      toast.info("No pending labels to print");
      return;
    }
    setPrintingLabels(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < pendingTrackingNumbers.length; i += 10) {
        chunks.push(pendingTrackingNumbers.slice(i, i + 10));
      }

      for (let i = 0; i < chunks.length; i += 1) {
        const { data, error } = await supabase.functions.invoke("shipping-sync", {
          body: {
            action: "generate-labels",
            tracking_numbers: chunks[i],
          },
        });
        if (error) throw error;
        if (!data?.pdf_base64) throw new Error("PostEx did not return a label PDF");
        openPdf(data.pdf_base64, `postex-labels-${i + 1}.pdf`);
      }

      toast.success(`Opened ${pendingTrackingNumbers.length} labels for printing`);
    } catch (error: any) {
      toast.error(error.message || "Label printing failed");
    } finally {
      setPrintingLabels(false);
    }
  };

  const scanOutbound = async (event: FormEvent) => {
    event.preventDefault();
    const tracking = outboundTracking.trim();
    if (!tracking) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("scan_outbound_shipment" as any, {
        p_tracking_number: tracking,
        p_scanned_by: authUser?.id,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.result === "unknown") toast.error("Unknown tracking number");
      else if (result?.result === "duplicate") toast.warning("Shipment was already scanned");
      else toast.success("Package shipped, queue completed and stock deducted");
      setOutboundTracking("");
      refresh();
      setTimeout(() => outboundInput.current?.focus(), 50);
    } catch (error: any) {
      toast.error(error.message || "Scan failed");
    } finally {
      setBusy(false);
    }
  };

  const scanReturn = async (event: FormEvent) => {
    event.preventDefault();
    const tracking = returnTracking.trim();
    if (!tracking) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("scan_return_shipment" as any, {
        p_tracking_number: tracking,
        p_condition: returnCondition,
        p_scanned_by: authUser?.id,
        p_note: returnNote.trim() || null,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.result === "unknown") toast.error("Unknown return tracking number");
      else if (result?.result === "duplicate") toast.warning("Return was already received");
      else toast.success("Return received and stock updated");
      setReturnTracking("");
      setReturnNote("");
      refresh();
      setTimeout(() => returnInput.current?.focus(), 50);
    } catch (error: any) {
      toast.error(error.message || "Return scan failed");
    } finally {
      setBusy(false);
    }
  };

  if (!isWarehouseUser) {
    return (
      <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">
        You do not have access to the warehouse module.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <WarehouseIcon className="h-5 w-5 text-primary" />
            Warehouse
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Fast scan desk for outbound packages, returns and inventory.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<ClipboardList className="h-4 w-4" />} label="Pending" value={stats.pending} />
        <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Packed/Label" value={stats.packed} />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Scanned" value={stats.scanned} />
        <Kpi icon={<Boxes className="h-4 w-4" />} label="On Hand" value={stats.onHand} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-4">
        <Card className="border-primary/30 bg-primary/[0.03]">
          <CardHeader className="py-4">
            <CardTitle className="text-base flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /> Ship Package</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="flex gap-2" onSubmit={scanOutbound}>
              <Input
                ref={outboundInput}
                className="h-12 text-base font-mono bg-background"
                value={outboundTracking}
                onChange={(e) => setOutboundTracking(e.target.value)}
                placeholder="Scan PostEx tracking number"
                autoComplete="off"
                autoFocus
              />
              <Button type="submit" disabled={busy} className="h-12 shrink-0 px-6">
                <ScanLine className="h-4 w-4 mr-2" />
                Ship
              </Button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Picked</Badge>
              <Badge variant="secondary">Packed</Badge>
              <Badge variant="secondary">Label</Badge>
              <Badge variant="secondary">Stock deducted</Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Return Scan</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-2" onSubmit={scanReturn}>
              <div className="flex gap-2">
                <Input
                  ref={returnInput}
                  className="h-10 font-mono"
                  value={returnTracking}
                  onChange={(e) => setReturnTracking(e.target.value)}
                  placeholder="Scan return tracking number"
                  autoComplete="off"
                />
                <Select value={returnCondition} onValueChange={(value: ReturnCondition) => setReturnCondition(value)}>
                  <SelectTrigger className="h-10 w-[170px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sellable">Sellable</SelectItem>
                    <SelectItem value="needs_inspection">Inspection</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="missing_item">Missing item</SelectItem>
                    <SelectItem value="wrong_item">Wrong item</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" disabled={busy} className="shrink-0">Receive</Button>
              </div>
              <Textarea className="min-h-[56px] text-xs" value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Optional note" />
            </form>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="queue" className="space-y-3">
        <TabsList>
          <TabsTrigger value="queue">Fulfillment Queue</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="scans">Recent Scans</TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          <Card className="border-border/60">
            <CardHeader className="py-3 flex-row items-center justify-between">
              <CardTitle className="text-sm">Queue</CardTitle>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  className="h-8 text-xs"
                  onClick={printLabels}
                  disabled={printingLabels || pendingTrackingNumbers.length === 0}
                >
                  <Printer className="h-3.5 w-3.5 mr-1.5" />
                  Print Labels
                </Button>
                <Select value={queueStatus} onValueChange={setQueueStatus}>
                  <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="picked">Picked</SelectItem>
                    <SelectItem value="packed">Packed</SelectItem>
                    <SelectItem value="label_printed">Label printed</SelectItem>
                    <SelectItem value="scanned">Scanned</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">Order</TableHead>
                    <TableHead className="h-9 text-xs">Customer</TableHead>
                    <TableHead className="h-9 text-xs">Carrier</TableHead>
                    <TableHead className="h-9 text-xs">Tracking</TableHead>
                    <TableHead className="h-9 text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingQueue ? (
                    <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Loading queue...</TableCell></TableRow>
                  ) : fulfillmentQueue.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No fulfillment items in this view.</TableCell></TableRow>
                  ) : fulfillmentQueue.map((row) => (
                    <TableRow key={row.fulfillment_item_id}>
                      <TableCell>
                        <div className="font-mono text-xs font-semibold">{row.order_id}</div>
                        {row.system_id && <div className="text-[11px] text-muted-foreground">#{row.system_id}</div>}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{row.customer_name}</div>
                        <div className="text-[11px] text-muted-foreground">{row.customer_city}</div>
                      </TableCell>
                      <TableCell className="text-sm">{row.carrier_name}</TableCell>
                      <TableCell className="font-mono text-xs">{row.tracking_number || "-"}</TableCell>
                      <TableCell><Badge variant="secondary" className="text-[10px]">{row.fulfillment_item_status}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inventory">
          <Card className="border-border/60">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Inventory Balances</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">Product</TableHead>
                    <TableHead className="h-9 text-xs">SKU</TableHead>
                    <TableHead className="h-9 text-xs">Location</TableHead>
                    <TableHead className="h-9 text-xs text-right">On Hand</TableHead>
                    <TableHead className="h-9 text-xs text-right">Reserved</TableHead>
                    <TableHead className="h-9 text-xs">Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInventory ? (
                    <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Loading inventory...</TableCell></TableRow>
                  ) : inventory.length === 0 ? (
                    <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No inventory balances yet.</TableCell></TableRow>
                  ) : inventory.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="text-sm font-medium">{row.product_name}</div>
                        <div className="text-[11px] text-muted-foreground">{row.variant_name || "Default"}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.sku || "-"}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.location_code}</Badge> <span className="text-xs">{row.location_name}</span></TableCell>
                      <TableCell className="text-right font-semibold">{row.quantity_on_hand}</TableCell>
                      <TableCell className="text-right">{row.quantity_reserved}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(row.updated_at), "MMM d, HH:mm")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="scans">
          <Card className="border-border/60">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">Recent Scans</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">Time</TableHead>
                    <TableHead className="h-9 text-xs">Tracking</TableHead>
                    <TableHead className="h-9 text-xs">Type</TableHead>
                    <TableHead className="h-9 text-xs">Result</TableHead>
                    <TableHead className="h-9 text-xs">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentScans.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No scans yet.</TableCell></TableRow>
                  ) : recentScans.map((scan) => (
                    <TableRow key={scan.id}>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(scan.scanned_at), "MMM d, HH:mm:ss")}</TableCell>
                      <TableCell className="font-mono text-xs">{scan.tracking_number}</TableCell>
                      <TableCell className="text-xs">{scan.scan_type}</TableCell>
                      <TableCell><Badge variant={resultVariant(scan.result) as any} className="text-[10px]">{scan.result}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{scan.message || scan.shipments?.order_id || "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-lg font-bold tabular-nums">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}
