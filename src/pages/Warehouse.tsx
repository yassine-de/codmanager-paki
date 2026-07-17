import { Fragment, FormEvent, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertCircle,
  Barcode,
  Boxes,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  ClipboardList,
  History,
  Layers,
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

interface ReturnedOrderRow {
  id: string;
  order_id: string;
  customer_name: string;
  customer_city: string;
  total_amount: number;
  delivery_status: string | null;
  fulfillment_status: string | null;
  updated_at: string;
  shipments?: Array<{
    id: string;
    tracking_number: string | null;
    carriers?: { name: string | null } | null;
  }>;
  order_items?: Array<{
    product_name: string | null;
    quantity: number;
  }>;
}

interface InventoryRow {
  id: string;
  product_variant_id: string;
  sku: string | null;
  variant_name: string | null;
  product_id: string;
  product_name: string;
  product_image_url?: string | null;
  seller_id: string;
  location_id: string;
  location_code: string;
  location_name: string;
  location_type: string;
  quantity_on_hand: number;
  quantity_reserved: number;
  updated_at: string;
  available_quantity?: number;
  damaged_quantity?: number;
  location_codes?: string[];
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

interface ReceiveLine {
  key: string;
  label: string;
  expectedQuantity: number;
  receivedQuantity: number;
  goodQuantity: number;
  damagedQuantity: number;
}

const sourcingReceiveStatuses = ["ordered", "shipped", "arrived", "ready_to_receive", "ready_to_receive_in_warehouse"];

function buildInternalSku(row: Pick<SourcingReceiveRow, "id">) {
  return `WH-${row.id.slice(0, 6).toUpperCase()}`;
}

function skuSuffix(value: string, fallback: string) {
  const clean = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 10);
  return clean || fallback;
}

function flattenReceiveLines(row: SourcingReceiveRow): ReceiveLine[] {
  const variants = Array.isArray(row.variants) ? row.variants : [];
  const lines: ReceiveLine[] = [];

  variants.forEach((variant: any, variantIndex: number) => {
    const variantName = String(variant?.name || variant?.group || `Variant ${variantIndex + 1}`).trim();
    const children = Array.isArray(variant?.subVariants) && variant.subVariants.length > 0
      ? variant.subVariants
      : Array.isArray(variant?.options) && variant.options.length > 0
        ? variant.options
        : null;

    if (children) {
      children.forEach((child: any, childIndex: number) => {
        const childName = String(child?.name || child?.label || `Option ${childIndex + 1}`).trim();
        const expected = Number(child?.quantity || 0);
        lines.push({
          key: `v${variantIndex}-s${childIndex}`,
          label: `${variantName} / ${childName}`,
          expectedQuantity: expected,
          receivedQuantity: expected,
          goodQuantity: expected,
          damagedQuantity: 0,
        });
      });
      return;
    }

    const expected = Number(variant?.quantity || 0);
    lines.push({
      key: `v${variantIndex}`,
      label: variantName || `Variant ${variantIndex + 1}`,
      expectedQuantity: expected,
      receivedQuantity: expected,
      goodQuantity: expected,
      damagedQuantity: 0,
    });
  });

  const validLines = lines.filter((line) => line.expectedQuantity > 0 || line.label.trim());
  if (validLines.length > 0) return validLines;

  const expected = Number(row.quantity || 0);
  return [{
    key: "default",
    label: "Default",
    expectedQuantity: expected,
    receivedQuantity: expected,
    goodQuantity: expected,
    damagedQuantity: 0,
  }];
}

function sellerName(map: Map<string, ProfileRow>, id: string | null | undefined) {
  if (!id) return "-";
  return map.get(id)?.name || id.slice(0, 8);
}

function statusBadgeClass(status: string) {
  const normalized = status.toLowerCase();
  if (["received", "scanned", "dispatched", "ok", "sellable"].includes(normalized)) return "bg-success/12 text-success border-success/25";
  if (["pending", "label_printed", "ready", "printed", "shipped"].includes(normalized)) return "bg-primary/12 text-primary border-primary/25";
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

const barcodeLabelSizes: Record<BarcodeLabelSize, { label: string; description: string; width: number; height: number; barcodeHeight: number; fontSize: number }> = {
  small: { label: "Small", description: "50 x 25 mm", width: 50, height: 25, barcodeHeight: 38, fontSize: 8 },
  standard: { label: "Standard", description: "70 x 35 mm", width: 70, height: 35, barcodeHeight: 52, fontSize: 10 },
  large: { label: "Large", description: "100 x 50 mm", width: 100, height: 50, barcodeHeight: 72, fontSize: 12 },
};

const code128Patterns = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100", "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110", "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100", "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000", "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110", "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000", "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100", "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010", "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100", "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110", "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000", "11010011100", "1100011101011",
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] || char));
}

function toCode128BarcodeSvg(value: string, height: number) {
  const clean = value.replace(/[^\x20-\x7f]/g, "").trim();
  if (!clean) return "";
  const codes = [104, ...Array.from(clean, (char) => char.charCodeAt(0) - 32)];
  const checksum = codes.reduce((sum, code, index) => sum + (index === 0 ? code : code * index), 0) % 103;
  codes.push(checksum, 106);
  const pattern = codes.map((code) => code128Patterns[code]).join("");
  const moduleWidth = 2;
  let x = 0;
  const bars: string[] = [];

  for (const bit of pattern) {
    if (bit === "1") bars.push(`<rect x="${x}" y="0" width="${moduleWidth}" height="${height}" />`);
    x += moduleWidth;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" aria-label="${escapeHtml(clean)}"><g fill="#111">${bars.join("")}</g></svg>`;
}

type WarehouseSection = "dashboard" | "receiving" | "inventory" | "dispatch" | "returns";
type DashboardRange = "today" | "yesterday" | "last_7" | "last_30" | "custom";
type BarcodeLabelSize = "small" | "standard" | "large";

interface InventoryMovementRow {
  id: string;
  movement_type: string;
  quantity_change: number;
  created_at: string;
  metadata: any;
}

interface ReturnReceiptRow {
  id: string;
  shipment_id?: string | null;
  order_id?: string | null;
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
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
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
  const [expandedInventoryProducts, setExpandedInventoryProducts] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const [adjustDialogRow, setAdjustDialogRow] = useState<InventoryRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [barcodeDialogRow, setBarcodeDialogRow] = useState<InventoryRow | null>(null);
  const [barcodePrintSize, setBarcodePrintSize] = useState<BarcodeLabelSize>("standard");

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
      const rows = (data || []) as InventoryRow[];
      const productIds = Array.from(new Set(rows.map((row) => row.product_id).filter(Boolean)));
      if (productIds.length === 0) return rows;

      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, image_url, scraped_image_url")
        .in("id", productIds);
      if (productsError) throw productsError;

      const imageMap = new Map((products || []).map((product: any) => [product.id, product.image_url || product.scraped_image_url || null]));
      return rows.map((row) => ({ ...row, product_image_url: imageMap.get(row.product_id) || null }));
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

  const { data: returnReceipts = [] } = useQuery({
    queryKey: ["warehouse-return-receipts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("return_receipts" as any)
        .select("id, shipment_id, order_id, condition, received_at")
        .order("received_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as ReturnReceiptRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
  });

  const { data: returnedOrders = [], isLoading: loadingReturnedOrders } = useQuery({
    queryKey: ["warehouse-returned-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders" as any)
        .select("id, order_id, customer_name, customer_city, total_amount, delivery_status, fulfillment_status, updated_at, shipments(id, tracking_number, carriers(name)), order_items(product_name, quantity)")
        .in("delivery_status", ["return", "returned", "ready_for_return", "return_received"])
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as ReturnedOrderRow[];
    },
    enabled: isWarehouseUser,
    refetchInterval: 15000,
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
        .select("id, shipment_id, order_id, condition, received_at")
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

  const { data: dashboardOrders = [] } = useQuery({
    queryKey: ["warehouse-dashboard-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, delivery_status, updated_at")
        .in("delivery_status", ["printed", "dispatched", "shipped", "in_transit", "with_courier", "out_for_delivery"])
        .limit(1000);
      if (error) throw error;
      return (data || []) as Array<{ id: string; order_id: string; delivery_status: string | null; updated_at: string }>;
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

  const displayInventory = useMemo(() => {
    const groups = new Map<string, {
      primary: InventoryRow;
      rows: InventoryRow[];
      available: number;
      damaged: number;
      reserved: number;
      latest: string;
      locationCodes: string[];
    }>();

    inventory.forEach((row) => {
      const group = groups.get(row.product_variant_id) || {
        primary: row,
        rows: [],
        available: 0,
        damaged: 0,
        reserved: 0,
        latest: row.updated_at,
        locationCodes: [],
      };

      if (group.primary.location_type === "damaged" && row.location_type !== "damaged") {
        group.primary = row;
      }
      group.rows.push(row);
      group.reserved += Number(row.quantity_reserved || 0);
      if (row.location_type === "damaged") {
        group.damaged += Number(row.quantity_on_hand || 0);
      } else {
        group.available += Number(row.quantity_on_hand || 0);
      }
      if (row.location_code && !group.locationCodes.includes(row.location_code)) {
        group.locationCodes.push(row.location_code);
      }
      if (new Date(row.updated_at).getTime() > new Date(group.latest).getTime()) {
        group.latest = row.updated_at;
      }
      groups.set(row.product_variant_id, group);
    });

    return Array.from(groups.values()).map((group) => {
      const sellableLocations = Array.from(new Set(
        group.rows
          .filter((row) => row.location_type !== "damaged")
          .map((row) => row.location_code)
          .filter(Boolean),
      ));
      const locationCode = sellableLocations.length === 0
        ? "DAMAGED"
        : sellableLocations.length === 1
          ? sellableLocations[0]
          : "MULTIPLE";

      return {
        ...group.primary,
        quantity_on_hand: group.available,
        quantity_reserved: group.reserved,
        updated_at: group.latest,
        location_code: locationCode,
        location_name: locationCode,
        available_quantity: group.available,
        damaged_quantity: group.damaged,
        location_codes: group.locationCodes,
      };
    });
  }, [inventory]);

  const inventoryOptions = useMemo(() => {
    const sellerIds = Array.from(new Set(displayInventory.map((row) => row.seller_id).filter(Boolean)));
    const products = Array.from(new Set(displayInventory.map((row) => row.product_name).filter(Boolean))).sort();
    const locations = Array.from(new Set(inventory.map((row) => row.location_code).filter(Boolean))).sort();
    return { sellerIds, products, locations };
  }, [displayInventory, inventory]);

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
    return displayInventory.filter((row) => {
      if (inventorySellerFilter !== "all" && row.seller_id !== inventorySellerFilter) return false;
      if (inventoryProductFilter !== "all" && row.product_name !== inventoryProductFilter) return false;
      if (inventoryLocationFilter !== "all" && !row.location_codes?.includes(inventoryLocationFilter)) return false;
      if (!q) return true;
      return [
        hideSellerInfo ? "" : sellerName(profileMap, row.seller_id),
        row.product_name,
        row.variant_name || "",
        row.sku || "",
        row.location_code,
        ...(row.location_codes || []),
      ].join(" ").toLowerCase().includes(q);
    });
  }, [displayInventory, hideSellerInfo, inventoryLocationFilter, inventoryProductFilter, inventorySearch, inventorySellerFilter, profileMap]);

  const groupedInventory = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      productName: string;
      sellerId: string;
      variants: InventoryRow[];
      available: number;
      reserved: number;
      damaged: number;
      dispatched: number;
      latest: string;
      locations: string[];
      imageUrl: string | null;
    }>();

    filteredInventory.forEach((row) => {
      const key = `${row.seller_id || "seller"}:${row.product_id}`;
      const existing = groups.get(key) || {
        key,
        productName: row.product_name,
        sellerId: row.seller_id,
        variants: [],
        available: 0,
        reserved: 0,
        damaged: 0,
        dispatched: 0,
        latest: row.updated_at,
        locations: [],
        imageUrl: row.product_image_url || null,
      };
      if (!existing.imageUrl && row.product_image_url) existing.imageUrl = row.product_image_url;
      existing.variants.push(row);
      existing.available += Number(row.available_quantity ?? row.quantity_on_hand ?? 0);
      existing.reserved += Number(row.quantity_reserved || 0);
      existing.damaged += Number(row.damaged_quantity || 0);
      existing.dispatched += Number(dispatchedByVariant.get(row.product_variant_id) || 0);
      if (new Date(row.updated_at).getTime() > new Date(existing.latest).getTime()) existing.latest = row.updated_at;
      (row.location_codes?.length ? row.location_codes : [row.location_code]).forEach((location) => {
        if (location && !existing.locations.includes(location)) existing.locations.push(location);
      });
      groups.set(key, existing);
    });

    return Array.from(groups.values()).sort((a, b) => a.productName.localeCompare(b.productName));
  }, [dispatchedByVariant, filteredInventory]);

  const dashboardProductRows = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      productName: string;
      sellerId: string;
      imageUrl: string | null;
      variants: number;
      available: number;
      reserved: number;
      damaged: number;
      dispatched: number;
      locations: string[];
      latest: string;
    }>();

    displayInventory.forEach((row) => {
      const key = `${row.seller_id || "seller"}:${row.product_id}`;
      const current = groups.get(key) || {
        key,
        productName: row.product_name,
        sellerId: row.seller_id,
        imageUrl: row.product_image_url || null,
        variants: 0,
        available: 0,
        reserved: 0,
        damaged: 0,
        dispatched: 0,
        locations: [],
        latest: row.updated_at,
      };
      if (!current.imageUrl && row.product_image_url) current.imageUrl = row.product_image_url;
      current.variants += 1;
      current.available += Number(row.available_quantity ?? row.quantity_on_hand ?? 0);
      current.reserved += Number(row.quantity_reserved || 0);
      current.damaged += Number(row.damaged_quantity || 0);
      current.dispatched += Number(dispatchedByVariant.get(row.product_variant_id) || 0);
      if (new Date(row.updated_at).getTime() > new Date(current.latest).getTime()) current.latest = row.updated_at;
      (row.location_codes?.length ? row.location_codes : [row.location_code]).forEach((location) => {
        if (location && !current.locations.includes(location)) current.locations.push(location);
      });
      groups.set(key, current);
    });

    return Array.from(groups.values()).sort((a, b) => (b.available + b.dispatched + b.damaged) - (a.available + a.dispatched + a.damaged));
  }, [displayInventory, dispatchedByVariant]);

  const toggleInventoryProduct = (key: string) => {
    setExpandedInventoryProducts((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  const returnReceiptKeys = useMemo(() => {
    const shipmentIds = new Set<string>();
    const orderIds = new Set<string>();
    returnReceipts.forEach((receipt) => {
      if (receipt.shipment_id) shipmentIds.add(receipt.shipment_id);
      if (receipt.order_id) orderIds.add(receipt.order_id);
    });
    return { shipmentIds, orderIds };
  }, [returnReceipts]);

  const pendingReturnOrders = useMemo(() => {
    return returnedOrders.filter((order) => {
      if (order.delivery_status === "return_received") return false;
      if (order.fulfillment_status && ["restocked", "damaged_return", "missing_return", "return_inspection"].includes(order.fulfillment_status)) return false;
      if (returnReceiptKeys.orderIds.has(order.order_id)) return false;
      const hasReceiptForShipment = (order.shipments || []).some((shipment) => returnReceiptKeys.shipmentIds.has(shipment.id));
      return !hasReceiptForShipment;
    });
  }, [returnReceiptKeys, returnedOrders]);

  const returnStats = useMemo(() => ({
    scannedReturned: returnReceipts.length,
    pendingWarehouseScan: pendingReturnOrders.length,
    damagedOrders: returnReceipts.filter((receipt) => receipt.condition === "damaged").length,
    missingItems: returnReceipts.filter((receipt) => receipt.condition === "missing_item").length,
  }), [pendingReturnOrders.length, returnReceipts]);

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
      shippedOrders: dashboardOrders.filter((row) => ["shipped", "in_transit", "with_courier", "out_for_delivery"].includes(row.delivery_status || "")).length,
      dispatchSuccessRate,
      avgDispatchTimeHours,
      productCount: dashboardProductRows.length,
      variantsInStock: dashboardProductRows.reduce((sum, row) => sum + row.variants, 0),
      productsWithDispatched: dashboardProductRows.filter((row) => row.dispatched > 0).length,
      productsWithDamage: dashboardProductRows.filter((row) => row.damaged > 0).length,
      returnsReceived: dashboardReturns.length,
      sellableReturns: dashboardReturns.filter((row) => row.condition === "sellable").length,
      damagedReturns: dashboardReturns.filter((row) => row.condition === "damaged").length,
      missingReturns: dashboardReturns.filter((row) => row.condition === "missing_item").length,
      duplicateScanAttempts: dashboardScans.filter((row) => row.result === "duplicate").length,
      unknownScanAttempts: dashboardScans.filter((row) => row.result === "unknown").length,
      manualStockAdjustments: dashboardMovements.filter((row) => row.movement_type === "adjustment").length,
    };
  }, [dashboardDispatched, dashboardMovements, dashboardOrders, dashboardProductRows, dashboardReturns, dashboardScans, inventory, notPrintedRows.length, readyRows.length, receivingRows.length]);

  const refreshWarehouse = () => {
    queryClient.invalidateQueries({ queryKey: ["warehouse-receiving"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-inventory"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dispatched-inventory"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-not-printed"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-ready-dispatch"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-dispatched-today"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-audit-scans"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-return-receipts"] });
    queryClient.invalidateQueries({ queryKey: ["warehouse-returned-orders"] });
  };

  const openReceiveDialog = (row: SourcingReceiveRow) => {
    const lines = flattenReceiveLines(row);
    const expected = lines.reduce((sum, line) => sum + Number(line.expectedQuantity || 0), 0);
    setReceiveDialogRow(row);
    setReceiveLines(lines);
    setReceiveForm({
      sourcingId: row.id,
      expectedQuantity: expected,
      receivedQuantity: expected,
      goodQuantity: expected,
      damagedQuantity: 0,
      rack: "",
      shelf: "",
      bin: "",
      notes: "",
    });
  };

  const receiveTotals = useMemo(() => {
    const expected = receiveLines.reduce((sum, line) => sum + Number(line.expectedQuantity || 0), 0);
    const received = receiveLines.reduce((sum, line) => sum + Number(line.receivedQuantity || 0), 0);
    const good = receiveLines.reduce((sum, line) => sum + Number(line.goodQuantity || 0), 0);
    const damaged = receiveLines.reduce((sum, line) => sum + Number(line.damagedQuantity || 0), 0);
    return { expected, received, good, damaged, missing: Math.max(0, expected - received) };
  }, [receiveLines]);

  const receiveMissing = receiveTotals.missing;

  const updateReceiveLine = (key: string, patch: Partial<ReceiveLine>) => {
    setReceiveLines((lines) => lines.map((line) => line.key === key ? { ...line, ...patch } : line));
  };

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

  async function ensureProductVariant(row: SourcingReceiveRow, line: ReceiveLine) {
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
    const isDefaultLine = line.key === "default";
    const variantSku = isDefaultLine ? baseSku : `${baseSku}-${skuSuffix(line.label, line.key.toUpperCase())}`;

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
      .eq("sku", variantSku)
      .limit(1)
      .maybeSingle();
    if (variant?.id) return { productId, variantId: variant.id as string, sku: variant.sku as string };

    const { data: createdVariant, error: variantError } = await supabase
      .from("product_variants" as any)
      .insert({
        product_id: productId,
        sku: variantSku,
        name: line.label,
        attributes: { batch: row.id.slice(0, 8), source: "warehouse_receiving", receive_line_key: line.key },
      })
      .select("id, sku")
      .single();
    if (variantError) throw variantError;
    return { productId, variantId: createdVariant.id as string, sku: createdVariant.sku as string };
  }

  async function addInventoryBalance(productVariantId: string, locationId: string, quantity: number) {
    if (quantity <= 0) return;
    const { data: existing, error: selectError } = await supabase
      .from("inventory_balances" as any)
      .select("quantity_on_hand")
      .eq("product_variant_id", productVariantId)
      .eq("location_id", locationId)
      .maybeSingle();
    if (selectError) throw selectError;

    const nextQuantity = Number(existing?.quantity_on_hand || 0) + quantity;
    const { error } = await supabase
      .from("inventory_balances" as any)
      .upsert({
        product_variant_id: productVariantId,
        location_id: locationId,
        quantity_on_hand: nextQuantity,
        updated_at: new Date().toISOString(),
      }, { onConflict: "product_variant_id,location_id" });
    if (error) throw error;
  }

  const saveReceive = async () => {
    if (!receiveDialogRow) return;
    if (receiveLines.length === 0) {
      toast.error("No receiving lines found");
      return;
    }
    for (const line of receiveLines) {
      const received = Number(line.receivedQuantity || 0);
      const good = Number(line.goodQuantity || 0);
      const damaged = Number(line.damagedQuantity || 0);
      if (received < 0 || good < 0 || damaged < 0) {
        toast.error("Quantities cannot be negative");
        return;
      }
      if (good + damaged > received) {
        toast.error(`Good + damaged cannot exceed received quantity for ${line.label}`);
        return;
      }
    }

    setBusy(true);
    try {
      const sellableLocationId = await ensureLocation(buildLocationCode(receiveForm.rack, receiveForm.shelf, receiveForm.bin), "sellable");
      const hasDamaged = receiveLines.some((line) => Number(line.damagedQuantity || 0) > 0);
      const damagedLocationId = hasDamaged ? await ensureLocation("DAMAGED", "damaged") : null;

      for (const line of receiveLines) {
        const { variantId } = await ensureProductVariant(receiveDialogRow, line);
        const received = Number(line.receivedQuantity || 0);
        const good = Number(line.goodQuantity || 0);
        const damaged = Number(line.damagedQuantity || 0);
        const lineMissing = Math.max(0, Number(line.expectedQuantity || 0) - received);

        if (good > 0) {
          await addInventoryBalance(variantId, sellableLocationId, good);
          const { error: movementError } = await supabase.from("inventory_movements" as any).insert({
            product_variant_id: variantId,
            movement_type: "restock",
            quantity_change: good,
            to_location_id: sellableLocationId,
            created_by: authUser?.id,
            metadata: {
              reason: "Warehouse receiving",
              sourcing_request_id: receiveDialogRow.id,
              variant_name: line.label,
              expected_quantity: line.expectedQuantity,
              received_quantity: received,
              missing_quantity: lineMissing,
              notes: receiveForm.notes || null,
            },
          });
          if (movementError) throw movementError;
        }

        if (damaged > 0 && damagedLocationId) {
          await addInventoryBalance(variantId, damagedLocationId, damaged);
          const { error: movementError } = await supabase.from("inventory_movements" as any).insert({
            product_variant_id: variantId,
            movement_type: "damage",
            quantity_change: damaged,
            to_location_id: damagedLocationId,
            created_by: authUser?.id,
            metadata: {
              reason: "Warehouse receiving damaged",
              sourcing_request_id: receiveDialogRow.id,
              variant_name: line.label,
              expected_quantity: line.expectedQuantity,
              received_quantity: received,
              missing_quantity: lineMissing,
              notes: receiveForm.notes || null,
            },
          });
          if (movementError) throw movementError;
        }
      }

      const { error: sourcingError } = await supabase
        .from("sourcing_requests")
        .update({ status: "received", product_created: true, notes: receiveForm.notes || receiveDialogRow.notes, updated_at: new Date().toISOString() } as any)
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
      setReceiveLines([]);
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

  const updateOrderDeliveryStatus = async (rows: FulfillmentRow[], nextStatus: "printed" | "dispatched", actionType: string) => {
    const orderIds = Array.from(new Set(rows.map((row) => row.order_id).filter(Boolean)));
    if (orderIds.length === 0) return;

    const { data: currentRows, error: selectError } = await supabase
      .from("orders")
      .select("order_id, delivery_status")
      .in("order_id", orderIds);
    if (selectError) throw selectError;

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from("orders")
      .update({ delivery_status: nextStatus, updated_at: now } as any)
      .in("order_id", orderIds);
    if (updateError) throw updateError;

    const historyRows = (currentRows || [])
      .filter((row: any) => row.delivery_status !== nextStatus)
      .map((row: any) => ({
        order_id: row.order_id,
        changed_by: authUser?.id,
        changed_by_role: authUser?.role || "warehouse",
        field_changed: "delivery_status",
        old_value: row.delivery_status || null,
        new_value: nextStatus,
        action_type: actionType,
      }));
    if (historyRows.length > 0) {
      await supabase.from("order_history").insert(historyRows as any);
    }
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
      const pendingRows = rows.filter((row) => row.fulfillment_item_status === "pending");
      const pendingIds = pendingRows.map((row) => row.fulfillment_item_id);
      if (pendingIds.length > 0) {
        const { error } = await supabase
          .from("fulfillment_items" as any)
          .update({ status: "label_printed", label_printed_at: printedAt, packed_at: printedAt, packed_by: authUser?.id, updated_at: printedAt })
          .in("id", pendingIds);
        if (error) throw error;
        await updateOrderDeliveryStatus(pendingRows, "printed", "warehouse_label_printed");
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
      else {
        await updateOrderDeliveryStatus([dispatchCandidate], "dispatched", "warehouse_dispatch_scan");
        toast.success("Order dispatched");
      }
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
    const returnedOrder = pendingReturnOrders.find((row) => {
      const tracking = row.shipments?.[0]?.tracking_number || "";
      return tracking === code || row.order_id === code || String(row.id || "") === code;
    });
    if (!order && !returnedOrder) {
      toast.error("Order not found");
      return;
    }
    if (order) {
      setReturnDialogOrder(order);
    } else if (returnedOrder) {
      const shipment = returnedOrder.shipments?.[0];
      const productSummary = (returnedOrder.order_items || [])
        .map((item) => `${item.product_name || "Product"}${Number(item.quantity || 0) > 1 ? ` x${item.quantity}` : ""}`)
        .join(", ");
      setReturnDialogOrder({
        fulfillment_item_id: returnedOrder.id,
        fulfillment_item_status: returnedOrder.fulfillment_status || "returned",
        batch_number: null,
        order_id: returnedOrder.order_id,
        system_id: null,
        customer_name: returnedOrder.customer_name,
        customer_city: returnedOrder.customer_city,
        total_amount: returnedOrder.total_amount,
        shipment_id: shipment?.id || "",
        tracking_number: shipment?.tracking_number || null,
        carrier_name: shipment?.carriers?.name || "-",
        created_at: returnedOrder.updated_at,
        updated_at: returnedOrder.updated_at,
        product_name: productSummary || "-",
        item_count: returnedOrder.order_items?.length || null,
      });
    }
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

  const printBarcode = (row: InventoryRow, sizeKey: BarcodeLabelSize) => {
    const value = (row.sku || row.product_variant_id).trim();
    if (!toCode128BarcodeSvg(value, barcodeLabelSizes[sizeKey].barcodeHeight)) {
      toast.error("No barcode value found");
      return;
    }
    setBarcodePrintSize(sizeKey);
    window.print();
  };

  if (!isWarehouseUser) {
    return <div className="rounded-md border bg-card p-6 text-sm text-muted-foreground">You do not have access to the warehouse module.</div>;
  }

  const activeBarcodeSize = barcodeLabelSizes[barcodePrintSize];
  const activeBarcodeValue = barcodeDialogRow ? (barcodeDialogRow.sku || barcodeDialogRow.product_variant_id) : "";

  return (
    <div className="space-y-5">
      <style>
        {`
          @media print {
            html,
            body,
            #root {
              width: ${activeBarcodeSize.width}mm !important;
              height: ${activeBarcodeSize.height}mm !important;
              min-width: 0 !important;
              min-height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
              overflow: hidden !important;
              background: #fff !important;
            }
            body * {
              visibility: hidden !important;
              overflow: hidden !important;
            }
            #warehouse-barcode-print-area,
            #warehouse-barcode-print-area * {
              visibility: visible !important;
            }
            #warehouse-barcode-print-area {
              display: block !important;
              position: absolute !important;
              left: 0 !important;
              top: 0 !important;
              width: ${activeBarcodeSize.width}mm !important;
              height: ${activeBarcodeSize.height}mm !important;
              max-width: ${activeBarcodeSize.width}mm !important;
              max-height: ${activeBarcodeSize.height}mm !important;
              margin: 0 !important;
              padding: 2.2mm 2.6mm !important;
              background: #fff !important;
              overflow: hidden !important;
              break-after: avoid !important;
              page-break-after: avoid !important;
            }
            @page {
              size: ${activeBarcodeSize.width}mm ${activeBarcodeSize.height}mm;
              margin: 0;
            }
          }
        `}
      </style>
      {barcodeDialogRow && (
        <div
          id="warehouse-barcode-print-area"
          className="hidden"
          style={{
            width: `${activeBarcodeSize.width}mm`,
            height: `${activeBarcodeSize.height}mm`,
            padding: "2.2mm 2.6mm",
            background: "#fff",
            color: "#111",
            fontFamily: "Arial, system-ui, sans-serif",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", height: "100%", flexDirection: "column", justifyContent: "center", gap: "1.2mm" }}>
            <div style={{ fontSize: activeBarcodeSize.fontSize + 4, fontWeight: 900, lineHeight: 1.02, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {barcodeDialogRow.product_name}
            </div>
            <div
              style={{ width: "100%", height: `${Math.max(9, activeBarcodeSize.height * 0.42)}mm` }}
              dangerouslySetInnerHTML={{ __html: toCode128BarcodeSvg(activeBarcodeValue, activeBarcodeSize.barcodeHeight) }}
            />
            <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: Math.max(9, activeBarcodeSize.fontSize + 1), fontWeight: 800, letterSpacing: ".3px", textAlign: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {activeBarcodeValue}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "2mm", fontSize: Math.max(7, activeBarcodeSize.fontSize - 2), color: "#333", whiteSpace: "nowrap" }}>
              <span>{barcodeDialogRow.variant_name || "Default"}</span>
              <span>{barcodeDialogRow.location_code || "UNASSIGNED"}</span>
            </div>
          </div>
        </div>
      )}
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

            <DashboardSection title="Warehouse Products" icon={<PackageCheck className="h-4 w-4" />}>
              <Kpi icon={<ClipboardList className="h-4 w-4" />} label="Pending Receiving" value={dashboardStats.pendingReceiving} tone="amber" />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Received Products" value={dashboardStats.received} tone="emerald" />
              <Kpi icon={<Boxes className="h-4 w-4" />} label="Good Qty Received" value={dashboardStats.goodQtyReceived} tone="blue" />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Damaged Qty" value={dashboardStats.damagedQtyReceived} tone="red" />
              <Kpi icon={<Package className="h-4 w-4" />} label="Missing Qty" value={dashboardStats.missingQty} tone="slate" />
            </DashboardSection>

            <DashboardSection title="Order Workflow" icon={<Truck className="h-4 w-4" />}>
              <Kpi icon={<Printer className="h-4 w-4" />} label="Not Printed" value={dashboardStats.notPrintedOrders} tone="amber" />
              <Kpi icon={<Truck className="h-4 w-4" />} label="Ready Dispatch" value={dashboardStats.readyToDispatchOrders} tone="blue" />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Dispatched" value={dashboardStats.dispatchedOrders} tone="emerald" />
              <Kpi icon={<PackageCheck className="h-4 w-4" />} label="Shipped" value={dashboardStats.shippedOrders} tone="violet" />
              <Kpi icon={<ScanLine className="h-4 w-4" />} label="Scan Success" value={dashboardStats.dispatchSuccessRate} suffix="%" tone="slate" />
            </DashboardSection>

            <DashboardSection title="Product Inventory KPIs" icon={<Boxes className="h-4 w-4" />}>
              <Kpi icon={<Package className="h-4 w-4" />} label="Products in Stock" value={dashboardStats.productCount} tone="blue" />
              <Kpi icon={<Boxes className="h-4 w-4" />} label="Available Stock" value={dashboardStats.totalAvailableStock} tone="emerald" />
              <Kpi icon={<Layers className="h-4 w-4" />} label="Variants in Stock" value={dashboardStats.variantsInStock} tone="violet" />
              <Kpi icon={<Truck className="h-4 w-4" />} label="Products Dispatched" value={dashboardStats.productsWithDispatched} tone="amber" />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Products Damaged" value={dashboardStats.productsWithDamage} tone="red" />
            </DashboardSection>

            <Card className="border-border/60 overflow-hidden">
              <CardHeader className="py-4 border-b bg-muted/20">
                <div className="flex items-center justify-between gap-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Boxes className="h-4 w-4" />
                    Product Inventory Detail
                  </CardTitle>
                  <Badge variant="outline" className="text-[10px]">{dashboardProductRows.length} products</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Product</TableHead>
                      {!hideSellerInfo && <TableHead className="h-9 text-xs">Seller</TableHead>}
                      <TableHead className="h-9 text-xs text-right">Available</TableHead>
                      <TableHead className="h-9 text-xs text-right">Dispatched</TableHead>
                      <TableHead className="h-9 text-xs text-right">Reserved</TableHead>
                      <TableHead className="h-9 text-xs text-right">Damaged</TableHead>
                      <TableHead className="h-9 text-xs">Variants</TableHead>
                      <TableHead className="h-9 text-xs">Location</TableHead>
                      <TableHead className="h-9 text-xs">Last Move</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dashboardProductRows.length === 0 ? (
                      <TableRow><TableCell colSpan={hideSellerInfo ? 8 : 9} className="text-sm text-muted-foreground">No warehouse product stock yet.</TableCell></TableRow>
                    ) : dashboardProductRows.slice(0, 12).map((row) => (
                      <TableRow key={row.key}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {row.imageUrl ? (
                              <button type="button" onClick={() => setPreviewImage({ url: row.imageUrl!, title: row.productName })} className="h-9 w-9 overflow-hidden rounded-md border bg-muted">
                                <img src={row.imageUrl} alt={row.productName} className="h-full w-full object-cover" loading="lazy" />
                              </button>
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-md border bg-muted text-muted-foreground"><Package className="h-4 w-4" /></div>
                            )}
                            <span className="text-sm font-semibold">{row.productName}</span>
                          </div>
                        </TableCell>
                        {!hideSellerInfo && <TableCell className="text-xs text-muted-foreground">{sellerName(profileMap, row.sellerId)}</TableCell>}
                        <TableCell className="text-right font-bold text-emerald-600">{row.available.toLocaleString()}</TableCell>
                        <TableCell className="text-right font-semibold text-primary">{row.dispatched.toLocaleString()}</TableCell>
                        <TableCell className="text-right">{row.reserved.toLocaleString()}</TableCell>
                        <TableCell className={`text-right font-semibold ${row.damaged > 0 ? "text-destructive" : "text-muted-foreground"}`}>{row.damaged.toLocaleString()}</TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{row.variants} variant{row.variants === 1 ? "" : "s"}</Badge></TableCell>
                        <TableCell><Badge variant="outline" className="text-[10px]">{row.locations.length > 1 ? "MULTIPLE" : row.locations[0] || "UNASSIGNED"}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{format(new Date(row.latest), "MMM d, HH:mm")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <DashboardSection title="Returns & Control" icon={<Settings2 className="h-4 w-4" />}>
              <Kpi icon={<RotateCcw className="h-4 w-4" />} label="Returns Received" value={dashboardStats.returnsReceived} tone="violet" />
              <Kpi icon={<CheckCircle2 className="h-4 w-4" />} label="Sellable Returns" value={dashboardStats.sellableReturns} tone="emerald" />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Duplicate Scans" value={dashboardStats.duplicateScanAttempts} tone="amber" />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Unknown Scans" value={dashboardStats.unknownScanAttempts} tone="red" />
              <Kpi icon={<Settings2 className="h-4 w-4" />} label="Stock Adjustments" value={dashboardStats.manualStockAdjustments} tone="slate" />
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
                        <div className="font-mono text-xs font-semibold">{buildInternalSku(row)}</div>
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
                    <TableHead className="h-9 text-xs">Variants</TableHead>
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
                  ) : groupedInventory.length === 0 ? (
                    <TableRow><TableCell colSpan={hideSellerInfo ? 11 : 12} className="text-sm text-muted-foreground">No inventory balances found.</TableCell></TableRow>
                  ) : groupedInventory.map((group) => {
                    const expanded = expandedInventoryProducts.has(group.key);
                    const primary = group.variants[0];
                    const locationLabel = group.locations.length === 0
                      ? "UNASSIGNED"
                      : group.locations.length === 1
                        ? group.locations[0]
                        : "MULTIPLE";
                    return (
                      <Fragment key={group.key}>
                        <TableRow key={group.key} className="bg-muted/20 hover:bg-muted/35">
                          {!hideSellerInfo && <TableCell className="text-sm">{sellerName(profileMap, group.sellerId)}</TableCell>}
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => toggleInventoryProduct(group.key)}
                              className="flex items-center gap-2 text-left"
                            >
                              {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                              {group.imageUrl ? (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setPreviewImage({ url: group.imageUrl!, title: group.productName });
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      setPreviewImage({ url: group.imageUrl!, title: group.productName });
                                    }
                                  }}
                                  className="h-9 w-9 shrink-0 overflow-hidden rounded-md border bg-muted"
                                  title="View product image"
                                >
                                  <img src={group.imageUrl} alt={group.productName} className="h-full w-full object-cover" loading="lazy" />
                                </span>
                              ) : (
                                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground">
                                  <Package className="h-4 w-4" />
                                </span>
                              )}
                              <span className="text-sm font-semibold">{group.productName}</span>
                            </button>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{group.variants.length} variant{group.variants.length === 1 ? "" : "s"}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{primary?.sku?.split("-").slice(0, 2).join("-") || "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">Expand to print</TableCell>
                          <TableCell className="text-right font-semibold">{group.available}</TableCell>
                          <TableCell className="text-right">{group.reserved}</TableCell>
                          <TableCell className="text-right">
                            <span className={`font-semibold tabular-nums ${group.dispatched ? "text-primary" : "text-muted-foreground"}`}>{group.dispatched}</span>
                          </TableCell>
                          <TableCell className="text-right">{group.damaged}</TableCell>
                          <TableCell><Badge variant="outline" className="text-[10px]">{locationLabel}</Badge></TableCell>
                          <TableCell className="text-xs text-muted-foreground">{format(new Date(group.latest), "MMM d, HH:mm")}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() => {
                                  if (group.variants.length === 1 && primary) {
                                    setBarcodeDialogRow(primary);
                                  } else if (!expanded) {
                                    toggleInventoryProduct(group.key);
                                  }
                                }}
                                title={group.variants.length === 1 ? "Print barcode" : "Expand variants to print barcode"}
                              >
                                <Barcode className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" onClick={() => toggleInventoryProduct(group.key)}>
                                {expanded ? "Hide" : "View"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expanded && group.variants.map((row) => (
                          <TableRow key={row.id} className="bg-background">
                            {!hideSellerInfo && <TableCell />}
                            <TableCell className="pl-9 text-xs text-muted-foreground">{row.product_name}</TableCell>
                            <TableCell className="text-sm font-medium">{row.variant_name || "Default"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.sku || "-"}</TableCell>
                            <TableCell className="font-mono text-xs">{row.sku || row.product_variant_id.slice(0, 10)}</TableCell>
                            <TableCell className="text-right font-semibold">{row.available_quantity ?? row.quantity_on_hand}</TableCell>
                            <TableCell className="text-right">{row.quantity_reserved}</TableCell>
                            <TableCell className="text-right">
                              <span className={`font-semibold tabular-nums ${dispatchedByVariant.get(row.product_variant_id) ? "text-primary" : "text-muted-foreground"}`}>
                                {dispatchedByVariant.get(row.product_variant_id) || 0}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">{row.damaged_quantity ?? 0}</TableCell>
                            <TableCell><Badge variant="outline" className="text-[10px]">{row.location_code || "UNASSIGNED"}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground">{format(new Date(row.updated_at), "MMM d, HH:mm")}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setBarcodeDialogRow(row)} title="Print barcode"><Barcode className="h-3.5 w-3.5" /></Button>
                                {canAdjustStock && <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setAdjustDialogRow(row)}><Settings2 className="h-3.5 w-3.5" /></Button>}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </Fragment>
                    );
                  })}
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
                  <DispatchTable rows={filteredReady} loading={loadingReady} showReadyAt />
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
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi icon={<ScanLine className="h-4 w-4" />} label="Scanned Returned" value={returnStats.scannedReturned} tone="blue" />
              <Kpi icon={<RotateCcw className="h-4 w-4" />} label="Returned Not Received" value={returnStats.pendingWarehouseScan} tone="amber" />
              <Kpi icon={<AlertCircle className="h-4 w-4" />} label="Damaged Orders" value={returnStats.damagedOrders} tone="red" />
              <Kpi icon={<Package className="h-4 w-4" />} label="Missing Items" value={returnStats.missingItems} tone="violet" />
            </div>

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

            <Card className="border-amber-500/20">
              <CardHeader className="py-4">
                <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-600" /> Returned Orders Waiting Warehouse Scan</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Order</TableHead>
                      <TableHead className="h-9 text-xs">Tracking</TableHead>
                      <TableHead className="h-9 text-xs">Customer</TableHead>
                      <TableHead className="h-9 text-xs">Product</TableHead>
                      <TableHead className="h-9 text-xs">Courier</TableHead>
                      <TableHead className="h-9 text-xs">Returned At</TableHead>
                      <TableHead className="h-9 text-xs">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingReturnedOrders ? (
                      <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading returned orders...</TableCell></TableRow>
                    ) : pendingReturnOrders.length === 0 ? (
                      <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No returned parcels waiting for warehouse scan.</TableCell></TableRow>
                    ) : pendingReturnOrders.slice(0, 80).map((order) => {
                      const shipment = order.shipments?.[0];
                      const productSummary = (order.order_items || []).map((item) => item.product_name || "Product").join(", ");
                      return (
                        <TableRow key={order.id}>
                          <TableCell className="font-mono text-xs font-semibold">{order.order_id}</TableCell>
                          <TableCell className="font-mono text-xs">{shipment?.tracking_number || "-"}</TableCell>
                          <TableCell className="text-xs">
                            <div className="font-medium">{order.customer_name}</div>
                            <div className="text-muted-foreground">{order.customer_city || "-"}</div>
                          </TableCell>
                          <TableCell className="text-xs max-w-[280px] truncate">{productSummary || "-"}</TableCell>
                          <TableCell className="text-xs">{shipment?.carriers?.name || "-"}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{format(new Date(order.updated_at), "MMM d, HH:mm")}</TableCell>
                          <TableCell><StatusBadge value={order.delivery_status || "returned"} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      <Dialog open={!!barcodeDialogRow} onOpenChange={(open) => !open && setBarcodeDialogRow(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Barcode className="h-4 w-4" />
              Print Barcode
            </DialogTitle>
          </DialogHeader>
          {barcodeDialogRow && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="text-sm font-semibold">{barcodeDialogRow.product_name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-mono text-foreground">{barcodeDialogRow.sku || barcodeDialogRow.product_variant_id}</span>
                  <Badge variant="outline" className="text-[10px]">{barcodeDialogRow.location_code || "UNASSIGNED"}</Badge>
                </div>
                <div
                  className="mt-3 h-14 rounded border bg-white p-2"
                  dangerouslySetInnerHTML={{ __html: toCode128BarcodeSvg(barcodeDialogRow.sku || barcodeDialogRow.product_variant_id, 48) }}
                />
              </div>
              <div className="grid gap-2">
                {(Object.keys(barcodeLabelSizes) as BarcodeLabelSize[]).map((sizeKey) => {
                  const size = barcodeLabelSizes[sizeKey];
                  return (
                    <Button
                      key={sizeKey}
                      type="button"
                      variant="outline"
                      className="h-auto justify-between rounded-md px-3 py-3 text-left"
                      onClick={() => printBarcode(barcodeDialogRow, sizeKey)}
                    >
                      <span>
                        <span className="block text-sm font-semibold">{size.label}</span>
                        <span className="block text-xs text-muted-foreground">{size.description} · print now</span>
                      </span>
                      <Printer className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  );
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBarcodeDialogRow(null)}>Cancel</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{previewImage?.title || "Product image"}</DialogTitle></DialogHeader>
          {previewImage && (
            <div className="overflow-hidden rounded-lg border bg-muted">
              <img src={previewImage.url} alt={previewImage.title} className="max-h-[70vh] w-full object-contain" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!receiveDialogRow} onOpenChange={(open) => {
        if (!open) {
          setReceiveDialogRow(null);
          setReceiveLines([]);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Receive Sourcing Products</DialogTitle></DialogHeader>
          {receiveDialogRow && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-sm">
                {!hideSellerInfo && <InfoLine label="Seller" value={sellerName(profileMap, receiveDialogRow.seller_id)} />}
                <InfoLine label="Product" value={receiveDialogRow.product_name} />
                <InfoLine label="Expected" value={String(receiveTotals.expected)} />
                <InfoLine label="Status" value={receiveDialogRow.status} />
              </div>
              <div className="rounded-md border border-primary/20 bg-primary/[0.03] p-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-primary">
                  <Barcode className="h-3.5 w-3.5" />
                  Auto-generated product barcode
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <InfoLine label="Internal SKU" value={buildInternalSku(receiveDialogRow)} />
                  <InfoLine label="Barcode" value={buildInternalSku(receiveDialogRow)} />
                </div>
              </div>
              <div className="rounded-md border overflow-hidden">
                <div className="grid grid-cols-[minmax(180px,1fr)_110px_130px_130px_130px] gap-3 border-b bg-muted/30 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span>Variant</span>
                  <span className="text-right">Expected</span>
                  <span>Received</span>
                  <span>Good</span>
                  <span>Damaged</span>
                </div>
                <div className="divide-y">
                  {receiveLines.map((line) => (
                    <div key={line.key} className="grid grid-cols-[minmax(180px,1fr)_110px_130px_130px_130px] gap-3 px-3 py-3 items-center">
                      <div>
                        <p className="text-sm font-medium text-foreground">{line.label}</p>
                        {line.key !== "default" && (
                          <p className="text-[11px] text-muted-foreground">SKU: {buildInternalSku(receiveDialogRow)}-{skuSuffix(line.label, line.key.toUpperCase())}</p>
                        )}
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums">{line.expectedQuantity}</div>
                      <Input
                        type="number"
                        min={0}
                        value={line.receivedQuantity}
                        onChange={(e) => {
                          const received = Number(e.target.value || 0);
                          updateReceiveLine(line.key, {
                            receivedQuantity: received,
                            goodQuantity: Math.max(0, received - Number(line.damagedQuantity || 0)),
                          });
                        }}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={line.goodQuantity}
                        onChange={(e) => updateReceiveLine(line.key, { goodQuantity: Number(e.target.value || 0) })}
                      />
                      <Input
                        type="number"
                        min={0}
                        value={line.damagedQuantity}
                        onChange={(e) => {
                          const damaged = Number(e.target.value || 0);
                          updateReceiveLine(line.key, {
                            damagedQuantity: damaged,
                            goodQuantity: Math.max(0, Number(line.receivedQuantity || 0) - damaged),
                          });
                        }}
                      />
                    </div>
                  ))}
                </div>
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
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-md bg-muted/40 p-3 text-xs text-muted-foreground">
                <span>Expected: <span className="font-semibold text-foreground">{receiveTotals.expected}</span></span>
                <span>Received: <span className="font-semibold text-foreground">{receiveTotals.received}</span></span>
                <span>Good: <span className="font-semibold text-foreground">{receiveTotals.good}</span></span>
                <span>Missing: <span className="font-semibold text-foreground">{receiveMissing}</span></span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReceiveDialogRow(null); setReceiveLines([]); }} disabled={busy}>Cancel</Button>
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

function Kpi({ icon, label, value, suffix = "", tone = "slate" }: { icon: React.ReactNode; label: string; value: number; suffix?: string; tone?: "slate" | "blue" | "emerald" | "amber" | "red" | "violet" }) {
  const toneClass = {
    slate: "border-slate-500/15 bg-slate-500/[0.04] text-slate-600",
    blue: "border-blue-500/20 bg-blue-500/[0.06] text-blue-600",
    emerald: "border-emerald-500/20 bg-emerald-500/[0.07] text-emerald-600",
    amber: "border-amber-500/25 bg-amber-500/[0.08] text-amber-600",
    red: "border-red-500/20 bg-red-500/[0.06] text-red-600",
    violet: "border-violet-500/20 bg-violet-500/[0.06] text-violet-600",
  }[tone];
  return (
    <Card className={`border ${toneClass}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background/70 shadow-sm">{icon}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
        </div>
        <p className="text-2xl font-bold tabular-nums text-foreground">{value.toLocaleString()}{suffix}</p>
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
  showReadyAt = false,
}: {
  rows: FulfillmentRow[];
  loading: boolean;
  selectedIds?: Set<string>;
  allSelected?: boolean;
  onToggleAll?: () => void;
  onToggleRow?: (id: string) => void;
  selectable?: boolean;
  showReadyAt?: boolean;
}) {
  const columnCount = (selectable ? 7 : 6) + (showReadyAt ? 1 : 0);
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
          {showReadyAt && <TableHead className="h-9 text-xs">Ready at</TableHead>}
          <TableHead className="h-9 text-xs">Stage</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow><TableCell colSpan={columnCount} className="text-sm text-muted-foreground">Loading orders...</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={columnCount} className="text-sm text-muted-foreground">No orders in this view.</TableCell></TableRow>
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
            {showReadyAt && (
              <TableCell>
                <div className="text-xs font-medium">{format(new Date(row.updated_at), "MMM d, yyyy")}</div>
                <div className="text-[11px] text-muted-foreground">{format(new Date(row.updated_at), "HH:mm")}</div>
              </TableCell>
            )}
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
