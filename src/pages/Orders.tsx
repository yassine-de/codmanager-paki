import { useState, useMemo, useCallback, useEffect } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { eachDayOfInterval, isAfter } from "date-fns";
import { startOfDayPKT as startOfDay, endOfDayPKT, subDaysPKT as subDays, formatPKT as fmtDate } from "@/lib/timezone";
import { Search, SlidersHorizontal, X, Columns3, CalendarIcon, Filter, Pencil, History, MessageCircle, Download, RefreshCw, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown, Copy, Check, PackageCheck } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useDataVisibility, MaskedValue } from "@/contexts/DataVisibilityContext";
import OrderHistoryModal from "@/components/OrderHistoryModal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { type ConfirmationStatus, type DeliveryStatus, type Order } from "@/lib/data";
import { formatPKT as format } from "@/lib/timezone";
import { isOrderIdSearch, normalizeOrderIdSearch } from "@/lib/search";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import EditOrderModal from "@/components/EditOrderModal";
import CreateOrderModal from "@/components/CreateOrderModal";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import CarrierTrackingModal from "@/components/CarrierTrackingModal";
import { FinancialIndicators } from "@/components/FinancialIndicators";

/* ── Status badge configs ── */
const confirmationConfig: Record<ConfirmationStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  new_wts: { label: 'New WTS', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  confirmed: { label: 'Confirmed', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  no_answer: { label: 'No Answer', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  unreachable: { label: 'Unreachable', cls: 'bg-[hsl(0,0%,45%)]/12 text-[hsl(0,0%,45%)] border-[hsl(0,0%,45%)]/20' },
  postponed: { label: 'Postponed', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
  cancelled: { label: 'Cancelled', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  wrong_number: { label: 'Wrong Number', cls: 'bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/20' },
  double: { label: 'Double', cls: 'bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/20' },
};

/* WhatsApp confirmation sub-status (shown when confirmation_status = 'new_wts') */
const whatsappStatusConfig: Record<string, { label: string; cls: string }> = {
  pending:                { label: 'New WTS · Open',           cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  sent:                   { label: 'New WTS · Awaiting Reply', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  awaiting_reply:         { label: 'New WTS · Awaiting Reply', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  confirmed:              { label: 'New WTS · Confirmed',      cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  canceled:               { label: 'New WTS · Canceled',       cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  cancelled:              { label: 'New WTS · Canceled',       cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  more_info:              { label: 'New WTS · Sent to Agent',  cls: 'bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/20' },
  manual_review_needed:   { label: 'New WTS · Needs Review',   cls: 'bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20' },
};

const deliveryConfig: Record<DeliveryStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/20' },
  booked: { label: 'Booked', cls: 'bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20' },
  printed: { label: 'Printed', cls: 'bg-[hsl(205,65%,48%)]/12 text-[hsl(205,65%,48%)] border-[hsl(205,65%,48%)]/20' },
  dispatched: { label: 'Dispatched', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  shipped: { label: 'Shipped', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  in_transit: { label: 'In Transit', cls: 'bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/20' },
  with_courier: { label: 'With Courier', cls: 'bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/20' },
  delivered: { label: 'Delivered', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  returned: { label: 'Returned', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  cancelled: { label: 'Cancelled', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  no_answer: { label: 'No Answer', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  postponed: { label: 'Postponed', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
  failed: { label: 'Failed', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
  failed_attempt: { label: 'Failed Attempt', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
  ready_for_return: { label: 'Ready for Return', cls: 'bg-[hsl(15,75%,55%)]/12 text-[hsl(15,75%,55%)] border-[hsl(15,75%,55%)]/20' },
  rejected: { label: 'Rejected', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  return: { label: 'Return', cls: 'bg-[hsl(340,65%,52%)]/12 text-[hsl(340,65%,52%)] border-[hsl(340,65%,52%)]/20' },
  return_received: { label: 'Return Received', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  out_of_stock: { label: 'Out of Stock', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
};

// Pretty label for carrier sub-status (kept verbatim from carrier API)
const subStatusLabel = (raw?: string | null) => {
  if (!raw) return null;
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
};

const subStatusClass = (raw?: string | null): string => {
  if (!raw) return 'bg-muted text-muted-foreground border-border';
  const s = raw.toLowerCase().trim();
  if (s === 'delivered') return 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20';
  if (s === 'cancelled' || s === 'refused to accept') return 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20';
  if (s === 'failed attempt') return 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20';
  if (s === 'ready for return' || s.startsWith('return')) return 'bg-[hsl(340,65%,52%)]/12 text-[hsl(340,65%,52%)] border-[hsl(340,65%,52%)]/20';
  if (s === 'new') return 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20';
  // All in-flight courier states
  return 'bg-[hsl(200,65%,50%)]/12 text-[hsl(200,65%,50%)] border-[hsl(200,65%,50%)]/20';
};

const shippedDeliveryStatuses: DeliveryStatus[] = ["printed", "dispatched", "shipped", "in_transit", "with_courier"];

function StatusBadge({ label, cls, attemptCount }: { label: string; cls: string; attemptCount?: number }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}>
      {label}
      {attemptCount && attemptCount > 0 && (
        <span className="text-[10px] opacity-70">×{attemptCount}</span>
      )}
    </span>
  );
}

function mapOrderProducts(row: any): Order["products"] {
  const items = Array.isArray(row.order_items) ? row.order_items : [];
  if (items.length > 0) {
    return items.map((item: any) => ({
      id: item.id,
      productId: item.product_id || null,
      productVariantId: item.product_variant_id || null,
      sku: item.sku || null,
      variantName: item.variant_name || null,
      name: item.product_name || item.sku || "Product",
      qty: Number(item.quantity || 1),
      price: Number(item.unit_price || 0),
    }));
  }

  return [{ name: row.product_name, qty: row.quantity, price: Number(row.price) }];
}

/* ── Column definitions ── */
type ColumnKey = 'systemId' | 'id' | 'carrierId' | 'createdAt' | 'updatedAt' | 'seller' | 'customer' | 'city' | 'phone' | 'product' | 'amount' | 'confirmationStatus' | 'channel' | 'deliveryStatus' | 'subStatus' | 'attempts' | 'financial';

const allColumns: { key: ColumnKey; label: string; defaultVisible: boolean; adminOnly?: boolean }[] = [
  { key: 'systemId', label: 'System ID', defaultVisible: true, adminOnly: true },
  { key: 'id', label: 'Order ID', defaultVisible: true },
  { key: 'carrierId', label: 'Carrier ID', defaultVisible: true, adminOnly: true },
  { key: 'createdAt', label: 'Created', defaultVisible: true },
  { key: 'updatedAt', label: 'Updated', defaultVisible: true },
  { key: 'customer', label: 'Client', defaultVisible: true },
  { key: 'city', label: 'City', defaultVisible: true },
  { key: 'phone', label: 'Phone', defaultVisible: true },
  { key: 'product', label: 'Product', defaultVisible: true },
  { key: 'amount', label: 'Amount', defaultVisible: true },
  { key: 'confirmationStatus', label: 'Confirmation', defaultVisible: true },
  { key: 'channel', label: 'Channel', defaultVisible: true, adminOnly: true },
  { key: 'attempts', label: 'Attempts', defaultVisible: true },
  { key: 'deliveryStatus', label: 'Delivery', defaultVisible: true },
  { key: 'subStatus', label: 'Sub Status', defaultVisible: true, adminOnly: true },
  { key: 'financial', label: 'Invoice', defaultVisible: true, adminOnly: true },
];

const channelConfig: Record<string, { label: string; cls: string }> = {
  agent: { label: 'Agent', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  whatsapp: { label: 'WhatsApp', cls: 'bg-[hsl(142,71%,45%)]/12 text-[hsl(142,71%,45%)] border-[hsl(142,71%,45%)]/20' },
};

/* ── Sparkline KPI Cards ──
 * Totals/sparkline reflect ALL orders in the database (not just the currently
 * loaded page), so the parent computes them via lightweight aggregate queries
 * and passes the results in — this component only renders them. */
type SparklineTotals = { total: number; shipped: number; delivered: number; returned: number };
type SparklineDay = { d: string; total: number; shipped: number; delivered: number; returned: number };

function OrderSparklineCards({ totals, sparkData }: { totals: SparklineTotals; sparkData: SparklineDay[] }) {
  const { isDataVisible } = useDataVisibility();

  const cards = [
    { title: "Total Orders", value: totals.total, dataKey: "total", color: "hsl(210,60%,52%)" },
    { title: "Delivered Orders", value: totals.delivered, dataKey: "delivered", color: "hsl(155,50%,42%)" },
    { title: "Shipped Orders", value: totals.shipped, dataKey: "shipped", color: "hsl(210,60%,52%)" },
    { title: "Returns", value: totals.returned, dataKey: "returned", color: "hsl(210,60%,52%)" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 animate-fade-in">
      {cards.map((c) => (
        <div key={c.title} className="bg-card rounded-lg border shadow-soft px-3.5 py-2.5 hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200">
          <p className="text-xs text-muted-foreground font-medium">{c.title}</p>
          <div className="flex items-end justify-between mt-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums leading-tight">
                {isDataVisible ? c.value.toLocaleString() : <MaskedValue className="gap-1" />}
              </span>
              {isDataVisible && <span className="text-success text-[10px] font-semibold">↑</span>}
            </div>
            <div className="w-16 h-6">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkData}>
                  <defs>
                    <linearGradient id={`spark-${c.dataKey}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={c.color} stopOpacity={0.3} />
                      <stop offset="100%" stopColor={c.color} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey={c.dataKey} stroke={c.color} strokeWidth={1.5}
                    fill={`url(#spark-${c.dataKey})`} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Orders() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === 'admin';
  const [search, setSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [historyOrder, setHistoryOrder] = useState<Order | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [trackingTarget, setTrackingTarget] = useState<{ carrierId: string; systemId?: number | null; sellerId?: string | null } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // `orders` holds only the currently loaded page (server-side pagination) — never the whole table.
  const [orders, setOrders] = useState<Order[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [sellerOptions, setSellerOptions] = useState<{ id: string; name: string }[]>([]);
  const [agentOptions, setAgentOptions] = useState<{ id: string; name: string }[]>([]);
  const [productNames, setProductNames] = useState<string[]>([]);
  const [subStatusOptions, setSubStatusOptions] = useState<string[]>([]);
  const [courierOptions, setCourierOptions] = useState<{ code: string; name: string }[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());

  const toggleSelectOrder = (orderId: string) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedOrders.size === paginatedOrders.length && paginatedOrders.length > 0) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(paginatedOrders.map(o => o.id)));
    }
  };

  const getSelectedOrderObjects = () => orders.filter(o => selectedOrders.has(o.id));

  const handleDownloadCSV = () => {
    const selected = getSelectedOrderObjects();
    if (selected.length === 0) return;
    const headers = ["Order ID", "Customer Name", "Phone", "Product", "Amount", "Confirmation Status", "Delivery Status"];
    const rows = selected.map(o => [
      o.id,
      o.customer,
      o.phone,
      o.products.map(p => p.name).join(" | "),
      String(o.total),
      (!isAdmin && o.confirmationStatus === 'new_wts') ? 'new' : o.confirmationStatus,
      o.deliveryStatus,
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `orders-export-${format(new Date(), "yyyy-MM-dd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`${selected.length} orders exported`);
  };

  const [bulkConfirm, setBulkConfirm] = useState<{ field: "confirmation_status" | "delivery_status"; value: string; label: string } | null>(null);

  const requestBulkStatusChange = (field: "confirmation_status" | "delivery_status", newValue: string) => {
    const label = field === "confirmation_status"
      ? confirmationConfig[newValue as ConfirmationStatus]?.label || newValue
      : deliveryConfig[newValue as DeliveryStatus]?.label || newValue;
    setBulkConfirm({ field, value: newValue, label });
  };

  const handleBulkStatusChange = async () => {
    if (!bulkConfirm) return;
    const { field, value: newValue } = bulkConfirm;
    const selected = getSelectedOrderObjects();
    if (selected.length === 0) return;
    const orderIds = selected.map(o => o.id);
    
    const { error } = await supabase
      .from("orders")
      .update({ [field]: newValue, updated_at: new Date().toISOString() } as any)
      .in("order_id", orderIds);
    
    if (error) {
      toast.error("Failed to update orders");
      console.error(error);
      setBulkConfirm(null);
      return;
    }

    const bulkGroupId = crypto.randomUUID();
    const historyEntries = selected.map(o => ({
      order_id: o.id,
      changed_by: authUser?.id,
      changed_by_role: authUser?.role || "admin",
      field_changed: field,
      old_value: field === "confirmation_status" ? o.confirmationStatus : o.deliveryStatus,
      new_value: newValue,
      action_type: "status_change",
      group_id: bulkGroupId,
    }));
    await supabase.from("order_history").insert(historyEntries as any);

    toast.success(`${selected.length} orders updated`);
    setSelectedOrders(new Set());
    setBulkConfirm(null);
    setRefreshKey(k => k + 1);
  };

  // Debounce free-text search before it drives a server request, so typing
  // doesn't fire a query per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  // Filters state
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [deliveredDatePreset, setDeliveredDatePreset] = useState<DatePresetValue>("maximum");
  const [deliveredDateRange, setDeliveredDateRange] = useState<DateRange | undefined>();
  const [updatedDatePreset, setUpdatedDatePreset] = useState<DatePresetValue>("maximum");
  const [updatedDateRange, setUpdatedDateRange] = useState<DateRange | undefined>();
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterSeller, setFilterSeller] = useState('all');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterConfirmation, setFilterConfirmation] = useState('all');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterSubStatus, setFilterSubStatus] = useState('all');
  const [filterChannel, setFilterChannel] = useState('all');
  const [filterUpsell, setFilterUpsell] = useState('all');
  const [filterCourier, setFilterCourier] = useState('all');
  
  

  // Read URL params on mount
  useEffect(() => {
    const conf = searchParams.get('confirmation');
    const del = searchParams.get('delivery');
    const searchParam = searchParams.get('search');
    if (conf) {
      setFilterConfirmation(conf);
      setAppliedFilters(prev => ({ ...prev, confirmation: conf }));
      setShowFilters(true);
    }
    if (del) {
      setFilterDelivery(del);
      setAppliedFilters(prev => ({ ...prev, delivery: del }));
      setShowFilters(true);
    }
    if (searchParam) {
      setSearch(searchParam);
    }
    // Clear URL params after reading
    if (conf || del || searchParam) {
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Applied filters (only apply on button click)
  const [appliedFilters, setAppliedFilters] = useState(() => {
    const conf = new URLSearchParams(window.location.search).get('confirmation');
    const del = new URLSearchParams(window.location.search).get('delivery');
    return {
      dateRange: undefined as DateRange | undefined,
      deliveredRange: undefined as DateRange | undefined,
      updatedRange: undefined as DateRange | undefined,
      product: 'all', seller: 'all', agent: 'all',
      confirmation: conf || 'all',
      delivery: del || 'all',
      subStatus: 'all',
      channel: 'all',
      upsell: 'all',
      courier: 'all',
    };
  });

  // Sorting
  type SortableKey = 'systemId' | 'createdAt' | 'updatedAt';
  const [sortKey, setSortKey] = useState<SortableKey>('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (key: SortableKey) => {
    if (sortKey === key) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(allColumns.filter(c => c.defaultVisible).map(c => c.key))
  );

  // Filter dropdown option lists — fetched once (not tied to pagination/search),
  // since they represent the full universe of values, not just the loaded page.
  useEffect(() => {
    let cancelled = false;
    const loadOptions = async () => {
      const { data: prods } = await supabase.from("products").select("name").eq("active", true).order("name");
      if (!cancelled) setProductNames([...new Set((prods || []).map((p: any) => p.name))]);

      if (!isAdmin) return;

      const [{ data: sellerRoles }, { data: agentRoles }] = await Promise.all([
        supabase.from("user_roles").select("user_id").eq("role", "seller"),
        supabase.from("user_roles").select("user_id").eq("role", "agent"),
      ]);
      const sellerIds = (sellerRoles || []).map((r: any) => r.user_id);
      const agentIds = (agentRoles || []).map((r: any) => r.user_id);
      const allIds = [...new Set([...sellerIds, ...agentIds])];

      const { data: allProfiles } = allIds.length > 0
        ? await supabase.from("profiles").select("user_id, name").in("user_id", allIds)
        : { data: [] as any[] };
      const nameOf = (id: string) => (allProfiles || []).find((p: any) => p.user_id === id)?.name || "Unknown";

      if (!cancelled) {
        setSellerOptions(sellerIds.map((id: string) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)));
        setAgentOptions(agentIds.map((id: string) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name)));
      }

      // Bounded sample of the most recent shipments — the carrier-status vocabulary
      // is small and fixed, so this reliably covers every value without scanning
      // the whole shipments table.
      const { data: recentShipments } = await supabase
        .from("shipments" as any)
        .select("carrier_status, normalized_status")
        .order("created_at", { ascending: false })
        .limit(3000);
      const set = new Set<string>();
      (recentShipments || []).forEach((s: any) => {
        const v = s.normalized_status || s.carrier_status;
        if (v) set.add(v);
      });
      if (!cancelled) setSubStatusOptions([...set].sort());

      const { data: carriers } = await supabase
        .from("carriers" as any)
        .select("code, name")
        .order("name", { ascending: true });
      if (!cancelled) setCourierOptions((carriers || []) as { code: string; name: string }[]);
    };
    loadOptions();
    return () => { cancelled = true; };
  }, [isAdmin, refreshKey]);

  // Sparkline / summary KPI cards reflect ALL orders (all-time totals + last 7
  // days), independent of the table's active filters — matches prior behavior,
  // computed via lightweight aggregate queries instead of loading every order.
  const [sparklineData, setSparklineData] = useState<{ totals: SparklineTotals; spark: SparklineDay[] }>({
    totals: { total: 0, shipped: 0, delivered: 0, returned: 0 },
    spark: [],
  });
  useEffect(() => {
    let cancelled = false;
    const loadSparkline = async () => {
      const countWhere = async (build: (q: any) => any) => {
        const { count } = await build(supabase.from("orders").select("*", { count: "exact", head: true }));
        return count || 0;
      };

      const [total, delivered, shipped, returned] = await Promise.all([
        countWhere((q) => q),
        countWhere((q) => q.eq("delivery_status", "delivered")),
        countWhere((q) => q.in("delivery_status", shippedDeliveryStatuses)),
        countWhere((q) => q.in("delivery_status", ["returned", "return", "ready_for_return", "return_received"])),
      ]);

      const rangeStart = startOfDay(subDays(new Date(), 6));
      const { data: recent } = await supabase
        .from("orders")
        .select("created_at, delivery_status")
        .gte("created_at", rangeStart.toISOString());

      const days = eachDayOfInterval({ start: rangeStart, end: startOfDay(new Date()) });
      const spark: SparklineDay[] = days.map((date) => {
        const next = new Date(date); next.setDate(next.getDate() + 1);
        const dayOrders = (recent || []).filter((o: any) => {
          const c = new Date(o.created_at);
          return isAfter(c, date) && !isAfter(c, next);
        });
        return {
          d: fmtDate(date, "dd"),
          total: dayOrders.length,
          shipped: dayOrders.filter((o: any) => shippedDeliveryStatuses.includes(o.delivery_status)).length,
          delivered: dayOrders.filter((o: any) => o.delivery_status === "delivered").length,
          returned: dayOrders.filter((o: any) => ["returned", "return", "ready_for_return", "return_received"].includes(o.delivery_status)).length,
        };
      });

      if (!cancelled) setSparklineData({ totals: { total, delivered, shipped, returned }, spark });
    };
    loadSparkline();
    return () => { cancelled = true; };
  }, [refreshKey]);

  // Fetch orders from database — server-side filtered, sorted and paginated,
  // so only the current page (never the whole table) is transferred.
  useEffect(() => {
    let cancelled = false;

    const fetchOrders = async () => {
      setLoadingOrders(true);
      try {
        const f = appliedFilters;

        // The "Upsell" filter is a legacy field the app never actually populates
        // (every order maps `upsell: false` below), so "Yes" has always matched
        // zero rows. Preserve that exact behavior without hitting the database.
        if (f.upsell === 'yes') {
          if (!cancelled) { setOrders([]); setTotalCount(0); }
          return;
        }

        // Product / carrier-substatus filters need a join the REST client can't
        // express as a plain column filter without also truncating the embedded
        // order_items/shipments arrays used for display. Resolve matching order
        // ids first, then restrict the main (fully-joined) query with `.in()`.
        const idFilterSets: string[][] = [];

        if (f.product !== 'all') {
          const [itemMatches, directMatches] = await Promise.all([
            supabase.from("order_items" as any).select("order_id").eq("product_name", f.product),
            supabase.from("orders").select("id").eq("product_name", f.product),
          ]);
          const ids = new Set<string>();
          (itemMatches.data || []).forEach((r: any) => ids.add(r.order_id));
          (directMatches.data || []).forEach((r: any) => ids.add(r.id));
          idFilterSets.push([...ids]);
        }

        if (isAdmin && f.subStatus !== 'all') {
          const { data } = await supabase
            .from("shipments" as any)
            .select("order_uuid")
            .or(`normalized_status.eq.${f.subStatus},carrier_status.eq.${f.subStatus}`);
          idFilterSets.push([...new Set((data || []).map((r: any) => r.order_uuid))]);
        }

        if (isAdmin && f.courier !== 'all') {
          const { data } = await supabase
            .from("shipments" as any)
            .select("order_uuid, carriers!inner(code)")
            .eq("carriers.code", f.courier);
          idFilterSets.push([...new Set((data || []).map((r: any) => r.order_uuid))]);
        }

        let restrictToIds: string[] | null = null;
        if (idFilterSets.length > 0) {
          restrictToIds = idFilterSets.reduce((acc, ids) => acc.filter((id) => ids.includes(id)));
          if (restrictToIds.length === 0) {
            if (!cancelled) { setOrders([]); setTotalCount(0); }
            return;
          }
        }

        const term = debouncedSearch.trim();
        const isIdSearch = term ? isOrderIdSearch(term) : false;
        // Strip characters that have structural meaning in a PostgREST `.or()`
        // filter string so a stray comma/paren in the search box can't malform it.
        const looseTerm = term && !isIdSearch ? term.replace(/[,()%_]/g, ' ').trim() : '';

        const applyCommonFilters = (query: any) => {
          let q = query;
          if (restrictToIds) q = q.in('id', restrictToIds);
          if (f.dateRange?.from) {
            q = q.gte('created_at', startOfDay(f.dateRange.from).toISOString())
                 .lte('created_at', endOfDayPKT(f.dateRange.to ?? f.dateRange.from).toISOString());
          }
          if (f.deliveredRange?.from) {
            q = q.gte('delivered_at', startOfDay(f.deliveredRange.from).toISOString())
                 .lte('delivered_at', endOfDayPKT(f.deliveredRange.to ?? f.deliveredRange.from).toISOString());
          }
          if (f.updatedRange?.from) {
            q = q.gte('updated_at', startOfDay(f.updatedRange.from).toISOString())
                 .lte('updated_at', endOfDayPKT(f.updatedRange.to ?? f.updatedRange.from).toISOString());
          }
          if (f.seller !== 'all') q = q.eq('seller_id', f.seller);
          if (f.agent !== 'all') {
            q = q.or(`agent_id.eq.${f.agent},and(agent_id.is.null,original_agent_id.eq.${f.agent})`);
          }
          if (f.confirmation !== 'all') {
            // Sellers see WhatsApp orders as plain "New" — match both statuses for them.
            if (!isAdmin && f.confirmation === 'new') q = q.in('confirmation_status', ['new', 'new_wts']);
            else q = q.eq('confirmation_status', f.confirmation);
          }
          if (f.delivery !== 'all') {
            // Orders that haven't shipped yet store delivery_status as NULL, not
            // the literal string "pending" — the UI just displays NULL as
            // "Pending". An exact eq('delivery_status','pending') therefore
            // never matches any row even though those orders are visibly shown
            // as Pending in the unfiltered list.
            q = f.delivery === 'pending' ? q.is('delivery_status', null) : q.eq('delivery_status', f.delivery);
          }
          if (f.channel !== 'all') {
            q = f.channel === 'agent'
              ? q.or('confirmation_channel.eq.agent,confirmation_channel.is.null')
              : q.eq('confirmation_channel', f.channel);
          }
          if (isIdSearch) {
            q = q.ilike('order_id', normalizeOrderIdSearch(term));
          } else if (looseTerm) {
            q = q.or(`order_id.ilike.%${looseTerm}%,customer_name.ilike.%${looseTerm}%,customer_phone.ilike.%${looseTerm}%,customer_city.ilike.%${looseTerm}%`);
          }
          return q;
        };

        // Exact total count matching every active filter.
        const { count, error: countError } = await applyCommonFilters(
          supabase.from("orders").select("*", { count: "exact", head: true })
        );
        if (countError) {
          console.error("Error counting orders:", countError);
          return;
        }

        const sortColumn = sortKey === 'systemId' ? 'system_id' : sortKey === 'updatedAt' ? 'updated_at' : 'created_at';
        const ascending = sortDir === 'asc';
        const rangeFrom = (currentPage - 1) * pageSize;

        const { data, error } = await applyCommonFilters(
          supabase
            .from("orders")
            .select("*, order_items(id, product_id, product_variant_id, sku, product_name, variant_name, quantity, unit_price, created_at), shipments(id, carrier_order_id, tracking_number, carrier_status, normalized_status, created_at, carriers(code, name))")
        )
          .order(sortColumn, { ascending })
          .order('id', { ascending })
          .range(rangeFrom, rangeFrom + pageSize - 1);

        if (error) {
          console.error("Error fetching orders:", error);
          return;
        }

        const rows = data || [];

        // Enrich only the current page — seller/agent names & invoice status.
        const sellerIds = [...new Set(rows.map((o: any) => o.seller_id))];
        const agentIdsSet = new Set<string>();
        rows.forEach((o: any) => {
          if (o.agent_id) agentIdsSet.add(o.agent_id);
          if (o.original_agent_id) agentIdsSet.add(o.original_agent_id);
        });
        const allUserIds = [...new Set([...sellerIds, ...agentIdsSet])];

        const { data: profiles } = allUserIds.length > 0
          ? await supabase.from("profiles").select("user_id, name").in("user_id", allUserIds as string[])
          : { data: [] as any[] };
        const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p.name]));

        const invoiceIds = [...new Set(rows.map((o: any) => o.invoice_id).filter(Boolean))];
        const invoiceMap = new Map<string, { status: string; finalized_at: string | null }>();
        if (invoiceIds.length > 0) {
          const { data: invoices } = await supabase
            .from("invoices")
            .select("id, status, finalized_at")
            .in("id", invoiceIds as string[]);
          (invoices || []).forEach((inv: any) => invoiceMap.set(inv.id, { status: inv.status, finalized_at: inv.finalized_at || null }));
        }

        const mapped: Order[] = rows.map((o: any) => {
          const latestShipment = [...((o as any).shipments || [])].sort((a: any, b: any) =>
            String(b.created_at || "").localeCompare(String(a.created_at || ""))
          )[0];
          return {
            id: o.order_id,
            dbId: o.id,
            systemId: o.system_id || undefined,
            customer: o.customer_name,
            phone: o.customer_phone,
            city: o.customer_city,
            address: o.customer_address || "",
            products: mapOrderProducts(o),
            total: Number(o.total_amount),
            paidAmount: 0,
            status: (o.confirmation_status === "confirmed" ? o.delivery_status : o.confirmation_status) as any,
            confirmationStatus: o.confirmation_status as ConfirmationStatus,
            deliveryStatus: (o.delivery_status || "pending") as DeliveryStatus,
            createdAt: o.created_at,
            updatedAt: o.updated_at,
            confirmedAt: o.confirmed_at || undefined,
            deliveredAt: o.delivered_at || undefined,
            notes: o.note || undefined,
            seller: profileMap.get(o.seller_id) || "Unknown",
            sellerId: o.seller_id || undefined,
            agentName: o.agent_id ? (profileMap.get(o.agent_id) || undefined) : (o.original_agent_id ? (profileMap.get(o.original_agent_id) || undefined) : undefined),
            upsell: false,
            warehouseState: "in_stock" as const,
            history: [],
            attemptCount: o.attempt_count || 0,
            carrierOrderId: latestShipment?.carrier_order_id || null,
            carrierShippingStatus: latestShipment?.carrier_status || latestShipment?.normalized_status || null,
            trackingNumber: latestShipment?.tracking_number || null,
            carrierName: latestShipment?.carriers?.name || null,
            confirmationChannel: o.confirmation_channel || 'agent',
            whatsappStatus: o.whatsapp_status || null,
            invoiceId: o.invoice_id || null,
            invoiceStatus: o.invoice_id ? (invoiceMap.get(o.invoice_id)?.status || null) : null,
            invoiceFinalizedAt: o.invoice_id ? (invoiceMap.get(o.invoice_id)?.finalized_at || null) : null,
          };
        });

        if (!cancelled) {
          setOrders(mapped);
          setTotalCount(count || 0);
        }
      } finally {
        if (!cancelled) setLoadingOrders(false);
      }
    };

    fetchOrders();
    return () => { cancelled = true; };
  }, [debouncedSearch, appliedFilters, sortKey, sortDir, currentPage, pageSize, refreshKey, isAdmin]);

  const applyFilters = useCallback(() => {
    setAppliedFilters({
      dateRange, deliveredRange: deliveredDateRange, updatedRange: updatedDateRange,
      product: filterProduct, seller: filterSeller, agent: filterAgent,
      confirmation: filterConfirmation, delivery: filterDelivery,
      subStatus: filterSubStatus,
      channel: filterChannel,
      upsell: filterUpsell,
      courier: filterCourier,
    });
  }, [dateRange, deliveredDateRange, updatedDateRange, filterProduct, filterSeller, filterAgent, filterConfirmation, filterDelivery, filterSubStatus, filterChannel, filterUpsell, filterCourier]);

  const clearFilters = useCallback(() => {
    setDateRange(undefined);
    setDeliveredDateRange(undefined); setDeliveredDatePreset('maximum');
    setUpdatedDateRange(undefined); setUpdatedDatePreset('maximum');
    setFilterProduct('all'); setFilterSeller('all'); setFilterAgent('all');
    setFilterConfirmation('all'); setFilterDelivery('all');
    setFilterSubStatus('all');
    setFilterChannel('all');
    setFilterUpsell('all');
    setFilterCourier('all');
    setAppliedFilters({
      dateRange: undefined, deliveredRange: undefined, updatedRange: undefined, product: 'all', seller: 'all', agent: 'all',
      confirmation: 'all', delivery: 'all', subStatus: 'all', channel: 'all', upsell: 'all', courier: 'all',
    });
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.dateRange?.from) count++;
    if (appliedFilters.deliveredRange?.from) count++;
    if (appliedFilters.updatedRange?.from) count++;
    if (appliedFilters.product !== 'all') count++;
    if (appliedFilters.seller !== 'all') count++;
    if (appliedFilters.agent !== 'all') count++;
    if (appliedFilters.confirmation !== 'all') count++;
    if (appliedFilters.delivery !== 'all') count++;
    if (appliedFilters.subStatus !== 'all') count++;
    if (appliedFilters.channel !== 'all') count++;
    if (appliedFilters.upsell !== 'all') count++;
    if (appliedFilters.courier !== 'all') count++;
    return count;
  }, [appliedFilters]);

  // Count of orders actually delivered within the selected "Delivered At" range (admin filter).
  const [deliveredInRangeCount, setDeliveredInRangeCount] = useState<number | null>(null);
  useEffect(() => {
    const r = appliedFilters.deliveredRange;
    if (!r?.from) { setDeliveredInRangeCount(null); return; }
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .gte("delivered_at", startOfDay(r.from!).toISOString())
        .lte("delivered_at", endOfDayPKT(r.to ?? r.from!).toISOString());
      if (!cancelled) setDeliveredInRangeCount(count ?? 0);
    })();
    return () => { cancelled = true; };
  }, [appliedFilters.deliveredRange]);

  // Search, filters and sorting are now applied server-side (see the fetch
  // effect above), so `orders` already IS the current page's final result set.
  const paginatedOrders = orders;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  // Reset to page 1 when filters/search/page size change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, appliedFilters, pageSize]);

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isCol = (key: ColumnKey) => visibleColumns.has(key);

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-3 w-full">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-xl font-bold tracking-tight leading-tight">Orders</h1>
          <p className="text-muted-foreground text-xs">Manage all your COD orders</p>
        </div>
        {(isAdmin || authUser?.role === "seller") && (
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5" /> Create Order
          </Button>
        )}
      </div>

      {/* Mini Sparkline KPIs */}
      <OrderSparklineCards totals={sparklineData.totals} sparkData={sparklineData.spark} />

      {/* Search & Filters */}
      <div className="flex items-center justify-end gap-2">
        <div className="relative w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <span className="ml-0.5 bg-primary-foreground/20 text-primary-foreground rounded-full px-1.5 text-[10px] font-bold">
              {activeFilterCount}
            </span>
          )}
        </Button>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="bg-card rounded-lg border p-4 animate-fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Date Range */}
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                Date Range
                <span className="text-[10px] font-normal text-muted-foreground/60">(created)</span>
              </label>
              <DatePresetFilter
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                preset={datePreset}
                onPresetChange={setDatePreset}
              />
            </div>
            {/* Delivered At - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <PackageCheck className="h-3.5 w-3.5 text-[hsl(155,50%,42%)]" />
                Delivered At
              </label>
              <DatePresetFilter
                dateRange={deliveredDateRange}
                onDateRangeChange={setDeliveredDateRange}
                preset={deliveredDatePreset}
                onPresetChange={setDeliveredDatePreset}
              />
              {deliveredInRangeCount !== null && (
                <div className="inline-flex items-center gap-1.5 rounded-md bg-[hsl(155,50%,42%)]/10 px-2 py-1 ring-1 ring-inset ring-[hsl(155,50%,42%)]/20">
                  <PackageCheck className="h-3.5 w-3.5 text-[hsl(155,50%,42%)]" />
                  <span className="text-xs font-bold tabular-nums text-[hsl(155,50%,42%)]">
                    {deliveredInRangeCount.toLocaleString()}
                  </span>
                  <span className="text-[11px] font-medium text-[hsl(155,50%,42%)]/80">delivered</span>
                </div>
              )}
            </div>
            )}
            {/* Updated At - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5 text-primary" />
                Updated At
              </label>
              <DatePresetFilter
                dateRange={updatedDateRange}
                onDateRangeChange={setUpdatedDateRange}
                preset={updatedDatePreset}
                onPresetChange={setUpdatedDatePreset}
              />
            </div>
            )}
            {/* Product */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Product</label>
              <SearchableSelect
                value={filterProduct}
                onValueChange={setFilterProduct}
                options={productNames.map(p => ({ value: p, label: p }))}
                placeholder="Product"
                allLabel="All Products"
                className="w-full"
              />
            </div>
            {/* Seller - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Seller</label>
              <SearchableSelect
                value={filterSeller}
                onValueChange={setFilterSeller}
                options={sellerOptions.map(s => ({ value: s.id, label: s.name }))}
                placeholder="Seller"
                allLabel="All Sellers"
                className="w-full"
              />
            </div>
            )}
            {/* Agent - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Agent</label>
              <SearchableSelect
                value={filterAgent}
                onValueChange={setFilterAgent}
                options={agentOptions.map(a => ({ value: a.id, label: a.name }))}
                placeholder="Agent"
                allLabel="All Agents"
                className="w-full"
              />
            </div>
            )}
            {/* Confirmation */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Confirmation</label>
              <SearchableSelect
                value={filterConfirmation}
                onValueChange={setFilterConfirmation}
                options={Object.entries(confirmationConfig)
                  .filter(([k]) => isAdmin || k !== 'new_wts')
                  .map(([k, v]) => ({ value: k, label: v.label }))}
                placeholder="Confirmation"
                allLabel="All"
                className="w-full"
              />
            </div>
            {/* Delivery */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Delivery</label>
              <SearchableSelect
                value={filterDelivery}
                onValueChange={setFilterDelivery}
                options={Object.entries(deliveryConfig)
                  .filter(([k]) => !['failed', 'returned'].includes(k))
                  .map(([k, v]) => ({ value: k, label: v.label }))}
                placeholder="Delivery"
                allLabel="All"
                className="w-full"
              />
            </div>
            {/* Carrier sub status - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Sub Status</label>
              <SearchableSelect
                value={filterSubStatus}
                onValueChange={setFilterSubStatus}
                options={subStatusOptions.map(s => ({ value: s, label: subStatusLabel(s) || s }))}
                placeholder="Sub Status"
                allLabel="All"
                className="w-full"
              />
            </div>
            )}
            {/* Delivery courier - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Courier</label>
              <SearchableSelect
                value={filterCourier}
                onValueChange={setFilterCourier}
                options={courierOptions.map(c => ({ value: c.code, label: c.name }))}
                placeholder="Courier"
                allLabel="All"
                className="w-full"
              />
            </div>
            )}
            {/* Channel - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Channel</label>
              <SearchableSelect
                value={filterChannel}
                onValueChange={setFilterChannel}
                options={[{ value: "agent", label: "Agent" }, { value: "whatsapp", label: "WhatsApp" }]}
                placeholder="Channel"
                allLabel="All"
                className="w-full"
              />
            </div>
            )}
            {/* Upsell */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Upsell</label>
              <SearchableSelect
                value={filterUpsell}
                onValueChange={setFilterUpsell}
                options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                placeholder="Upsell"
                allLabel="All"
                className="w-full"
              />
            </div>
            {/* Buttons */}
            <div className="flex items-end gap-2">
              <Button size="sm" className="h-9 px-4" onClick={applyFilters}>Apply</Button>
              <Button variant="outline" size="sm" className="h-9 px-3" onClick={clearFilters}>Clear</Button>
            </div>
          </div>
        </div>
      )}

      {/* Table Card */}
      <div className="bg-card rounded-xl border shadow-soft animate-slide-up overflow-hidden" style={{ animationDelay: '100ms' }}>
        {/* Table toolbar */}
        {/* Bulk Action Bar */}
        {isAdmin && selectedOrders.size > 0 && (
          <div className="flex items-center gap-3 px-4 py-2.5 border-b bg-primary/5">
            <span className="text-sm font-medium">{selectedOrders.size} selected</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="h-8 gap-1.5 text-xs">
                  Bulk Actions <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={handleDownloadCSV} className="gap-2 text-xs">
                  <Download className="w-3.5 h-3.5" /> Download CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2 text-xs">
                    <RefreshCw className="w-3.5 h-3.5" /> Change Confirmation Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.entries(confirmationConfig).map(([key, cfg]) => (
                      <DropdownMenuItem key={key} onClick={() => requestBulkStatusChange("confirmation_status", key)} className="text-xs">
                        {cfg.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger className="gap-2 text-xs">
                    <RefreshCw className="w-3.5 h-3.5" /> Change Delivery Status
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {Object.entries(deliveryConfig).map(([key, cfg]) => (
                      <DropdownMenuItem key={key} onClick={() => requestBulkStatusChange("delivery_status", key)} className="text-xs">
                        {cfg.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedOrders(new Set())}>
              Clear selection
            </Button>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-2.5 border-b">
          <div className="flex items-center gap-3">
            <p className="text-sm font-medium">
              {totalCount} <span className="text-muted-foreground font-normal">order{totalCount !== 1 ? 's' : ''}</span>
            </p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Show</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                <SelectTrigger className="h-7 w-[70px] text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[10, 50, 100, 300, 500].map(n => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-xs text-muted-foreground">per page</span>
            </div>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                <Columns3 className="w-3.5 h-3.5" />
                Columns
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-2" align="end">
              <div className="space-y-1">
                {allColumns.filter(col => !col.adminOnly || isAdmin).map(col => (
                  <label key={col.key} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer text-sm">
                    <Checkbox
                      checked={visibleColumns.has(col.key)}
                      onCheckedChange={() => toggleColumn(col.key)}
                    />
                    {col.label}
                  </label>
                ))}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Desktop Table */}
        <div className="overflow-x-auto hidden md:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {isAdmin && (
                  <th className="py-3 px-3 w-10">
                    <Checkbox
                      checked={paginatedOrders.length > 0 && selectedOrders.size === paginatedOrders.length}
                      onCheckedChange={toggleSelectAll}
                    />
                  </th>
                )}
                {isAdmin && isCol('systemId') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort('systemId')}>
                  <span className="inline-flex items-center gap-1">System ID {sortKey === 'systemId' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}</span>
                </th>}
                {isCol('id') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Order ID</th>}
                {isAdmin && isCol('carrierId') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Carrier ID</th>}
                {isCol('createdAt') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort('createdAt')}>
                  <span className="inline-flex items-center gap-1">Created {sortKey === 'createdAt' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}</span>
                </th>}
                {isCol('updatedAt') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors" onClick={() => toggleSort('updatedAt')}>
                  <span className="inline-flex items-center gap-1">Updated {sortKey === 'updatedAt' ? (sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}</span>
                </th>}
                {isCol('seller') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Seller</th>}
                {isCol('customer') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Client</th>}
                {isCol('city') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">City</th>}
                {isCol('phone') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Phone</th>}
                {isCol('product') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Product</th>}
                {isCol('amount') && <th className="text-right py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Amount</th>}
                {isCol('confirmationStatus') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Confirmation</th>}
                {isAdmin && isCol('channel') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Channel</th>}
                
                {isCol('deliveryStatus') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Delivery</th>}
                {isAdmin && isCol('subStatus') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Sub Status</th>}
                {isAdmin && isCol('financial') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Invoice</th>}
                <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedOrders.map((order) => (
                <tr
                  key={order.id}
                  className={cn(
                    "border-b last:border-0 hover:bg-muted/40 cursor-pointer transition-colors duration-150",
                    selectedOrders.has(order.id) && "bg-primary/[0.04]"
                  )}
                  onClick={() => navigate(`/orders/${order.id}`)}
                >
                  {isAdmin && (
                    <td className="py-2.5 px-3 w-10" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedOrders.has(order.id)}
                        onCheckedChange={() => toggleSelectOrder(order.id)}
                      />
                    </td>
                  )}
                  {isAdmin && isCol('systemId') && <td className="py-2.5 px-4 font-mono text-xs text-muted-foreground">{order.systemId ?? '—'}</td>}
                  {isCol('id') && (
                    <td className="py-2.5 px-4 font-medium text-xs" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(order.id);
                          setCopiedId(order.id);
                          toast.success("Order ID copied");
                          setTimeout(() => setCopiedId(prev => prev === order.id ? null : prev), 1500);
                        }}
                        className="inline-flex items-center gap-1 hover:text-primary transition-colors group"
                        title="Click to copy"
                      >
                        <span>{order.id}</span>
                        {copiedId === order.id ? (
                          <Check className="w-3 h-3 text-success" />
                        ) : (
                          <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60" />
                        )}
                      </button>
                    </td>
                  )}
                  {isAdmin && isCol('carrierId') && (
                    <td className="py-2.5 px-4 text-xs" onClick={(e) => e.stopPropagation()}>
                      {order.carrierOrderId ? (
                        <div className="space-y-0.5">
                          <button
                            onClick={() => setTrackingTarget({ carrierId: order.carrierOrderId!, systemId: (order as any).systemId ?? null, sellerId: order.id })}
                            className="text-[hsl(210,60%,52%)] hover:underline font-medium"
                          >
                            {order.carrierOrderId}
                          </button>
                          {order.carrierName && (
                            <div className="text-[10px] font-medium text-muted-foreground">{order.carrierName}</div>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {isCol('createdAt') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{format(new Date(order.createdAt), 'dd MMM yyyy HH:mm')}</td>}
                  {isCol('updatedAt') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{format(new Date(order.updatedAt), 'dd MMM yyyy HH:mm')}</td>}
                  {isCol('seller') && <td className="py-2.5 px-4 text-xs">{order.seller}</td>}
                  {isCol('customer') && <td className="py-2.5 px-4 text-xs">{order.customer}</td>}
                  {isCol('city') && <td className="py-2.5 px-4 text-xs text-muted-foreground">{order.city}</td>}
                  {isCol('phone') && (
                    <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums" onClick={(e) => e.stopPropagation()}>
                      {order.phone ? (
                        <button
                          type="button"
                          className="rounded-sm text-left transition hover:text-[hsl(210,60%,52%)] hover:underline underline-offset-2 focus:outline-none focus:ring-2 focus:ring-primary/40"
                          title="Click to copy phone number"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(order.phone)
                              .then(() => toast.success("Phone copied"))
                              .catch(() => toast.error("Could not copy phone"));
                          }}
                        >
                          {order.phone}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                  )}
                  {isCol('product') && <td className="py-2.5 px-4 text-xs text-muted-foreground">{order.products.map(p => p.qty > 1 ? `${p.qty}x ${p.name}` : p.name).join(', ')}</td>}
                  {isCol('amount') && <td className="py-2.5 px-4 text-xs font-medium tabular-nums text-right">{order.total.toLocaleString()} PKR</td>}
{isCol('confirmationStatus') && <td className="py-2.5 px-4">{(() => {
                    const isWhatsapp = (order.confirmationChannel || 'agent') === 'whatsapp';
                    const wts = order.whatsappStatus;
                    // Show WTS sub-status only to admins; sellers see plain "New"
                    if (isAdmin && isWhatsapp && order.confirmationStatus === 'new_wts' && wts) {
                      const cfg = whatsappStatusConfig[wts] || { label: `New WTS · ${wts}`, cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' };
                      return <StatusBadge label={cfg.label} cls={cfg.cls} />;
                    }
                    // For sellers, normalize new_wts -> new
                    const effectiveStatus = (!isAdmin && order.confirmationStatus === 'new_wts')
                      ? 'new' as ConfirmationStatus
                      : order.confirmationStatus;
                    return <StatusBadge {...confirmationConfig[effectiveStatus]} attemptCount={effectiveStatus === 'no_answer' ? order.attemptCount : undefined} />;
                  })()}</td>}
                  {isAdmin && isCol('channel') && <td className="py-2.5 px-4">{(() => { const ch = order.confirmationChannel || 'agent'; const cfg = channelConfig[ch] || { label: ch, cls: 'bg-muted text-muted-foreground border-border' }; return <StatusBadge label={cfg.label} cls={cfg.cls} />; })()}</td>}
                  {isCol('deliveryStatus') && <td className="py-2.5 px-4"><StatusBadge {...deliveryConfig[order.deliveryStatus]} /></td>}
                  {isAdmin && isCol('subStatus') && (
                    <td className="py-2.5 px-4">
                      {order.carrierShippingStatus ? (
                        <StatusBadge label={subStatusLabel(order.carrierShippingStatus)!} cls={subStatusClass(order.carrierShippingStatus)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  
                  {isAdmin && isCol('financial') && (
                    <td className="py-2.5 px-4" onClick={(e) => e.stopPropagation()}>
                      <FinancialIndicators
                        confirmationStatus={order.confirmationStatus}
                        deliveryStatus={order.deliveryStatus}
                        invoiceId={order.invoiceId}
                        invoiceStatus={order.invoiceStatus}
                        invoiceFinalizedAt={order.invoiceFinalizedAt}
                        confirmedAt={order.confirmedAt}
                        deliveredAt={order.deliveredAt}
                        updatedAt={order.updatedAt}
                      />
                    </td>
                  )}
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-1.5">
                      {/* Edit: admin always, seller only when new */}
                      {(isAdmin || order.confirmationStatus === 'new') && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={(e) => { e.stopPropagation(); setEditOrder(order); }}
                              className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(30,90%,55%)]/10 text-[hsl(30,90%,55%)] hover:bg-[hsl(30,90%,55%)]/20 transition-colors active:scale-95"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top"><p className="text-xs">Edit Order</p></TooltipContent>
                        </Tooltip>
                      )}
                      {/* History & WhatsApp: admin only */}
                      {isAdmin && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => { e.stopPropagation(); setHistoryOrder(order); }}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(210,60%,52%)]/10 text-[hsl(210,60%,52%)] hover:bg-[hsl(210,60%,52%)]/20 transition-colors active:scale-95"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p className="text-xs">History</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <a
                                href={`https://wa.me/${order.phone.replace(/\D/g, '')}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(155,50%,42%)]/10 text-[hsl(155,50%,42%)] hover:bg-[hsl(155,50%,42%)]/20 transition-colors active:scale-95"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </a>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p className="text-xs">WhatsApp</p></TooltipContent>
                          </Tooltip>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paginatedOrders.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.size + (isAdmin ? 2 : 1)} className="py-16 text-center text-muted-foreground text-sm">
                    No orders found matching your criteria
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile Cards */}
        <div className="md:hidden divide-y">
          {paginatedOrders.map((order) => (
            <div
              key={order.id}
              className="p-4 hover:bg-muted/30 cursor-pointer transition-colors active:scale-[0.98]"
              onClick={() => navigate(`/orders/${order.id}`)}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">{order.id}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{format(new Date(order.createdAt), 'dd MMM yyyy HH:mm')}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">{order.customer}</span>
                <span className="text-xs text-muted-foreground">{order.city}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-2">{order.products.map(p => p.name).join(', ')}</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {(() => {
                    const effectiveStatus = (!isAdmin && order.confirmationStatus === 'new_wts')
                      ? 'new' as ConfirmationStatus
                      : order.confirmationStatus;
                    return <StatusBadge {...confirmationConfig[effectiveStatus]} attemptCount={effectiveStatus === 'no_answer' ? order.attemptCount : undefined} />;
                  })()}
                  <StatusBadge {...deliveryConfig[order.deliveryStatus]} />
                  {order.carrierShippingStatus && (
                    <StatusBadge label={subStatusLabel(order.carrierShippingStatus)!} cls={subStatusClass(order.carrierShippingStatus)} />
                  )}
                </div>
                {(isAdmin || order.confirmationStatus === 'new') && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditOrder(order); }}
                    className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-[hsl(30,90%,55%)]/10 text-[hsl(30,90%,55%)] hover:bg-[hsl(30,90%,55%)]/20 transition-colors active:scale-95"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
          {paginatedOrders.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">No orders found</div>
          )}
        </div>

        {/* Footer with Pagination */}
        <div className="flex items-center justify-end px-4 py-2.5 border-t">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums mr-2">
              {totalCount === 0 ? 0 : (currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
            </span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1 || loadingOrders} onClick={() => setCurrentPage(1)}>
              <span className="text-xs">«</span>
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1 || loadingOrders} onClick={() => setCurrentPage(p => p - 1)}>
              <span className="text-xs">‹</span>
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums px-1.5">
              {currentPage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages || loadingOrders} onClick={() => setCurrentPage(p => p + 1)}>
              <span className="text-xs">›</span>
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages || loadingOrders} onClick={() => setCurrentPage(totalPages)}>
              <span className="text-xs">»</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Carrier Tracking Modal */}
      {trackingTarget && (
        <CarrierTrackingModal
          carrierOrderId={trackingTarget.carrierId}
          systemId={trackingTarget.systemId}
          sellerId={trackingTarget.sellerId}
          open={!!trackingTarget}
          onClose={() => setTrackingTarget(null)}
        />
      )}

      {/* Edit Modal */}
      {editOrder && (
        <EditOrderModal
          open={!!editOrder}
          onOpenChange={(open) => !open && setEditOrder(null)}
          order={editOrder}
          onSave={async (updated) => {
            const normalizedProducts = updated.products.map((product) => ({
              ...product,
              name: product.name.trim(),
              qty: Math.max(1, Math.trunc(Number(product.qty || 1))),
              price: Math.max(0, Number(product.price || 0)),
            }));
            if (normalizedProducts.some((product) => !product.name)) {
              throw new Error("Product name is required");
            }

            // Update in DB
            const dbUpdate: any = {
              customer_name: updated.customer,
              customer_phone: updated.phone,
              customer_city: updated.city,
              customer_address: updated.address,
              confirmation_status: updated.confirmationStatus,
              delivery_status: updated.deliveryStatus,
              note: updated.notes || '',
              quantity: normalizedProducts.reduce((s, p) => s + p.qty, 0),
              price: normalizedProducts[0]?.price || 0,
              total_amount: normalizedProducts.reduce((s, p) => s + p.qty * p.price, 0),
              product_name: normalizedProducts[0]?.name || '',
              updated_at: new Date().toISOString(),
            };

            // Every other confirm/deliver code path in the app sets these event
            // timestamps — this manual admin edit must too, or the order silently
            // vanishes from every delivered_at/confirmed_at-based analytics chart
            // (Dashboard's Delivered sparkline, Delivery/Seller Analytics' Updated
            // mode, etc.) even though its status genuinely changed.
            if (updated.confirmationStatus === 'confirmed' && editOrder.confirmationStatus !== 'confirmed') {
              dbUpdate.confirmed_at = dbUpdate.updated_at;
            }
            if (updated.deliveryStatus === 'delivered' && editOrder.deliveryStatus !== 'delivered') {
              dbUpdate.delivered_at = dbUpdate.updated_at;
            }

            const { error } = await supabase
              .from('orders')
              .update(dbUpdate)
              .eq('order_id', updated.id);

            if (error) {
              console.error('Failed to update order in DB:', error);
              throw error;
            }

            if (updated.dbId) {
              const existingIds = new Set((editOrder.products || []).map((product) => product.id).filter(Boolean));
              const keptIds = new Set(normalizedProducts.map((product) => product.id).filter(Boolean));
              const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

              if (removedIds.length > 0) {
                const { error: deleteError } = await supabase
                  .from("order_items" as any)
                  .delete()
                  .in("id", removedIds);
                if (deleteError) throw deleteError;
              }

              for (const product of normalizedProducts) {
                const payload = {
                  product_id: product.productId || null,
                  product_variant_id: product.productVariantId || null,
                  sku: product.sku || null,
                  product_name: product.name,
                  variant_name: product.variantName || null,
                  quantity: product.qty,
                  unit_price: product.price,
                };

                if (product.id) {
                  const { error: itemUpdateError } = await supabase
                    .from("order_items" as any)
                    .update(payload)
                    .eq("id", product.id);
                  if (itemUpdateError) throw itemUpdateError;
                } else {
                  const { error: itemInsertError } = await supabase
                    .from("order_items" as any)
                    .insert({ ...payload, order_id: updated.dbId });
                  if (itemInsertError) throw itemInsertError;
                }
              }
            }

            // Track history
            const editGroupId = crypto.randomUUID();
            const historyEntries: any[] = [];
            const trackChange = (field: string, oldVal: any, newVal: any) => {
              if (String(oldVal ?? '') !== String(newVal ?? '')) {
                historyEntries.push({
                  order_id: updated.id,
                  changed_by: authUser?.id,
                  changed_by_role: authUser?.role || 'admin',
                  field_changed: field,
                  old_value: String(oldVal ?? ''),
                  new_value: String(newVal ?? ''),
                  action_type: 'edit',
                  group_id: editGroupId,
                });
              }
            };
            trackChange('confirmation_status', editOrder.confirmationStatus, updated.confirmationStatus);
            trackChange('delivery_status', editOrder.deliveryStatus, updated.deliveryStatus);
            trackChange('customer_name', editOrder.customer, updated.customer);
            trackChange('customer_phone', editOrder.phone, updated.phone);
            trackChange('customer_city', editOrder.city, updated.city);
            trackChange('total_amount', editOrder.total, updated.total);
            trackChange(
              'order_items',
              JSON.stringify(editOrder.products.map(({ name, qty, price }) => ({ name, qty, price }))),
              JSON.stringify(normalizedProducts.map(({ name, qty, price }) => ({ name, qty, price }))),
            );
            trackChange('note', editOrder.notes, updated.notes);

            if (historyEntries.length > 0) {
              await supabase.from('order_history').insert(historyEntries);
            }

            setOrders(prev => prev.map(o => o.id === updated.id ? {
              ...updated,
              products: normalizedProducts,
              total: dbUpdate.total_amount,
            } : o));
            setEditOrder(null);
          }}
        />
      )}

      {/* History Modal */}
      {historyOrder && (
        <OrderHistoryModal
          open={!!historyOrder}
          onOpenChange={(open) => !open && setHistoryOrder(null)}
          orderId={historyOrder.id}
          customerName={historyOrder.customer}
        />
      )}

      {/* Create Order Modal - Seller/Admin */}
      <CreateOrderModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onCreated={() => setRefreshKey(k => k + 1)}
      />

      {/* Bulk Status Change Confirmation */}
      <AlertDialog open={!!bulkConfirm} onOpenChange={(open) => !open && setBulkConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to change the {bulkConfirm?.field === "confirmation_status" ? "confirmation" : "delivery"} status of{" "}
              <span className="font-semibold">{selectedOrders.size} order{selectedOrders.size > 1 ? "s" : ""}</span> to{" "}
              <span className="font-semibold">{bulkConfirm?.label}</span>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkStatusChange}>Yes, I'm sure</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </TooltipProvider>
  );
}
