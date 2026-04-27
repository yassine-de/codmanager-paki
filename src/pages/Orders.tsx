import { useState, useMemo, useCallback, useEffect } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { eachDayOfInterval, startOfDay, subDays, isAfter, format as fmtDate } from "date-fns";
import { Search, SlidersHorizontal, X, Columns3, CalendarIcon, Filter, Pencil, History, MessageCircle, Download, RefreshCw, ChevronDown, ArrowUp, ArrowDown, ArrowUpDown, Copy, Check } from "lucide-react";

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
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import EditOrderModal from "@/components/EditOrderModal";
import CreateOrderModal from "@/components/CreateOrderModal";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import OrioTrackingModal from "@/components/OrioTrackingModal";

/* ── Status badge configs ── */
const confirmationConfig: Record<ConfirmationStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  new_wts: { label: 'New WTS', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  confirmed: { label: 'Confirmed', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  no_answer: { label: 'No Answer', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
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
};

// Pretty label for ORIO sub-status (kept verbatim from API)
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

const shippedDeliveryStatuses: DeliveryStatus[] = ["shipped", "in_transit", "with_courier"];

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

/* ── Column definitions ── */
type ColumnKey = 'systemId' | 'id' | 'orioId' | 'createdAt' | 'updatedAt' | 'seller' | 'customer' | 'city' | 'phone' | 'product' | 'amount' | 'confirmationStatus' | 'channel' | 'deliveryStatus' | 'subStatus' | 'attempts';

const allColumns: { key: ColumnKey; label: string; defaultVisible: boolean; adminOnly?: boolean }[] = [
  { key: 'systemId', label: 'System ID', defaultVisible: true, adminOnly: true },
  { key: 'id', label: 'Seller ID', defaultVisible: true },
  { key: 'orioId', label: 'ORIO ID', defaultVisible: true, adminOnly: true },
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
];

const channelConfig: Record<string, { label: string; cls: string }> = {
  agent: { label: 'Agent', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  whatsapp: { label: 'WhatsApp', cls: 'bg-[hsl(142,71%,45%)]/12 text-[hsl(142,71%,45%)] border-[hsl(142,71%,45%)]/20' },
};

/* ── Sparkline KPI Cards ── */
function OrderSparklineCards({ orders }: { orders: Order[] }) {
  const { isDataVisible } = useDataVisibility();
  const sparkData = useMemo(() => {
    const days = eachDayOfInterval({
      start: startOfDay(subDays(new Date(), 6)),
      end: startOfDay(new Date()),
    });
    return days.map((date) => {
      const next = new Date(date); next.setDate(next.getDate() + 1);
      const dayOrders = orders.filter(o => {
        const c = new Date(o.createdAt);
        return isAfter(c, date) && !isAfter(c, next);
      });
      return {
        d: fmtDate(date, "dd"),
        total: dayOrders.length,
        shipped: dayOrders.filter(o => shippedDeliveryStatuses.includes(o.deliveryStatus)).length,
        delivered: dayOrders.filter(o => o.deliveryStatus === "delivered").length,
        returned: dayOrders.filter(o => o.deliveryStatus === "returned").length,
      };
    });
  }, [orders]);

  const totals = useMemo(() => ({
    total: orders.length,
    shipped: orders.filter(o => shippedDeliveryStatuses.includes(o.deliveryStatus)).length,
    delivered: orders.filter(o => o.deliveryStatus === "delivered").length,
    returned: orders.filter(o => o.deliveryStatus === "returned").length,
  }), [orders]);

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
  const [trackingTarget, setTrackingTarget] = useState<{ orioId: number; systemId?: number | null; sellerId?: string | null } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellerNames, setSellerNames] = useState<string[]>([]);
  const [agentNames, setAgentNames] = useState<string[]>([]);
  const [productNames, setProductNames] = useState<string[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  // Fetch orders from database
  useEffect(() => {
    const fetchOrders = async () => {
      // Paginate using `.range()` to bypass PostgREST's `db-max-rows` cap
      // (commonly 1000). Page size is intentionally kept below that cap so
      // each request returns a full page when more rows exist — otherwise
      // the loop would stop one page early and the UI would freeze at e.g.
      // 999/1000 even when the database has more rows.
      //
      // Order by a stable, unique secondary key (`id`) so pagination is
      // deterministic. Without it, rows that share the same `created_at`
      // can shift between offset windows and we lose count (e.g. 1,050 → 999).
      // We also de-duplicate by `id` as a final safety net in case a row
      // is re-inserted between fetches.
      const PAGE = 500;
      let from = 0;
      const seen = new Set<string>();
      const all: any[] = [];
      // Hard ceiling to prevent runaway loops — bump if the system grows past this.
      const MAX_ROWS = 200000;

      while (from < MAX_ROWS) {
        const { data, error } = await supabase
          .from("orders")
          .select("*")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + PAGE - 1);

        if (error) {
          console.error("Error fetching orders:", error);
          return;
        }

        const batch = data || [];
        for (const row of batch) {
          if (!seen.has(row.id)) {
            seen.add(row.id);
            all.push(row);
          }
        }
        if (batch.length < PAGE) break;
        from += PAGE;
      }

      const data = all;

      // Fetch seller & agent names for display
      const sellerIds = [...new Set((data || []).map(o => o.seller_id))];
      const agentIdsSet = new Set<string>();
      (data || []).forEach(o => {
        if (o.agent_id) agentIdsSet.add(o.agent_id);
        if (o.original_agent_id) agentIdsSet.add(o.original_agent_id);
      });
      const allUserIds = [...new Set([...sellerIds, ...agentIdsSet])];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", allUserIds);

      const profileMap = new Map((profiles || []).map(p => [p.user_id, p.name]));

      const mapped: Order[] = (data || []).map(o => ({
        id: o.order_id,
        systemId: o.system_id || undefined,
        customer: o.customer_name,
        phone: o.customer_phone,
        city: o.customer_city,
        address: o.customer_address || "",
        products: [{ name: o.product_name, qty: o.quantity, price: Number(o.price) }],
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
        agentName: o.agent_id ? (profileMap.get(o.agent_id) || undefined) : (o.original_agent_id ? (profileMap.get(o.original_agent_id) || undefined) : undefined),
        upsell: false,
        warehouseState: "in_stock" as const,
        history: [],
        attemptCount: o.attempt_count || 0,
        orioOrderId: o.orio_order_id || null,
        orioShippingStatus: o.orio_shipping_status || null,
        confirmationChannel: o.confirmation_channel || 'agent',
        whatsappStatus: o.whatsapp_status || null,
      }));

      setOrders(mapped);
      setSellerNames([...new Set(mapped.map(o => o.seller))]);
      setProductNames([...new Set(mapped.flatMap(o => o.products.map(p => p.name)))]);
      setAgentNames([...new Set(mapped.map(o => o.agentName).filter(Boolean) as string[])]);
    };

    fetchOrders();
  }, [refreshKey]);

  // Filters state
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterSeller, setFilterSeller] = useState('all');
  const [filterAgent, setFilterAgent] = useState('all');
  const [filterConfirmation, setFilterConfirmation] = useState('all');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterSubStatus, setFilterSubStatus] = useState('all');
  const [filterChannel, setFilterChannel] = useState('all');
  const [filterUpsell, setFilterUpsell] = useState('all');
  
  

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
      product: 'all', seller: 'all', agent: 'all',
      confirmation: conf || 'all',
      delivery: del || 'all',
      subStatus: 'all',
      channel: 'all',
      upsell: 'all',
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

  // Unique sub-statuses present in current orders (for filter dropdown)
  const subStatusOptions = useMemo(() => {
    const set = new Set<string>();
    orders.forEach(o => { if (o.orioShippingStatus) set.add(o.orioShippingStatus); });
    return Array.from(set).sort();
  }, [orders]);

  const applyFilters = useCallback(() => {
    setAppliedFilters({
      dateRange, product: filterProduct, seller: filterSeller, agent: filterAgent,
      confirmation: filterConfirmation, delivery: filterDelivery,
      subStatus: filterSubStatus,
      channel: filterChannel,
      upsell: filterUpsell,
    });
  }, [dateRange, filterProduct, filterSeller, filterAgent, filterConfirmation, filterDelivery, filterSubStatus, filterChannel, filterUpsell]);

  const clearFilters = useCallback(() => {
    setDateRange(undefined);
    setFilterProduct('all'); setFilterSeller('all'); setFilterAgent('all');
    setFilterConfirmation('all'); setFilterDelivery('all');
    setFilterSubStatus('all');
    setFilterChannel('all');
    setFilterUpsell('all');
    setAppliedFilters({
      dateRange: undefined, product: 'all', seller: 'all', agent: 'all',
      confirmation: 'all', delivery: 'all', subStatus: 'all', channel: 'all', upsell: 'all',
    });
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.dateRange?.from) count++;
    if (appliedFilters.product !== 'all') count++;
    if (appliedFilters.seller !== 'all') count++;
    if (appliedFilters.agent !== 'all') count++;
    if (appliedFilters.confirmation !== 'all') count++;
    if (appliedFilters.delivery !== 'all') count++;
    if (appliedFilters.subStatus !== 'all') count++;
    if (appliedFilters.channel !== 'all') count++;
    if (appliedFilters.upsell !== 'all') count++;
    return count;
  }, [appliedFilters]);

  const filtered = useMemo(() => {
    const f = appliedFilters;
    return orders
      .filter(o => {
        if (f.dateRange?.from) {
          const d = new Date(o.createdAt);
          if (d < f.dateRange.from) return false;
          if (f.dateRange.to && d > new Date(f.dateRange.to.getTime() + 86400000)) return false;
        }
        if (f.product !== 'all' && !o.products.some(p => p.name === f.product)) return false;
        if (f.seller !== 'all' && o.seller !== f.seller) return false;
        if (f.agent !== 'all' && o.agentName !== f.agent) return false;
        if (f.confirmation !== 'all') {
          // For sellers, "new" filter also matches new_wts (WhatsApp pipeline is hidden as plain New)
          const effective = (!isAdmin && o.confirmationStatus === 'new_wts') ? 'new' : o.confirmationStatus;
          if (effective !== f.confirmation) return false;
        }
        if (f.delivery !== 'all' && o.deliveryStatus !== f.delivery) return false;
        if (f.subStatus !== 'all' && (o.orioShippingStatus || '') !== f.subStatus) return false;
        if (f.channel !== 'all' && (o.confirmationChannel || 'agent') !== f.channel) return false;
        if (f.upsell !== 'all') {
          if (f.upsell === 'yes' && !o.upsell) return false;
          if (f.upsell === 'no' && o.upsell) return false;
        }
        
        if (search) {
          const s = search.toLowerCase();
          return o.id.toLowerCase().includes(s) || o.customer.toLowerCase().includes(s) ||
            o.phone.includes(s) || o.city.toLowerCase().includes(s);
        }
        return true;
      })
      .sort((a, b) => {
        let valA: number, valB: number;
        if (sortKey === 'systemId') {
          valA = a.systemId ?? 0;
          valB = b.systemId ?? 0;
        } else if (sortKey === 'updatedAt') {
          valA = new Date(a.updatedAt).getTime();
          valB = new Date(b.updatedAt).getTime();
        } else {
          valA = new Date(a.createdAt).getTime();
          valB = new Date(b.createdAt).getTime();
        }
        return sortDir === 'asc' ? valA - valB : valB - valA;
      });
  }, [search, appliedFilters, orders, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  // Reset to page 1 when filters/search change
  const prevFilteredLen = filtered.length;
  useMemo(() => { setCurrentPage(1); }, [search, appliedFilters, pageSize]);

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
        {!isAdmin && (
          <Button size="sm" className="gap-1.5 h-8" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-3.5 h-3.5" /> Create Order
          </Button>
        )}
      </div>

      {/* Mini Sparkline KPIs */}
      <OrderSparklineCards orders={orders} />

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
              <label className="text-xs font-medium text-muted-foreground">Date Range</label>
              <DatePresetFilter
                dateRange={dateRange}
                onDateRangeChange={setDateRange}
                preset={datePreset}
                onPresetChange={setDatePreset}
              />
            </div>
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
                options={sellerNames.map(s => ({ value: s, label: s }))}
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
                options={agentNames.map(a => ({ value: a, label: a }))}
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
            {/* Sub Status (ORIO) - admin only */}
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
              {filtered.length} <span className="text-muted-foreground font-normal">order{filtered.length !== 1 ? 's' : ''}</span>
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
                {isCol('id') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Seller ID</th>}
                {isAdmin && isCol('orioId') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">ORIO ID</th>}
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
                  {isAdmin && isCol('orioId') && (
                    <td className="py-2.5 px-4 text-xs" onClick={(e) => e.stopPropagation()}>
                      {order.orioOrderId ? (
                        <button
                          onClick={() => setTrackingTarget({ orioId: order.orioOrderId!, systemId: (order as any).systemId ?? null, sellerId: order.id })}
                          className="text-[hsl(210,60%,52%)] hover:underline font-medium"
                        >
                          {order.orioOrderId}
                        </button>
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
                  {isCol('phone') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{order.phone}</td>}
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
                      {order.orioShippingStatus ? (
                        <StatusBadge label={subStatusLabel(order.orioShippingStatus)!} cls={subStatusClass(order.orioShippingStatus)} />
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
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
              {filtered.length === 0 && (
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
                  <StatusBadge {...confirmationConfig[order.confirmationStatus]} attemptCount={order.confirmationStatus === 'no_answer' ? order.attemptCount : undefined} />
                  <StatusBadge {...deliveryConfig[order.deliveryStatus]} />
                  {order.orioShippingStatus && (
                    <StatusBadge label={subStatusLabel(order.orioShippingStatus)!} cls={subStatusClass(order.orioShippingStatus)} />
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
          {filtered.length === 0 && (
            <div className="py-16 text-center text-muted-foreground text-sm">No orders found</div>
          )}
        </div>

        {/* Footer with Pagination */}
        <div className="flex items-center justify-end px-4 py-2.5 border-t">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground tabular-nums mr-2">
              {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
            </span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>
              <span className="text-xs">«</span>
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
              <span className="text-xs">‹</span>
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums px-1.5">
              {currentPage} / {totalPages}
            </span>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
              <span className="text-xs">›</span>
            </Button>
            <Button variant="outline" size="sm" className="h-7 w-7 p-0" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>
              <span className="text-xs">»</span>
            </Button>
          </div>
        </div>
      </div>

      {/* ORIO Tracking Modal */}
      {trackingTarget && (
        <OrioTrackingModal
          orioOrderId={trackingTarget.orioId}
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
            // Update in DB
            const dbUpdate: any = {
              customer_name: updated.customer,
              customer_phone: updated.phone,
              customer_city: updated.city,
              customer_address: updated.address,
              confirmation_status: updated.confirmationStatus,
              delivery_status: updated.deliveryStatus,
              note: updated.notes || '',
              quantity: updated.products.reduce((s, p) => s + p.qty, 0),
              price: updated.products[0]?.price || 0,
              total_amount: updated.total,
              product_name: updated.products[0]?.name || '',
              updated_at: new Date().toISOString(),
            };

            const { error } = await supabase
              .from('orders')
              .update(dbUpdate)
              .eq('order_id', updated.id);

            if (error) {
              console.error('Failed to update order in DB:', error);
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
            trackChange('note', editOrder.notes, updated.notes);

            if (historyEntries.length > 0) {
              await supabase.from('order_history').insert(historyEntries);
            }

            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o));
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

      {/* Create Order Modal - Seller only */}
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
