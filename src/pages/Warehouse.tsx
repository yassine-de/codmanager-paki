import { FormEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Barcode,
  Boxes,
  CheckCircle2,
  ClipboardList,
  History,
  MapPin,
  Package,
  PackageCheck,
  Printer,
  RotateCcw,
  ScanLine,
  Search,
  Settings2,
  Truck,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatPKT as format } from "@/lib/timezone";

type ReturnCondition = "sellable" | "damaged" | "missing_item";

interface SourcingReceiveRow {
  id: string;
  display_id: string | null;
  seller_id: string;
  product_name: string;
  quantity: number;
  status: string;
  source_product_id: string | null;
  variants: any[] | null;
  tracking_id: string | null;
  freight_forwarder: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

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
  product_name: string | null;
  item_count: number | null;
}

interface InventoryRow {
  id: string;
  product_variant_id: string;
  sku: string | null;
  variant_name: string | null;
  product_id: string;
  product_name: string;
  seller_id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
}

interface DispatchedInventoryOrder {
  delivery_status: string | null;
  fulfillment_status: string;
  order_items?: {
    product_variant_id: string | null;
    quantity: number;
  }[];
}

interface ScanEvent {
  id: string;
  tracking_number: string;
  scan_type: string;
  result: string;
  message: string | null;
  scanned_at: string;
  scanned_by: string | null;
}

interface ProfileRow {
  user_id: string;
  name: string;
  email: string;
}

interface ReceiveForm {
  sourcingId: string;
  expectedQuantity: number;
  receivedQuantity: number;
  goodQuantity: number;
  damagedQuantity: number;
  rack: string;
  shelf: string;
  bin: string;
  notes: string;
}

const sourcingReceiveStatuses = ["ordered", "shipped", "arrived", "ready_to_receive", "ready_to_receive_in_warehouse"];

function buildInternalSku(row: Pick<SourcingReceiveRow, "seller_id" | "product_name" | "id">) {
  const sellerCode = row.seller_id.slice(0, 6).toUpperCase();
  const productCode = row.product_name.replace(/[^a-z0-9]/gi, "").slice(0, 10).toUpperCase() || "PRODUCT";
  const batchCode = row.id.slice(0, 6).toUpperCase();
  return `WH-${sellerCode}-${productCode}-${batchCode}`;
}

function sellerName(map: Map<string, ProfileRow>, id: string | null | undefined) {
  if (!id) return "-";
  return map.get(id)?.name || id.slice(0, 8);
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (["received", "scanned", "dispatched", "ok", "sellable"].includes(normalized)) return "bg-success/12 text-success border-success/25";
  if (["pending", "label_printed", "ready", "shipped"].includes(normalized)) return "bg-primary/12 text-primary border-primary/25";
  if (["damaged", "missing_item", "unknown", "error"].includes(normalized)) return "bg-destructive/12 text-destructive border-destructive/25";
  if (["duplicate", "arrived"].includes(normalized)) return "bg-warning/12 text-warning border-warning/25";
  return "bg-muted text-muted-foreground border-border";
}

function buildLocationCode(rack: string, shelf: string, bin: string) {
  const r = rack.trim();
  const s = shelf.trim();
  const b = bin.trim();
  if (!r && !s && !b) return "UNASSIGNED";
  return `${r || "R0"}-${s || "S0"}-${b || "B0"}`.toUpperCase().replace(/\s+/g, "");
}

function dateTodayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

type WarehouseSection = "dashboard" | "receiving" | "inventory" | "dispatch" | "returns";
type DashboardRange = "today" | "yesterday" | "last_7" | "last_30" | "custom";

interface InventoryMovementRow {
  id: string;
  movement_type: string;
  quantity_change: number;
  created_at: string;
  metadata: any;
}

interface ReturnReceiptRow {
  id: string;
  condition: string;
  received_at: string;
}

function getDashboardRange(range: DashboardRange, customStart: string, customEnd: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (range === "today") {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "yesterday") {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (range === "last_7") {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (range === "last_30") {
    start.setDate(start.getDate() - 29);
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else {
    const fallbackStart = new Date(now);
    fallbackStart.setHours(0, 0, 0, 0);
    const parsedStart = customStart ? new Date(`${customStart}T00:00:00`) : fallbackStart;
    const parsedEnd = customEnd ? new Date(`${customEnd}T23:59:59`) : now;
    return { start: parsedStart.toISOString(), end: parsedEnd.toISOString() };
  }

  return { start: start.toISOString(), end: end.toISOString() };
}

export default function Warehouse({ section = "dashboard" }: { section?: WarehouseSection }) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const readyScanInput = useRef<HTMLInputElement>(null);
  const returnScanInput = useRef<HTMLInputElement>(null);

  const [dispatchTab, setDispatchTab] = useState("not_printed");
  const [busy, setBusy] = useState(false);
  const [dashboardRange, setDashboardRange] = useState<DashboardRange>("today");
  const [dashboardCustomStart, setDashboardCustomStart] = useState("");
  const [dashboardCustomEnd, setDashboardCustomEnd] = useState("");

  const [receivingSearch, setReceivingSearch] = useState("");
  const [receiveDialogRow, setReceiveDialogRow] = useState<SourcingReceiveRow | null>(null);
  const [receiveForm, setReceiveForm] = useState<ReceiveForm>({
    sourcingId: "",
    expectedQuantity: 0,
    receivedQuantity: 0,
    goodQuantity: 0,
    damagedQuantity: 0,
    rack: "",
    shelf: "",
    bin: "",
    notes: "",
  });

  const [inventorySearch, setInventorySearch] = useState("");
  const [inventorySellerFilter, setInventorySellerFilter] = useState("all");
  const [inventoryProductFilter, setInventoryProductFilter] = useState("all");
  const [inventoryLocationFilter, setInventoryLocationFilter] = useState("all");
  const [adjustDialogRow, setAdjustDialogRow] = useState<InventoryRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [printingLabels, setPrintingLabels] = useState(false);
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(new Set());
  const [labelCityFilter, setLabelCityFilter] = useState("all");
  const [labelProductFilter, setLabelProductFilter] = useState("all");
  const [labelCarrierFilter, setLabelCarrierFilter] = useState("all");
  const [notPrintedSearch, setNotPrintedSearch] = useState("");

  const [readySearch, setReadySearch] = useState("");
  const [readyScan, setReadyScan] = useState("");
  const [dispatchCandidate, setDispatchCandidate] = useState<FulfillmentRow | null>(null);

  const [returnScan, setReturnScan] = useState("");
  const [returnCondition, setReturnCondition] = useState<ReturnCondition>("sellable");
  const [returnDialogOrder, setReturnDialogOrder] = useState<FulfillmentRow | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [historySellerFilter, setHistorySellerFilter] = useState("all");
  const [historyCourierFilter, setHistoryCourierFilter] = useState("all");
  const [historyCityFilter, setHistoryCityFilter] = useState("all");
  const [historyUserFilter, setHistoryUserFilter] = useState("all");

  const isWarehouseUser = authUser?.role === "admin" || authUser?.role === "warehouse_agent" || authUser?.role === "warehouse_manager";
  const canAdjustStock = authUser?.role === "admin" || authUser?.role === "warehouse_manager";
  const canReprint = authUser?.role === "admin" || authUser?.role === "warehouse_manager";
  const hideSellerInfo = authUser?.role === "warehouse_manager";
  const dashboardDateRange = useMemo(
    () => getDashboardRange(dashboardRange, dashboardCustomStart, dashboardCustomEnd),
    [dashboardCustomEnd, dashboardCustomStart, dashboardRange],
  );

  const { data: profiles = [] } = useQuery({
    queryKey: ["warehouse-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name, email").order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as ProfileRow[];
    },
    enabled: isWarehouseUser,
  });

  const profileMap = useMemo(() => new Map(profiles.map((p) => [p.user_id, p])), [profiles]);

  const { data: receivingRows = [], isLoading: loadingReceiving } = useQuery({
    queryKey: ["warehouse-receiving"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("*")
        .in("status", sourcingReceiveStatuses)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as SourcingReceiveRow[];
    },
    enabled: isWarehouseUser,
  });

  const { data: inventory = [], isLoading: loadingInventory } = useQuery({
    queryKey: ["warehouse-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_balance_view" as any)
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as InventoryRow[];
    },
    enabled: isWarehouseUser,
  });

  const { data: dispatchedInventory = [] } = useQuery({
    queryKey: ["warehouse-dispatched-inventory"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders" as any)
        .select("delivery_status, fulfillment_status, order_items(product_variant_id, quantity)")
        .eq("fulfillment_status", "scanned")
        .limit(1000);
      if (error) throw error;
      return (data || []) as DispatchedInventoryOrder[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: notPrintedRows = [], isLoading: loadingNotPrinted } = useQuery({
    queryKey: ["warehouse-not-printed"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fulfillment_queue" as any, {
        p_limit: 200,
        p_status: "pending",
      });
      if (error) throw error;
      return (data || []) as FulfillmentRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: readyRows = [], isLoading: loadingReady } = useQuery({
    queryKey: ["warehouse-ready-dispatch"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fulfillment_queue" as any, {
        p_limit: 200,
        p_status: "label_printed",
      });
      if (error) throw error;
      return (data || []) as FulfillmentRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: dispatchedRows = [], isLoading: loadingDispatched } = useQuery({
    queryKey: ["warehouse-dispatched-today"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fulfillment_queue" as any, {
        p_limit: 250,
        p_status: "scanned",
      });
      if (error) throw error;
      const start = dateTodayStart();
      return ((data || []) as FulfillmentRow[]).filter((row) => row.updated_at >= start);
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: recentScans = [] } = useQuery({
    queryKey: ["warehouse-audit-scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_events" as any)
        .select("id, tracking_number, scan_type, result, message, scanned_at, scanned_by")
        .order("scanned_at", { ascending: false })
        .limit(35);
      if (error) throw error;
      return (data || []) as ScanEvent[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 12000,
  });

  const { data: dashboardScans = [] } = useQuery({
    queryKey: ["warehouse-dashboard-scans", dashboardDateRange.start, dashboardDateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_events" as any)
        .select("id, tracking_number, scan_type, result, message, scanned_at, scanned_by")
        .gte("scanned_at", dashboardDateRange.start)
        .lte("scanned_at", dashboardDateRange.end)
        .order("scanned_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as ScanEvent[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: dashboardMovements = [] } = useQuery({
    queryKey: ["warehouse-dashboard-movements", dashboardDateRange.start, dashboardDateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventory_movements" as any)
        .select("id, movement_type, quantity_change, created_at, metadata")
        .gte("created_at", dashboardDateRange.start)
        .lte("created_at", dashboardDateRange.end)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as InventoryMovementRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: dashboardReturns = [] } = useQuery({
    queryKey: ["warehouse-dashboard-returns", dashboardDateRange.start, dashboardDateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("return_receipts" as any)
        .select("id, condition, received_at")
        .gte("received_at", dashboardDateRange.start)
        .lte("received_at", dashboardDateRange.end)
        .order("received_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as ReturnReceiptRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: dashboardDispatched = [] } = useQuery({
    queryKey: ["warehouse-dashboard-dispatched", dashboardDateRange.start, dashboardDateRange.end],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_fulfillment_queue" as any, {
        p_limit: 1000,
        p_status: "scanned",
      });
      if (error) throw error;
      return ((data || []) as FulfillmentRow[]).filter((row) => row.updated_at >= dashboardDateRange.start && row.updated_at <= dashboardDateRange.end);
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const filteredReceiving = useMemo(() => {
    const q = receivingSearch.trim().toLowerCase();
    if (!q) return receivingRows;
    return receivingRows.filter((row) => {
      return [
        row.display_id || "",
        row.product_name,
        row.status,
        row.tracking_id || "",
        row.freight_forwarder || "",
        hideSellerInfo ? "" : sellerName(profileMap, row.seller_id),
      ].join(" ").toLowerCase().includes(q);
    });
  }, [hideSellerInfo, profileMap, receivingRows, receivingSearch]);

  const inventoryOptions = useMemo(() => {
    const sellerIds = Array.from(new Set(inventory.map((row) => row.seller_id).filter(Boolean)));
    const products = Array.from(new Set(inventory.map((row) => row.product_name).filter(Boolean))).sort();
    const locations = Array.from(new Set(inventory.map((row) => row.location_code).filter(Boolean))).sort();
    return { sellerIds, products, locations };
  }, [inventory]);

  const dispatchedByVariant = useMemo(() => {
    const deliveredOrClosed = new Set(["delivered", "return_received", "returned", "cancelled"]);
    const totals = new Map<string, number>();

    dispatchedInventory.forEach((order) => {
      const status = (order.delivery_status || "").toLowerCase();
      if (deliveredOrClosed.has(status)) return;

      (order.order_items || []).forEach((item) => {
        if (!item.product_variant_id) return;
        totals.set(item.product_variant_id, (totals.get(item.product_variant_id) || 0) + Number(item.quantity || 0));
      });
    });

    return totals;
  }, [dispatchedInventory]);

  const filteredInventory = useMemo(() => {
    const q = inventorySearch.trim().toLowerCase();
    return inventory.filter((row) => {
      if (inventorySellerFilter !== "all" && row.seller_id !== inventorySellerFilter) return false;
      if (inventoryProductFilter !== "all" && row.product_name !== inventoryProductFilter) return false;
      if (inventoryLocationFilter !== "all" && row.location_code !== inventoryLocationFilter) return false;
      if (!q) return true;
      return [
        hideSellerInfo ? "" : sellerName(profileMap, row.seller_id),
        row.product_name,
        row.variant_name || "",
        row.sku || "",
        row.location_code,
      ].join(" ").toLowerCase().includes(q);
    });
  }, [hideSellerInfo, inventory, inventoryLocationFilter, inventoryProductFilter, inventorySearch, inventorySellerFilter, profileMap]);

  const filteredNotPrinted = useMemo(() => {
    const q = notPrintedSearch.trim().toLowerCase();
    if (!q) return notPrintedRows;
    return notPrintedRows.filter((row) => [
      row.order_id,
      row.customer_name,
      row.customer_city,
      row.product_name || "",
      row.carrier_name,
      row.tracking_number || "",
    ].join(" ").toLowerCase().includes(q));
  }, [notPrintedRows, notPrintedSearch]);

  const filteredReady = useMemo(() => {
    const q = readySearch.trim().toLowerCase();
    if (!q) return readyRows;
    return readyRows.filter((row) => [
      row.order_id,
      row.customer_name,
      row.customer_city,
      row.product_name || "",
      row.carrier_name,
      row.tracking_number || "",
    ].join(" ").toLowerCase().includes(q));
  }, [readyRows, readySearch]);

  const filteredHistory = useMemo(() => {
    return dispatchedRows.filter((row) => {
      if (historyCourierFilter !== "all" && row.carrier_name !== historyCourierFilter) return false;
      if (historyCityFilter !== "all" && row.customer_city !== historyCityFilter) return false;
      if (historySellerFilter !== "all") return true;
      if (historyUserFilter !== "all") return true;
      return true;
    });
  }, [dispatchedRows, historyCityFilter, historyCourierFilter, historySellerFilter, historyUserFilter]);

  const stats = useMemo(() => {
    const onHand = inventory.reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0);
    const damaged = inventory.filter((row) => row.location_type === "damaged").reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0);
    return {
      receiving: receivingRows.length,
      notPrinted: notPrintedRows.length,
      ready: readyRows.length,
      dispatchedToday: dispatchedRows.length,
      onHand,
      damaged,
    };
  }, [dispatchedRows.length, inventory, notPrintedRows.length, readyRows.length, receivingRows.length]);

  const dashboardStats = useMemo(() => {
    const receivedMovements = dashboardMovements.filter((row) => row.movement_type === "restock");
    const damagedMovements = dashboardMovements.filter((row) => row.movement_type === "damage");
    const receivedSourceIds = new Set(
      [...receivedMovements, ...damagedMovements]
        .map((row) => row.metadata?.sourcing_request_id)
        .filter(Boolean),
    );
    const missingQty = [...receivedMovements, ...damagedMovements].reduce((sum, row) => {
      const value = Number(row.metadata?.missing_quantity || 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    const outboundScans = dashboardScans.filter((row) => row.scan_type === "outbound");
    const successfulOutbound = outboundScans.filter((row) => row.result === "ok").length;
    const dispatchSuccessRate = outboundScans.length > 0 ? Math.round((successfulOutbound / outboundScans.length) * 100) : 0;
    const avgDispatchTimeHours = dashboardDispatched.length > 0
      ? Math.round(
          (dashboardDispatched.reduce((sum, row) => {
            const start = new Date(row.created_at).getTime();
            const end = new Date(row.updated_at).getTime();
            return sum + Math.max(0, end - start);
          }, 0) / dashboardDispatched.length / 36e5) * 10,
        ) / 10
      : 0;

    return {
      pendingReceiving: receivingRows.length,
      received: receivedSourceIds.size,
      goodQtyReceived: receivedMovements.reduce((sum, row) => sum + Math.max(0, Number(row.quantity_change || 0)), 0),
      damagedQtyReceived: damagedMovements.reduce((sum, row) => sum + Math.max(0, Number(row.quantity_change || 0)), 0),
      missingQty,
      totalAvailableStock: inventory.filter((row) => row.location_type !== "damaged").reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0),
      totalDamagedStock: inventory.filter((row) => row.location_type === "damaged").reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0),
      lowStockItems: inventory.filter((row) => row.location_type !== "damaged" && Number(row.quantity_on_hand || 0) > 0 && Number(row.quantity_on_hand || 0) <= 5).length,
      unassignedLocationItems: inventory.filter((row) => row.location_code === "UNASSIGNED").length,
      notPrintedOrders: notPrintedRows.length,
      readyToDispatchOrders: readyRows.length,
      dispatchedOrders: dashboardDispatched.length,
      dispatchSuccessRate,
      avgDispatchTimeHours,
      returnsReceived: dashboardReturns.length,
      sellableReturns: dashboardReturns.filter((row) => row.condition === "sellable").length,
      damagedReturns: dashboardReturns.filter((row) => row.condition === "damaged").length,
      missingReturns: dashboardReturns.filter((row) => row.condition === "missing_item").length,
      duplicateScanAttempts: dashboardScans.filter((row) => row.result === "duplicate").length,
      unknownScanAttempts: dashboardScans.filter((row) => row.result === "unknown").length,
      manualStockAdjustments: dashboardMovements.filter((row) => row.movement_type === "adjustment").length,
    };
  }, [dashboardDispatched, dashboardMovements, dashboardReturns, dashboardScans, inventory, notPrintedRows.length, readyRows.length, receivingRows.length]);

  const refreshWarehouse = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouse-receiving"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-inventory"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dispatched-inventory"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-not-printed"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-ready-dispatch"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dispatched-today"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-audit-scans"] });
  };

  const openReceiveDialog = (row: SourcingReceiveRow) => {
    setReceiveDialogRow(row);
    setReceiveForm({
      sourcingId: row.id,
      expectedQuantity: row.quantity || 0,
      receivedQuantity: row.quantity || 0,
      goodQuantity: row.quantity || 0,
      damagedQuantity: 0,
      rack: "",
      shelf: "",
      bin: "",
      notes: "",
    });
  };

  const receiveMissing = Math.max(0, Number(receiveForm.expectedQuantity || 0) - Number(receiveForm.receivedQuantity || 0));

  async function ensureLocation(code: string, type: "sellable" | "damaged") {
    const { data: existing, error: selectError } = await supabase
      .from("inventory_locations" as any)
      .select("id")
      .eq("code", code)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing?.id) return existing.id as string;

    const { data, error } = await supabase
      .from("inventory_locations" as any)
      .insert({ code, name: code === "UNASSIGNED" ? "Unassigned" : code, type })
      .select("id")
      .single();
    if (error) throw error;
    return data.id as string;
  }

  async function ensureProductVariant(row: SourcingReceiveRow) {
    let productId = row.source_product_id;
    if (!productId) {
      const { data: existingProduct } = await supabase
        .from("products" as any)
        .select("id")
        .eq("sourcing_request_id", row.id)
        .maybeSingle();
      productId = existingProduct?.id || null;
    }

    const baseSku = buildInternalSku(row);

    if (!productId) {
      const { data: product, error } = await supabase
        .from("products" as any)
        .insert({
          seller_id: row.seller_id,
          sku: baseSku,
          name: row.product_name,
          quantity: 0,
          sourcing_request_id: row.id,
          active: true,
        })
        .select("id")
        .single();
      if (error) throw error;
      productId = product.id as string;
    }

    const { data: variant } = await supabase
      .from("product_variants" as any)
      .select("id, sku")
      .eq("product_id", productId)
      .limit(1)
      .maybeSingle();
    if (variant?.id) return { productId, variantId: variant.id as string, sku: variant.sku as string };

    const { data: createdVariant, error: variantError } = await supabase
      .from("product_variants" as any)
      .insert({
        product_id: productId,
        sku: `${baseSku}-B1`,
        name: "Default",
        attributes: { batch: row.id.slice(0, 8), source: "warehouse_receiving" },
      })
      .select("id, sku")
      .single();
    if (variantError) throw variantError;
    return { productId, variantId: createdVariant.id as string, sku: createdVariant.sku as string };
  }

  const saveReceive = async () => {
    if (!receiveDialogRow) return;
    const received = Number(receiveForm.receivedQuantity || 0);
    const good = Number(receiveForm.goodQuantity || 0);
    const damaged = Number(receiveForm.damagedQuantity || 0);
    if (received < 0 || good < 0 || damaged < 0) {
      toast.error("Quantities cannot be negative");
      return;
    }
    if (good + damaged > received) {
      toast.error("Good + damaged cannot exceed received quantity");
      return;
    }

    setBusy(true);
    try {
      const { variantId } = await ensureProductVariant(receiveDialogRow);
      const sellableLocationId = await ensureLocation(buildLocationCode(receiveForm.rack, receiveForm.shelf, receiveForm.bin), "sellable");
      const damagedLocationId = damaged > 0 ? await ensureLocation("DAMAGED", "damaged") : null;

      if (good > 0) {
        const { error: balanceError } = await supabase
          .from("inventory_balances" as any)
          .upsert({ product_variant_id: variantId, location_id: sellableLocationId, quantity_on_hand: good }, { onConflict: "product_variant_id,location_id" });
        if (balanceError) throw balanceError;
        const { error: movementError } = await supabase.from("inventory_movements" as any).insert({
          product_variant_id: variantId,
          movement_type: "restock",
          quantity_change: good,
          to_location_id: sellableLocationId,
          created_by: authUser?.id,
          metadata: {
            reason: "Warehouse receiving",
            sourcing_request_id: receiveDialogRow.id,
            expected_quantity: receiveForm.expectedQuantity,
            received_quantity: received,
            missing_quantity: receiveMissing,
            notes: receiveForm.notes || null,
          },
        });
        if (movementError) throw movementError;
      }

      if (damaged > 0 && damagedLocationId) {
        const { error: balanceError } = await supabase
          .from("inventory_balances" as any)
          .upsert({ product_variant_id: variantId, location_id: damagedLocationId, quantity_on_hand: damaged }, { onConflict: "product_variant_id,location_id" });
        if (balanceError) throw balanceError;
        const { error: movementError } = await supabase.from("inventory_movements" as any).insert({
          product_variant_id: variantId,
          movement_type: "damage",
          quantity_change: damaged,
          to_location_id: damagedLocationId,
          created_by: authUser?.id,
          metadata: {
            reason: "Warehouse receiving damaged",
            sourcing_request_id: receiveDialogRow.id,
            notes: receiveForm.notes || null,
          },
        });
        if (movementError) throw movementError;
      }

      const { error: sourcingError } = await supabase
        .from("sourcing_requests")
        .update({ status: "received", notes: receiveForm.notes || receiveDialogRow.notes, updated_at: new Date().toISOString() })
        .eq("id", receiveDialogRow.id);
      if (sourcingError) throw sourcingError;

      await supabase.from("sourcing_history").insert({
        sourcing_request_id: receiveDialogRow.id,
        changed_by: authUser?.id,
        field_changed: "status",
        old_value: receiveDialogRow.status,
        new_value: "received",
        action_type: "warehouse_receiving",
      } as any);

      toast.success("Products received into warehouse inventory");
      setReceiveDialogRow(null);
      refreshWarehouse();
    } catch (error: any) {
      toast.error(error.message || "Receiving failed");
    } finally {
      setBusy(false);
    }
  };

  const saveAdjustment = async () => {
    if (!adjustDialogRow) return;
    const delta = Number(adjustQuantity);
    if (!Number.isFinite(delta) || delta === 0) {
      toast.error("Enter a positive or negative adjustment quantity");
      return;
    }
    if (!adjustReason.trim()) {
      toast.error("Add a reason for the adjustment");
      return;
    }
    setBusy(true);
    try {
      const nextQty = Number(adjustDialogRow.quantity_on_hand || 0) + delta;
      if (nextQty < 0) {
        toast.error("Adjustment would make stock negative");
        return;
      }
      const { error: balanceError } = await supabase
        .from("inventory_balances" as any)
        .update({ quantity_on_hand: nextQty, updated_at: new Date().toISOString() })
        .eq("id", adjustDialogRow.id);
      if (balanceError) throw balanceError;

      const { error: movementError } = await supabase.from("inventory_movements" as any).insert({
        product_variant_id: adjustDialogRow.product_variant_id,
        movement_type: "adjustment",
        quantity_change: delta,
        to_location_id: delta > 0 ? adjustDialogRow.location_id : null,
        from_location_id: delta < 0 ? adjustDialogRow.location_id : null,
        created_by: authUser?.id,
        metadata: { reason: adjustReason.trim(), source: "manual_stock_adjustment" },
      });
      if (movementError) throw movementError;

      toast.success("Stock adjusted");
      setAdjustDialogRow(null);
      setAdjustQuantity("");
      setAdjustReason("");
      refreshWarehouse();
    } catch (error: any) {
      toast.error(error.message || "Adjustment failed");
    } finally {
      setBusy(false);
    }
  };

  const selectableLabelRows = useMemo(() => filteredNotPrinted.filter((row) => row.tracking_number), [filteredNotPrinted]);
  const selectedLabelRows = useMemo(() => notPrintedRows.filter((row) => selectedLabelIds.has(row.fulfillment_item_id) && row.tracking_number), [notPrintedRows, selectedLabelIds]);
  const baseLabelRows = selectedLabelRows.length > 0 ? selectedLabelRows : selectableLabelRows;
  const allDisplayedSelected = selectableLabelRows.length > 0 && selectableLabelRows.every((row) => selectedLabelIds.has(row.fulfillment_item_id));

  const toggleLabelRow = (rowId: string) => {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const toggleDisplayedLabels = () => {
    setSelectedLabelIds((prev) => {
      const next = new Set(prev);
      if (allDisplayedSelected) selectableLabelRows.forEach((row) => next.delete(row.fulfillment_item_id));
      else selectableLabelRows.forEach((row) => next.add(row.fulfillment_item_id));
      return next;
    });
  };

  const openPrintDialog = () => {
    if (baseLabelRows.length === 0) {
      toast.info("No pending labels to print");
      return;
    }
    setLabelCityFilter("all");
    setLabelProductFilter("all");
    setLabelCarrierFilter("all");
    setLabelDialogOpen(true);
  };

  const labelFilterOptions = useMemo(() => {
    const sort = (a: string, b: string) => a.localeCompare(b);
    return {
      cities: Array.from(new Set(baseLabelRows.map((row) => row.customer_city).filter(Boolean))).sort(sort),
      products: Array.from(new Set(baseLabelRows.map((row) => row.product_name).filter(Boolean) as string[])).sort(sort),
      carriers: Array.from(new Set(baseLabelRows.map((row) => row.carrier_name).filter(Boolean))).sort(sort),
    };
  }, [baseLabelRows]);

  const filteredLabelRows = useMemo(() => {
    return baseLabelRows.filter((row) => {
      if (labelCityFilter !== "all" && row.customer_city !== labelCityFilter) return false;
      if (labelProductFilter !== "all" && row.product_name !== labelProductFilter) return false;
      if (labelCarrierFilter !== "all" && row.carrier_name !== labelCarrierFilter) return false;
      return true;
    });
  }, [baseLabelRows, labelCarrierFilter, labelCityFilter, labelProductFilter]);

  const labelSummary = useMemo(() => {
    const total = filteredLabelRows.length;
    const batches = Math.ceil(total / 10);
    const carriers = new Set(filteredLabelRows.map((row) => row.carrier_name).filter(Boolean));
    const cities = new Set(filteredLabelRows.map((row) => row.customer_city).filter(Boolean));
    const codTotal = filteredLabelRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
    return { total, batches, carriers: carriers.size, cities: cities.size, codTotal };
  }, [filteredLabelRows]);

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

  const printLabels = async (rows = filteredLabelRows) => {
    const alreadyPrinted = rows.filter((row) => row.fulfillment_item_status !== "pending");
    if (alreadyPrinted.length > 0 && !canReprint) {
      toast.warning("Already printed");
      return;
    }

    const trackingNumbers = rows.map((row) => row.tracking_number).filter(Boolean) as string[];
    if (trackingNumbers.length === 0) {
      toast.info("No pending labels to print");
      return;
    }
    setPrintingLabels(true);
    try {
      const chunks: string[][] = [];
      for (let i = 0; i < trackingNumbers.length; i += 10) chunks.push(trackingNumbers.slice(i, i + 10));

      for (let i = 0; i < chunks.length; i += 1) {
        const { data, error } = await supabase.functions.invoke("shipping-sync", {
          body: { action: "generate-labels", tracking_numbers: chunks[i] },
        });
        if (error) throw error;
        if (!data?.pdf_base64) throw new Error("PostEx did not return a label PDF");
        openPdf(data.pdf_base64, `postex-labels-${i + 1}.pdf`);
      }

      const printedAt = new Date().toISOString();
      const pendingIds = rows.filter((row) => row.fulfillment_item_status === "pending").map((row) => row.fulfillment_item_id);
      if (pendingIds.length > 0) {
        const { error } = await supabase
          .from("fulfillment_items" as any)
          .update({ status: "label_printed", label_printed_at: printedAt, packed_at: printedAt, packed_by: authUser?.id, updated_at: printedAt })
          .in("id", pendingIds);
        if (error) throw error;
      }

      await Promise.all(trackingNumbers.map((tracking) => supabase.from("scan_events" as any).insert({
        tracking_number: tracking,
        scan_type: "audit",
        result: "ok",
        message: alreadyPrinted.length > 0 ? "Warehouse label reprint" : "Warehouse label printed",
        scanned_by: authUser?.id,
        metadata: { action: alreadyPrinted.length > 0 ? "reprint" : "print_labels" },
      })));

      toast.success(`Opened ${trackingNumbers.length} labels for printing`);
      setLabelDialogOpen(false);
      setSelectedLabelIds(new Set());
      refreshWarehouse();
    } catch (error: any) {
      toast.error(error.message || "Label printing failed");
    } finally {
      setPrintingLabels(false);
    }
  };

  const submitReadyScan = (event: FormEvent) => {
    event.preventDefault();
    const code = readyScan.trim();
    if (!code) return;
    const printed = readyRows.find((row) => row.tracking_number === code || row.order_id === code || String(row.system_id || "") === code);
    const notPrinted = notPrintedRows.find((row) => row.tracking_number === code || row.order_id === code || String(row.system_id || "") === code);
    const dispatched = dispatchedRows.find((row) => row.tracking_number === code || row.order_id === code || String(row.system_id || "") === code);
    if (dispatched) {
      toast.error("Already dispatched");
      return;
    }
    if (notPrinted) {
      toast.error("Label not printed yet");
      return;
    }
    if (!printed) {
      toast.error("Order not found");
      return;
    }
    setDispatchCandidate(printed);
  };

  const dispatchOrder = async () => {
    if (!dispatchCandidate?.tracking_number) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("scan_outbound_shipment" as any, {
        p_tracking_number: dispatchCandidate.tracking_number,
        p_scanned_by: authUser?.id,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.result === "duplicate") toast.error("Already dispatched");
      else if (result?.result === "unknown") toast.error("Order not found");
      else toast.success("Order dispatched and stock deducted");
      setReadyScan("");
      setDispatchCandidate(null);
      refreshWarehouse();
      setTimeout(() => readyScanInput.current?.focus(), 50);
    } catch (error: any) {
      toast.error(error.message || "Dispatch failed");
    } finally {
      setBusy(false);
    }
  };

  const submitReturnScan = (event: FormEvent) => {
    event.preventDefault();
    const code = returnScan.trim();
    if (!code) return;
    const order = [...readyRows, ...dispatchedRows, ...notPrintedRows].find((row) => row.tracking_number === code || row.order_id === code || String(row.system_id || "") === code);
    if (!order) {
      toast.error("Order not found");
      return;
    }
    setReturnDialogOrder(order);
  };

  const receiveReturn = async () => {
    if (!returnDialogOrder?.tracking_number) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("scan_return_shipment" as any, {
        p_tracking_number: returnDialogOrder.tracking_number,
        p_condition: returnCondition,
        p_scanned_by: authUser?.id,
        p_note: returnNote.trim() || null,
      });
      if (error) throw error;
      const result = data as any;
      if (result?.result === "duplicate") toast.error("Return already received");
      else if (result?.result === "unknown") toast.error("Order not found");
      else toast.success("Return received in warehouse");
      setReturnScan("");
      setReturnNote("");
      setReturnDialogOrder(null);
      refreshWarehouse();
      setTimeout(() => returnScanInput.current?.focus(), 50);
    } catch (error: any) {
      toast.error(error.message || "Return failed");
    } finally {
      setBusy(false);
    }
  };

  const printBarcode = (row: InventoryRow) => {
    const popup = window.open("", "_blank", "noopener,noreferrer,width=420,height=360");
    if (!popup) {
      toast.error("Popup blocked");
      return;
    }
    popup.document.write(`
      <html>
        <head><title>${row.sku || row.product_name}</title></head>
        <body style="font-family: system-ui; padding: 24px;">
          <div style="border:1px solid #111; padding:16px; width:320px;">
            ${hideSellerInfo ? "" : `<div style="font-size:12px; color:#555;">${sellerName(profileMap, row.seller_id)}</div>`}
            <h3 style="margin:4px 0 8px;font-size:16px;">${row.product_name}</h3>
            <div style="font-family:monospace;font-size:18px;letter-spacing:2px;padding:14px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd;">${row.sku || row.product_variant_id}</div>
            <div style="margin-top:8px;font-size:12px;">Location: ${row.location_code}</div>
          </div>
          <script>window.print()</script>
        </body>
      </html>
    `);
    popup.document.close();
  };

  if (!isWarehouseUser) {
    return <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">You do not have access to the warehouse module.</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <WarehouseIcon className="h-5 w-5 text-primary" />
            Warehouse Management
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {hideSellerInfo ? "Receiving, inventory, labels, dispatch and returns." : "Receiving, seller inventory, labels, dispatch and returns."}
          </p>
        </div>
        <Badge variant="outline" className="h-8 px-3 text-xs">{authUser?.role}</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Receiving" value={stats.receiving} />
        <Kpi icon={<Printer className="h-4 w-4" />} label="Not Printed" value={stats.notPrinted} />
        <Kpi icon={<Truck className="h-4 w-4" />} label="Ready" value={stats.ready} />
        <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Dispatched" value={stats.dispatchedToday} />
        <Kpi icon={<Boxes className="h-4 w-4" />} label="On Hand" value={stats.onHand} />
        <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Damaged" value={stats.damaged} />
      </div>

      <div className="space-y-4">
        {section === "dashboard" && (
          <div className="space-y-4">
            <Card className="border-border/60">
              <CardHeader className="py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <WarehouseIcon className="h-4 w-4" />
                    Warehouse Dashboard
                  </CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Select value={dashboardRange} onValueChange={(value: DashboardRange) => setDashboardRange(value)}>
                      <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="yesterday">Yesterday</SelectItem>
                        <SelectItem value="last_7">Last 7 Days</SelectItem>
                        <SelectItem value="last_30">Last 30 Days</SelectItem>
                        <SelectItem value="custom">Custom</SelectItem>
                      </SelectContent>
                    </Select>
                    {dashboardRange === "custom" && (
                      <>
                        <Input className="h-9 w-[150px] text-xs" type="date" value={dashboardCustomStart} onChange={(e) => setDashboardCustomStart(e.target.value)} />
                        <Input className="h-9 w-[150px] text-xs" type="date" value={dashboardCustomEnd} onChange={(e) => setDashboardCustomEnd(e.target.value)} />
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
            </Card>

            <DashboardSection title="Receiving" icon={<PackageCheck className="h-4 w-4" />}>
              <Kpi icon={<ClipboardList className="h-4 w-4" />} label="Pending Receiving" value={dashboardStats.pendingReceiving} />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Received" value={dashboardStats.received} />
              <Kpi icon={<Boxes className="h-4 w-4" />} label="Good Qty Received" value={dashboardStats.goodQtyReceived} />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Damaged Qty Received" value={dashboardStats.damagedQtyReceived} />
              <Kpi icon={<Package className="h-4 w-4" />} label="Missing Qty" value={dashboardStats.missingQty} />
            </DashboardSection>

            <DashboardSection title="Inventory" icon={<Boxes className="h-4 w-4" />}>
              <Kpi icon={<Boxes className="h-4 w-4" />} label="Total Available Stock" value={dashboardStats.totalAvailableStock} />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Total Damaged Stock" value={dashboardStats.totalDamagedStock} />
              <Kpi icon={<Package className="h-4 w-4" />} label="Low Stock Items" value={dashboardStats.lowStockItems} />
              <Kpi icon={<MapPin className="h-4 w-4" />} label="Unassigned Location Items" value={dashboardStats.unassignedLocationItems} />
            </DashboardSection>

            <DashboardSection title="Dispatch" icon={<Truck className="h-4 w-4" />}>
              <Kpi icon={<Printer className="h-4 w-4" />} label="Not Printed Orders" value={dashboardStats.notPrintedOrders} />
              <Kpi icon={<Truck className="h-4 w-4" />} label="Ready to Dispatch Orders" value={dashboardStats.readyToDispatchOrders} />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Dispatched Orders" value={dashboardStats.dispatchedOrders} />
              <Kpi icon={<ScanLine className="h-4 w-4" />} label="Dispatch Scan Success Rate" value={dashboardStats.dispatchSuccessRate} suffix="%" />
              <Kpi icon={<History className="h-4 w-4" />} label="Average Dispatch Time" value={dashboardStats.avgDispatchTimeHours} suffix="h" />
            </DashboardSection>

            <DashboardSection title="Returns" icon={<RotateCcw className="h-4 w-4" />}>
              <Kpi icon={<RotateCcw className="h-4 w-4" />} label="Returns Received" value={dashboardStats.returnsReceived} />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Sellable Returns" value={dashboardStats.sellableReturns} />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Damaged Returns" value={dashboardStats.damagedReturns} />
              <Kpi icon={<Package className="h-4 w-4" />} label="Missing Returns" value={dashboardStats.missingReturns} />
            </DashboardSection>

            <DashboardSection title="Errors / Control" icon={<Settings2 className="h-4 w-4" />}>
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Duplicate Scan Attempts" value={dashboardStats.duplicateScanAttempts} />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Unknown Scan Attempts" value={dashboardStats.unknownScanAttempts} />
              <Kpi icon={<Settings2 className="h-4 w-4" />} label="Manual Stock Adjustments" value={dashboardStats.manualStockAdjustments} />
            </DashboardSection>
          </div>
        )}

        {section === "receiving" && (
          <Card className="border-border/60">
            <CardHeader className="py-4 flex-row items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2"><PackageCheck className="h-4 w-4" /> Receiving</CardTitle>
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
	                <Input className="h-9 pl-8 text-sm" value={receivingSearch} onChange={(e) => setReceivingSearch(e.target.value)} placeholder={hideSellerInfo ? "Search product or tracking..." : "Search seller, product, tracking..."} />
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
	                  <TableRow>
	                    <TableHead className="h-9 text-xs">Sourcing</TableHead>
	                    {!hideSellerInfo && <TableHead className="h-9 text-xs">Seller</TableHead>}
	                    <TableHead className="h-9 text-xs">Product</TableHead>
	                    <TableHead className="h-9 text-xs text-right">Expected</TableHead>
	                    <TableHead className="h-9 text-xs">China Shipment</TableHead>
	                    <TableHead className="h-9 text-xs">Generated Barcode</TableHead>
	                    <TableHead className="h-9 text-xs">Status</TableHead>
	                    <TableHead className="h-9 text-xs text-right">Warehouse Status</TableHead>
	                  </TableRow>
	                </TableHeader>
	                <TableBody>
	                  {loadingReceiving ? (
	                    <TableRow><TableCell colSpan={hideSellerInfo ? 7 : 8} className="text-sm text-muted-foreground">Loading receiving queue...</TableCell></TableRow>
	                  ) : filteredReceiving.length === 0 ? (
	                    <TableRow><TableCell colSpan={hideSellerInfo ? 7 : 8} className="text-sm text-muted-foreground">No shipped or arrived sourcing items to receive.</TableCell></TableRow>
	                  ) : filteredReceiving.map((row) => (
	                    <TableRow key={row.id}>
	                      <TableCell className="font-mono text-xs">{row.display_id || row.id.slice(0, 8)}</TableCell>
	                      {!hideSellerInfo && <TableCell className="text-sm">{sellerName(profileMap, row.seller_id)}</TableCell>}
	                      <TableCell>
                        <div className="text-sm font-medium">{row.product_name}</div>
	                        <div className="text-[11px] text-muted-foreground">{row.tracking_id || "No tracking"}</div>
	                      </TableCell>
	                      <TableCell className="text-right font-semibold">{row.quantity}</TableCell>
	                      <TableCell>
	                        <div className="text-xs font-medium">{row.freight_forwarder || "China shipment"}</div>
	                        <div className="text-[11px] text-muted-foreground">{row.tracking_id || "Waiting tracking"}</div>
	                      </TableCell>
	                      <TableCell>
	                        <div className="font-mono text-xs font-semibold">{buildInternalSku(row)}-B1</div>
	                        <div className="text-[11px] text-muted-foreground">Auto after receiving</div>
	                      </TableCell>
	                      <TableCell><StatusBadge value={row.status} /></TableCell>
	                      <TableCell className="text-right">
	                        <Select
	                          value="waiting"
	                          onValueChange={(value) => {
	                            if (value === "received") openReceiveDialog(row);
	                          }}
	                        >
	                          <SelectTrigger className="ml-auto h-8 w-[150px] text-xs">
	                            <SelectValue placeholder="Update status" />
	                          </SelectTrigger>
	                          <SelectContent>
	                            <SelectItem value="waiting">Waiting receive</SelectItem>
	                            <SelectItem value="received">Received</SelectItem>
	                          </SelectContent>
	                        </Select>
	                      </TableCell>
	                    </TableRow>
	                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {section === "inventory" && (
          <Card className="border-border/60">
            <CardHeader className="py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Boxes className="h-4 w-4" /> {hideSellerInfo ? "Inventory" : "Seller Inventory"}</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Input className="h-9 w-[220px] text-sm" value={inventorySearch} onChange={(e) => setInventorySearch(e.target.value)} placeholder="Search SKU or product..." />
                  {!hideSellerInfo && (
                    <Select value={inventorySellerFilter} onValueChange={setInventorySellerFilter}>
                      <SelectTrigger className="h-9 w-[170px] text-xs"><SelectValue placeholder="Seller" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All sellers</SelectItem>
                        {inventoryOptions.sellerIds.map((sellerId) => <SelectItem key={sellerId} value={sellerId}>{sellerName(profileMap, sellerId)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                  <Select value={inventoryProductFilter} onValueChange={setInventoryProductFilter}>
                    <SelectTrigger className="h-9 w-[180px] text-xs"><SelectValue placeholder="Product" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All products</SelectItem>
                      {inventoryOptions.products.map((product) => <SelectItem key={product} value={product}>{product}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Select value={inventoryLocationFilter} onValueChange={setInventoryLocationFilter}>
                    <SelectTrigger className="h-9 w-[160px] text-xs"><SelectValue placeholder="Location" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All locations</SelectItem>
                      {inventoryOptions.locations.map((location) => <SelectItem key={location} value={location}>{location}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {!hideSellerInfo && <TableHead className="h-9 text-xs">Seller</TableHead>}
                    <TableHead className="h-9 text-xs">Product</TableHead>
                    <TableHead className="h-9 text-xs">Variant</TableHead>
                    <TableHead className="h-9 text-xs">Internal SKU</TableHead>
                    <TableHead className="h-9 text-xs">Barcode</TableHead>
                    <TableHead className="h-9 text-xs text-right">Available</TableHead>
                    <TableHead className="h-9 text-xs text-right">Reserved</TableHead>
                    <TableHead className="h-9 text-xs text-right">Dispatched</TableHead>
                    <TableHead className="h-9 text-xs text-right">Damaged</TableHead>
                    <TableHead className="h-9 text-xs">Location</TableHead>
                    <TableHead className="h-9 text-xs">Last Move</TableHead>
                    <TableHead className="h-9 text-xs text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingInventory ? (
                    <TableRow><TableCell colSpan={hideSellerInfo ? 11 : 12} className="text-sm text-muted-foreground">Loading inventory...</TableCell></TableRow>
                  ) : filteredInventory.length === 0 ? (
                    <TableRow><TableCell colSpan={hideSellerInfo ? 11 : 12} className="text-sm text-muted-foreground">No inventory balances found.</TableCell></TableRow>
                  ) : filteredInventory.map((row) => (
                    <TableRow key={row.id}>
                      {!hideSellerInfo && <TableCell className="text-sm">{sellerName(profileMap, row.seller_id)}</TableCell>}
                      <TableCell className="text-sm font-medium">{row.product_name}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.variant_name || "Default"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.sku || "-"}</TableCell>
                      <TableCell className="font-mono text-xs">{row.sku || row.product_variant_id.slice(0, 10)}</TableCell>
                      <TableCell className="text-right font-semibold">{row.location_type === "damaged" ? 0 : row.quantity_on_hand}</TableCell>
                      <TableCell className="text-right">{row.quantity_reserved}</TableCell>
                      <TableCell className="text-right">
                        <span className={`font-semibold tabular-nums ${dispatchedByVariant.get(row.product_variant_id) ? "text-primary" : "text-muted-foreground"}`}>
                          {dispatchedByVariant.get(row.product_variant_id) || 0}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{row.location_type === "damaged" ? row.quantity_on_hand : 0}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{row.location_code || "UNASSIGNED"}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{format(new Date(row.updated_at), "MMM d, HH:mm")}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => printBarcode(row)}><Barcode className="h-3.5 w-3.5" /></Button>
                          {canAdjustStock && <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setAdjustDialogRow(row)}><Settings2 className="h-3.5 w-3.5" /></Button>}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {section === "dispatch" && (
          <Tabs value={dispatchTab} onValueChange={setDispatchTab} className="space-y-3">
            <TabsList className="h-auto gap-2 rounded-lg border bg-card p-1.5 shadow-sm">
              <TabsTrigger
                value="not_printed"
                className="h-10 gap-2 rounded-md border border-transparent px-4 text-sm font-semibold text-muted-foreground data-[state=active]:border-[hsl(38,92%,50%)]/30 data-[state=active]:bg-[hsl(38,92%,50%)]/15 data-[state=active]:text-[hsl(32,90%,38%)] data-[state=active]:shadow-none"
              >
                <Printer className="h-4 w-4" />
                Not Printed
              </TabsTrigger>
              <TabsTrigger
                value="ready"
                className="h-10 gap-2 rounded-md border border-transparent px-4 text-sm font-semibold text-muted-foreground data-[state=active]:border-primary/30 data-[state=active]:bg-primary/12 data-[state=active]:text-primary data-[state=active]:shadow-none"
              >
                <Truck className="h-4 w-4" />
                Ready to Dispatch
              </TabsTrigger>
              <TabsTrigger
                value="history"
                className="h-10 gap-2 rounded-md border border-transparent px-4 text-sm font-semibold text-muted-foreground data-[state=active]:border-success/30 data-[state=active]:bg-success/12 data-[state=active]:text-success data-[state=active]:shadow-none"
              >
                <CheckCircle2 className="h-4 w-4" />
                Dispatched Today
              </TabsTrigger>
            </TabsList>

            <TabsContent value="not_printed">
              <Card className="border-border/60">
                <CardHeader className="py-4 flex-row items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2"><Printer className="h-4 w-4" /> Not Printed</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedLabelIds.size > 0 && <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelectedLabelIds(new Set())}>Clear {selectedLabelIds.size}</Button>}
                    <Button size="sm" className="h-8 text-xs" onClick={openPrintDialog} disabled={printingLabels || baseLabelRows.length === 0}>
                      <Printer className="h-3.5 w-3.5 mr-1.5" /> Print Labels
                    </Button>
                  </div>
                </CardHeader>
                <div className="px-4 pb-3">
                  <Input value={notPrintedSearch} onChange={(e) => setNotPrintedSearch(e.target.value)} placeholder="Search order, tracking, city or product..." className="h-9 text-sm" />
                </div>
                <CardContent className="p-0">
                  <DispatchTable
                    rows={filteredNotPrinted}
                    loading={loadingNotPrinted}
                    selectedIds={selectedLabelIds}
                    allSelected={allDisplayedSelected}
                    onToggleAll={toggleDisplayedLabels}
                    onToggleRow={toggleLabelRow}
                    selectable
                  />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ready">
              <Card className="border-primary/30 bg-primary/[0.03]">
                <CardContent className="p-4">
                  <form className="flex gap-2" onSubmit={submitReadyScan}>
                    <Input ref={readyScanInput} value={readyScan} onChange={(e) => setReadyScan(e.target.value)} className="h-14 text-lg font-mono bg-background" placeholder="Scan internal QR, order code or tracking number" autoComplete="off" />
                    <Button type="submit" className="h-14 px-7"><ScanLine className="h-4 w-4 mr-2" /> Scan</Button>
                  </form>
                </CardContent>
              </Card>
              <Card className="border-border/60 mt-3">
                <CardHeader className="py-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Ready to Dispatch</CardTitle>
                  <Input className="h-8 w-[260px] text-xs" value={readySearch} onChange={(e) => setReadySearch(e.target.value)} placeholder="Filter ready orders..." />
                </CardHeader>
                <CardContent className="p-0">
                  <DispatchTable rows={filteredReady} loading={loadingReady} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="history">
              <Card className="border-border/60">
                <CardHeader className="py-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <CardTitle className="text-sm flex items-center gap-2"><History className="h-4 w-4" /> Dispatched Today</CardTitle>
                    <div className="flex flex-wrap gap-2">
                      {!hideSellerInfo && <Select value={historySellerFilter} onValueChange={setHistorySellerFilter}><SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sellers</SelectItem></SelectContent></Select>}
                      <Select value={historyCourierFilter} onValueChange={setHistoryCourierFilter}><SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All couriers</SelectItem>{Array.from(new Set(dispatchedRows.map((r) => r.carrier_name))).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                      <Select value={historyCityFilter} onValueChange={setHistoryCityFilter}><SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All cities</SelectItem>{Array.from(new Set(dispatchedRows.map((r) => r.customer_city))).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>
                      <Select value={historyUserFilter} onValueChange={setHistoryUserFilter}><SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All users</SelectItem></SelectContent></Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
	                  <DispatchHistoryTable rows={filteredHistory} loading={loadingDispatched} hideSellerInfo={hideSellerInfo} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}

        {section === "returns" && (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-4">
            <Card className="border-primary/30 bg-primary/[0.03]">
              <CardHeader className="py-4">
                <CardTitle className="text-sm flex items-center gap-2"><RotateCcw className="h-4 w-4" /> Receive Returned Parcel</CardTitle>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={submitReturnScan}>
                  <Input ref={returnScanInput} className="h-14 text-lg font-mono bg-background" value={returnScan} onChange={(e) => setReturnScan(e.target.value)} placeholder="Scan internal QR, order code or tracking number" autoComplete="off" />
                  <div className="flex gap-2">
                    <Select value={returnCondition} onValueChange={(value: ReturnCondition) => setReturnCondition(value)}>
                      <SelectTrigger className="h-10 w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sellable">Sellable</SelectItem>
                        <SelectItem value="damaged">Damaged</SelectItem>
                        <SelectItem value="missing_item">Missing</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button type="submit" className="h-10"><ScanLine className="h-4 w-4 mr-2" /> Find Order</Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="py-4"><CardTitle className="text-sm">Warehouse Audit Log</CardTitle></CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Time</TableHead>
                      <TableHead className="h-9 text-xs">Code</TableHead>
                      <TableHead className="h-9 text-xs">Action</TableHead>
                      <TableHead className="h-9 text-xs">Result</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentScans.length === 0 ? (
                      <TableRow><TableCell colSpan={4} className="text-sm text-muted-foreground">No audit events yet.</TableCell></TableRow>
                    ) : recentScans.map((scan) => (
                      <TableRow key={scan.id}>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(scan.scanned_at), "MMM d, HH:mm")}</TableCell>
                        <TableCell className="font-mono text-xs">{scan.tracking_number}</TableCell>
                        <TableCell className="text-xs">{scan.message || scan.scan_type}</TableCell>
                        <TableCell><StatusBadge value={scan.result} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={!!receiveDialogRow} onOpenChange={(open) => !open && setReceiveDialogRow(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Receive Sourcing Products</DialogTitle></DialogHeader>
          {receiveDialogRow && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                {!hideSellerInfo && <InfoLine label="Seller" value={sellerName(profileMap, receiveDialogRow.seller_id)} />}
                <InfoLine label="Product" value={receiveDialogRow.product_name} />
                <InfoLine label="Expected" value={String(receiveForm.expectedQuantity)} />
                <InfoLine label="Status" value={receiveDialogRow.status} />
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                  <Barcode className="h-3.5 w-3.5" />
                  Auto-generated product barcode
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <InfoLine label="Internal SKU" value={`${buildInternalSku(receiveDialogRow)}-B1`} />
                  <InfoLine label="Barcode" value={`${buildInternalSku(receiveDialogRow)}-B1`} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <NumberField label="Expected quantity" value={receiveForm.expectedQuantity} onChange={(v) => setReceiveForm((f) => ({ ...f, expectedQuantity: v }))} />
                <NumberField label="Received quantity" value={receiveForm.receivedQuantity} onChange={(v) => setReceiveForm((f) => ({ ...f, receivedQuantity: v, goodQuantity: Math.max(0, v - f.damagedQuantity) }))} />
                <NumberField label="Good quantity" value={receiveForm.goodQuantity} onChange={(v) => setReceiveForm((f) => ({ ...f, goodQuantity: v }))} />
                <NumberField label="Damaged quantity" value={receiveForm.damagedQuantity} onChange={(v) => setReceiveForm((f) => ({ ...f, damagedQuantity: v, goodQuantity: Math.max(0, f.receivedQuantity - v) }))} />
              </div>
              <div className="rounded-md border p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><MapPin className="h-3.5 w-3.5" /> Optional location</div>
                <div className="grid grid-cols-3 gap-2">
                  <Input placeholder="Rack e.g. R1" value={receiveForm.rack} onChange={(e) => setReceiveForm((f) => ({ ...f, rack: e.target.value }))} />
                  <Input placeholder="Shelf e.g. S2" value={receiveForm.shelf} onChange={(e) => setReceiveForm((f) => ({ ...f, shelf: e.target.value }))} />
                  <Input placeholder="Bin e.g. B4" value={receiveForm.bin} onChange={(e) => setReceiveForm((f) => ({ ...f, bin: e.target.value }))} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Location code: {buildLocationCode(receiveForm.rack, receiveForm.shelf, receiveForm.bin)}</p>
              </div>
              <Textarea value={receiveForm.notes} onChange={(e) => setReceiveForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Notes" />
              <div className="rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">Missing quantity: <span className="font-semibold text-foreground">{receiveMissing}</span></div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiveDialogRow(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveReceive} disabled={busy}>Save Receiving</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!adjustDialogRow} onOpenChange={(open) => !open && setAdjustDialogRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Manual Stock Adjustment</DialogTitle></DialogHeader>
          {adjustDialogRow && (
            <div className="space-y-3">
              <InfoLine label="Item" value={`${adjustDialogRow.product_name} - ${adjustDialogRow.variant_name || "Default"}`} />
              <InfoLine label="Current available" value={String(adjustDialogRow.quantity_on_hand)} />
              <div className="space-y-1.5">
                <Label>Adjustment quantity</Label>
                <Input value={adjustQuantity} onChange={(e) => setAdjustQuantity(e.target.value)} placeholder="Use negative number to reduce stock" />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Textarea value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Required audit reason" />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogRow(null)} disabled={busy}>Cancel</Button>
            <Button onClick={saveAdjustment} disabled={busy}>Save Adjustment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={labelDialogOpen} onOpenChange={setLabelDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Printer className="h-5 w-5 text-primary" />
              Confirm Label Print
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Kpi icon={<ClipboardList className="h-4 w-4" />} label="Shipments" value={labelSummary.total} />
            <Kpi icon={<Printer className="h-4 w-4" />} label="PDF Batches" value={labelSummary.batches} />
            <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Carriers" value={labelSummary.carriers} />
            <Kpi icon={<WarehouseIcon className="h-4 w-4" />} label="Cities" value={labelSummary.cities} />
            <Kpi icon={<Boxes className="h-4 w-4" />} label="COD PKR" value={labelSummary.codTotal} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <Select value={labelCityFilter} onValueChange={setLabelCityFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="City" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All cities</SelectItem>
                {labelFilterOptions.cities.map((city) => <SelectItem key={city} value={city}>{city}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={labelProductFilter} onValueChange={setLabelProductFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Product" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All products</SelectItem>
                {labelFilterOptions.products.map((product) => <SelectItem key={product} value={product}>{product}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={labelCarrierFilter} onValueChange={setLabelCarrierFilter}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Carrier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All carriers</SelectItem>
                {labelFilterOptions.carriers.map((carrier) => <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="rounded-md border max-h-[420px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="h-9 text-xs">Order</TableHead>
                  <TableHead className="h-9 text-xs">Customer</TableHead>
                  <TableHead className="h-9 text-xs">City</TableHead>
                  <TableHead className="h-9 text-xs">Product</TableHead>
                  <TableHead className="h-9 text-xs">Carrier</TableHead>
                  <TableHead className="h-9 text-xs">Tracking</TableHead>
                  <TableHead className="h-9 text-xs text-right">COD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredLabelRows.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No pending labels match these filters.</TableCell></TableRow>
                ) : filteredLabelRows.map((row) => (
                  <TableRow key={row.fulfillment_item_id}>
                    <TableCell className="font-mono text-xs font-semibold">{row.order_id}</TableCell>
                    <TableCell className="text-sm">{row.customer_name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{row.customer_city}</TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate">{row.product_name || "-"}</TableCell>
                    <TableCell className="text-sm">{row.carrier_name}</TableCell>
                    <TableCell className="font-mono text-xs">{row.tracking_number}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{Number(row.total_amount || 0).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLabelDialogOpen(false)} disabled={printingLabels}>Cancel</Button>
            <Button onClick={() => printLabels(filteredLabelRows)} disabled={printingLabels || filteredLabelRows.length === 0}>
              <Printer className="h-4 w-4 mr-2" />
              Print {labelSummary.total} Labels
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dispatchCandidate} onOpenChange={(open) => !open && setDispatchCandidate(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Confirm Dispatch</DialogTitle></DialogHeader>
          {dispatchCandidate && (
            <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-sm">
              <InfoLine label="Order number" value={dispatchCandidate.order_id} />
              {!hideSellerInfo && <InfoLine label="Seller" value="Linked seller" />}
              <InfoLine label="Product(s)" value={dispatchCandidate.product_name || "-"} />
              <InfoLine label="Quantity" value={String(dispatchCandidate.item_count || 1)} />
              <InfoLine label="Customer city" value={dispatchCandidate.customer_city} />
              <InfoLine label="Courier" value={dispatchCandidate.carrier_name} />
              <InfoLine label="Tracking" value={dispatchCandidate.tracking_number || "-"} />
              <InfoLine label="Warehouse location" value="Use inventory location" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDispatchCandidate(null)} disabled={busy}>Cancel</Button>
            <Button onClick={dispatchOrder} disabled={busy}>Dispatch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!returnDialogOrder} onOpenChange={(open) => !open && setReturnDialogOrder(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Receive Return</DialogTitle></DialogHeader>
          {returnDialogOrder && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                <InfoLine label="Order number" value={returnDialogOrder.order_id} />
                <InfoLine label="Product(s)" value={returnDialogOrder.product_name || "-"} />
                <InfoLine label="Customer city" value={returnDialogOrder.customer_city} />
                <InfoLine label="Tracking" value={returnDialogOrder.tracking_number || "-"} />
              </div>
              <div className="space-y-1.5">
                <Label>Condition</Label>
                <Select value={returnCondition} onValueChange={(value: ReturnCondition) => setReturnCondition(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sellable">Sellable</SelectItem>
                    <SelectItem value="damaged">Damaged</SelectItem>
                    <SelectItem value="missing_item">Missing</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea value={returnNote} onChange={(e) => setReturnNote(e.target.value)} placeholder="Optional return note" />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOrder(null)} disabled={busy}>Cancel</Button>
            <Button onClick={receiveReturn} disabled={busy}>Receive Return</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${statusBadgeClass(value)}`}>{value.replace(/_/g, " ")}</span>;
}

function DashboardSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card className="border-border/60">
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {children}
      </CardContent>
    </Card>
  );
}

function Kpi({ icon, label, value, suffix = "" }: { icon: React.ReactNode; label: string; value: number; suffix?: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
          {icon}
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-lg font-bold tabular-nums">{value.toLocaleString()}{suffix}</p>
      </CardContent>
    </Card>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-medium truncate">{value}</p>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value || 0))} />
    </div>
  );
}

function DispatchTable({
  rows,
  loading,
  selectedIds,
  allSelected,
  onToggleAll,
  onToggleRow,
  selectable = false,
}: {
  rows: FulfillmentRow[];
  loading: boolean;
  selectedIds?: Set<string>;
  allSelected?: boolean;
  onToggleAll?: () => void;
  onToggleRow?: (id: string) => void;
  selectable?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {selectable && (
            <TableHead className="h-9 w-10">
              <Checkbox checked={!!allSelected} onCheckedChange={onToggleAll} disabled={rows.length === 0} />
            </TableHead>
          )}
          <TableHead className="h-9 text-xs">Order</TableHead>
          <TableHead className="h-9 text-xs">Customer</TableHead>
          <TableHead className="h-9 text-xs">Product</TableHead>
          <TableHead className="h-9 text-xs">Courier</TableHead>
          <TableHead className="h-9 text-xs">Tracking</TableHead>
          <TableHead className="h-9 text-xs">Stage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={selectable ? 7 : 6} className="text-sm text-muted-foreground">Loading orders...</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={selectable ? 7 : 6} className="text-sm text-muted-foreground">No orders in this view.</TableCell></TableRow>
        ) : rows.map((row) => (
          <TableRow key={row.fulfillment_item_id}>
            {selectable && (
              <TableCell>
                <Checkbox checked={selectedIds?.has(row.fulfillment_item_id)} onCheckedChange={() => onToggleRow?.(row.fulfillment_item_id)} disabled={!row.tracking_number} />
              </TableCell>
            )}
            <TableCell>
              <div className="font-mono text-xs font-semibold">{row.order_id}</div>
              {row.system_id && <div className="text-[11px] text-muted-foreground">#{row.system_id}</div>}
            </TableCell>
            <TableCell>
              <div className="text-sm font-medium">{row.customer_name}</div>
              <div className="text-[11px] text-muted-foreground">{row.customer_city}</div>
            </TableCell>
            <TableCell className="text-xs max-w-[240px] truncate">{row.product_name || "-"}</TableCell>
            <TableCell className="text-sm">{row.carrier_name}</TableCell>
            <TableCell className="font-mono text-xs">{row.tracking_number || "-"}</TableCell>
            <TableCell><StatusBadge value={row.fulfillment_item_status} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DispatchHistoryTable({ rows, loading, hideSellerInfo }: { rows: FulfillmentRow[]; loading: boolean; hideSellerInfo?: boolean }) {
  return (
    <Table>
      <TableHeader>
          <TableRow>
            <TableHead className="h-9 text-xs">Order number</TableHead>
          {!hideSellerInfo && <TableHead className="h-9 text-xs">Seller</TableHead>}
          <TableHead className="h-9 text-xs">Product</TableHead>
          <TableHead className="h-9 text-xs text-right">Quantity</TableHead>
          <TableHead className="h-9 text-xs">Courier</TableHead>
          <TableHead className="h-9 text-xs">Tracking</TableHead>
          <TableHead className="h-9 text-xs">Dispatched at</TableHead>
          <TableHead className="h-9 text-xs">Dispatched by</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={hideSellerInfo ? 7 : 8} className="text-sm text-muted-foreground">Loading dispatch history...</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={hideSellerInfo ? 7 : 8} className="text-sm text-muted-foreground">No dispatched orders today.</TableCell></TableRow>
        ) : rows.map((row) => (
          <TableRow key={row.fulfillment_item_id}>
            <TableCell className="font-mono text-xs font-semibold">{row.order_id}</TableCell>
            {!hideSellerInfo && <TableCell className="text-sm">Linked seller</TableCell>}
            <TableCell className="text-xs max-w-[240px] truncate">{row.product_name || "-"}</TableCell>
            <TableCell className="text-right">{row.item_count || 1}</TableCell>
            <TableCell className="text-sm">{row.carrier_name}</TableCell>
            <TableCell className="font-mono text-xs">{row.tracking_number || "-"}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{format(new Date(row.updated_at), "MMM d, HH:mm")}</TableCell>
            <TableCell className="text-xs text-muted-foreground">Warehouse user</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
