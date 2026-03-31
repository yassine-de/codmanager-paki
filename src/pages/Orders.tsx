import { useState, useMemo, useCallback, useEffect } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AreaChart, Area, ResponsiveContainer } from "recharts";
import { eachDayOfInterval, startOfDay, subDays, isAfter, format as fmtDate } from "date-fns";
import { Search, SlidersHorizontal, X, Columns3, CalendarIcon, Filter, Pencil, History, MessageCircle, Download, RefreshCw, ChevronDown } from "lucide-react";
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

/* ── Status badge configs ── */
const confirmationConfig: Record<ConfirmationStatus, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  confirmed: { label: 'Confirmed', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  no_answer: { label: 'No Answer', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  postponed: { label: 'Postponed', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
  cancelled: { label: 'Cancelled', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  wrong_number: { label: 'Wrong Number', cls: 'bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/20' },
  double: { label: 'Double', cls: 'bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/20' },
};

const deliveryConfig: Record<DeliveryStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-[hsl(30,6%,50%)]/12 text-[hsl(30,6%,50%)] border-[hsl(30,6%,50%)]/20' },
  shipped: { label: 'Shipped', cls: 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' },
  in_transit: { label: 'In Transit', cls: 'bg-[hsl(230,55%,55%)]/12 text-[hsl(230,55%,55%)] border-[hsl(230,55%,55%)]/20' },
  with_courier: { label: 'With Courier', cls: 'bg-[hsl(185,55%,42%)]/12 text-[hsl(185,55%,42%)] border-[hsl(185,55%,42%)]/20' },
  delivered: { label: 'Delivered', cls: 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' },
  returned: { label: 'Returned', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  cancelled: { label: 'Cancelled', cls: 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' },
  no_answer: { label: 'No Answer', cls: 'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20' },
  postponed: { label: 'Postponed', cls: 'bg-[hsl(25,85%,55%)]/12 text-[hsl(25,85%,55%)] border-[hsl(25,85%,55%)]/20' },
};

function StatusBadge({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

/* ── Column definitions ── */
type ColumnKey = 'id' | 'createdAt' | 'updatedAt' | 'seller' | 'customer' | 'city' | 'phone' | 'product' | 'amount' | 'confirmationStatus' | 'deliveryStatus' | 'attempts';

const allColumns: { key: ColumnKey; label: string; defaultVisible: boolean }[] = [
  { key: 'id', label: 'ID', defaultVisible: true },
  { key: 'createdAt', label: 'Created', defaultVisible: true },
  { key: 'updatedAt', label: 'Updated', defaultVisible: true },
  { key: 'seller', label: 'Seller', defaultVisible: true },
  { key: 'customer', label: 'Client', defaultVisible: true },
  { key: 'city', label: 'City', defaultVisible: true },
  { key: 'phone', label: 'Phone', defaultVisible: true },
  { key: 'product', label: 'Product', defaultVisible: true },
  { key: 'amount', label: 'Amount', defaultVisible: true },
  { key: 'confirmationStatus', label: 'Confirmation', defaultVisible: true },
  { key: 'attempts', label: 'Attempts', defaultVisible: true },
  { key: 'deliveryStatus', label: 'Delivery', defaultVisible: true },
];

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
        confirmed: dayOrders.filter(o => ["confirmed","shipped","delivered","in_transit","with_courier"].includes(o.status)).length,
        delivered: dayOrders.filter(o => o.status === "delivered").length,
        returned: dayOrders.filter(o => o.status === "returned").length,
      };
    });
  }, [orders]);

  const totals = useMemo(() => ({
    total: orders.length,
    confirmed: orders.filter(o => ["confirmed","shipped","delivered","in_transit","with_courier"].includes(o.status)).length,
    delivered: orders.filter(o => o.status === "delivered").length,
    returned: orders.filter(o => o.status === "returned").length,
  }), [orders]);

  const cards = [
    { title: "Total Orders", value: totals.total, dataKey: "total", color: "hsl(210,60%,52%)" },
    { title: "Fulfilled orders over time", value: totals.confirmed, dataKey: "confirmed", color: "hsl(210,60%,52%)" },
    { title: "Delivered orders over time", value: totals.delivered, dataKey: "delivered", color: "hsl(155,50%,42%)" },
    { title: "Returns", value: totals.returned, dataKey: "returned", color: "hsl(210,60%,52%)" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
      {cards.map((c) => (
        <div key={c.title} className="bg-card rounded-xl border shadow-soft px-5 py-4 hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-200">
          <p className="text-sm text-muted-foreground font-medium">{c.title}</p>
          <div className="flex items-end justify-between mt-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-2xl font-bold tabular-nums">
                {isDataVisible ? c.value.toLocaleString() : <MaskedValue className="gap-1" />}
              </span>
              {isDataVisible && <span className="text-success text-xs font-semibold">↑</span>}
            </div>
            <div className="w-20 h-8">
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [sellerNames, setSellerNames] = useState<string[]>([]);
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
      o.confirmationStatus,
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
      .update({ [field]: newValue, updated_at: new Date().toISOString() })
      .in("order_id", orderIds);
    
    if (error) {
      toast.error("Failed to update orders");
      console.error(error);
      setBulkConfirm(null);
      return;
    }

    const historyEntries = selected.map(o => ({
      order_id: o.id,
      changed_by: authUser?.id,
      changed_by_role: authUser?.role || "admin",
      field_changed: field,
      old_value: field === "confirmation_status" ? o.confirmationStatus : o.deliveryStatus,
      new_value: newValue,
    }));
    await supabase.from("order_history").insert(historyEntries);

    toast.success(`${selected.length} orders updated`);
    setSelectedOrders(new Set());
    setBulkConfirm(null);
    setRefreshKey(k => k + 1);
  };

  // Fetch orders from database
  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching orders:", error);
        return;
      }

      // Fetch seller names for display
      const sellerIds = [...new Set((data || []).map(o => o.seller_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", sellerIds);

      const sellerMap = new Map((profiles || []).map(p => [p.user_id, p.name]));

      const mapped: Order[] = (data || []).map(o => ({
        id: o.order_id,
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
        seller: sellerMap.get(o.seller_id) || "Unknown",
        upsell: false,
        warehouseState: "in_stock" as const,
        history: [],
        attemptCount: o.attempt_count || 0,
      }));

      setOrders(mapped);
      setSellerNames([...new Set(mapped.map(o => o.seller))]);
      setProductNames([...new Set(mapped.flatMap(o => o.products.map(p => p.name)))]);
    };

    fetchOrders();
  }, [refreshKey]);

  // Filters state
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [filterProduct, setFilterProduct] = useState('all');
  const [filterSeller, setFilterSeller] = useState('all');
  const [filterConfirmation, setFilterConfirmation] = useState('all');
  const [filterDelivery, setFilterDelivery] = useState('all');
  const [filterUpsell, setFilterUpsell] = useState('all');
  const [filterWarehouse, setFilterWarehouse] = useState('all');

  // Read URL params on mount
  useEffect(() => {
    const conf = searchParams.get('confirmation');
    const del = searchParams.get('delivery');
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
    // Clear URL params after reading
    if (conf || del) {
      setSearchParams({}, { replace: true });
    }
  }, []);

  // Applied filters (only apply on button click)
  const [appliedFilters, setAppliedFilters] = useState(() => {
    const conf = new URLSearchParams(window.location.search).get('confirmation');
    const del = new URLSearchParams(window.location.search).get('delivery');
    return {
      dateRange: undefined as DateRange | undefined,
      product: 'all', seller: 'all', 
      confirmation: conf || 'all',
      delivery: del || 'all', 
      upsell: 'all', warehouse: 'all',
    };
  });

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    new Set(allColumns.filter(c => c.defaultVisible).map(c => c.key))
  );

  const applyFilters = useCallback(() => {
    setAppliedFilters({
      dateRange, product: filterProduct, seller: filterSeller,
      confirmation: filterConfirmation, delivery: filterDelivery,
      upsell: filterUpsell, warehouse: filterWarehouse,
    });
  }, [dateRange, filterProduct, filterSeller, filterConfirmation, filterDelivery, filterUpsell, filterWarehouse]);

  const clearFilters = useCallback(() => {
    setDateRange(undefined);
    setFilterProduct('all'); setFilterSeller('all');
    setFilterConfirmation('all'); setFilterDelivery('all');
    setFilterUpsell('all'); setFilterWarehouse('all');
    setAppliedFilters({
      dateRange: undefined, product: 'all', seller: 'all',
      confirmation: 'all', delivery: 'all', upsell: 'all', warehouse: 'all',
    });
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (appliedFilters.dateRange?.from) count++;
    if (appliedFilters.product !== 'all') count++;
    if (appliedFilters.seller !== 'all') count++;
    if (appliedFilters.confirmation !== 'all') count++;
    if (appliedFilters.delivery !== 'all') count++;
    if (appliedFilters.upsell !== 'all') count++;
    if (appliedFilters.warehouse !== 'all') count++;
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
        if (f.confirmation !== 'all' && o.confirmationStatus !== f.confirmation) return false;
        if (f.delivery !== 'all' && o.deliveryStatus !== f.delivery) return false;
        if (f.upsell !== 'all') {
          if (f.upsell === 'yes' && !o.upsell) return false;
          if (f.upsell === 'no' && o.upsell) return false;
        }
        if (f.warehouse !== 'all' && o.warehouseState !== f.warehouse) return false;
        if (search) {
          const s = search.toLowerCase();
          return o.id.toLowerCase().includes(s) || o.customer.toLowerCase().includes(s) ||
            o.phone.includes(s) || o.city.toLowerCase().includes(s);
        }
        return true;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [search, appliedFilters, orders]);

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
    <div className="space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage all your COD orders</p>
        </div>
        {!isAdmin && (
          <Button size="sm" className="gap-1.5" onClick={() => setShowCreateModal(true)}>
            <Plus className="w-4 h-4" /> Create Order
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
            {/* Confirmation */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Confirmation</label>
              <SearchableSelect
                value={filterConfirmation}
                onValueChange={setFilterConfirmation}
                options={Object.entries(confirmationConfig).map(([k, v]) => ({ value: k, label: v.label }))}
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
                options={Object.entries(deliveryConfig).map(([k, v]) => ({ value: k, label: v.label }))}
                placeholder="Delivery"
                allLabel="All"
                className="w-full"
              />
            </div>
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
            {/* Warehouse - admin only */}
            {isAdmin && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Warehouse</label>
              <SearchableSelect
                value={filterWarehouse}
                onValueChange={setFilterWarehouse}
                options={[{ value: "in_stock", label: "In Stock" }, { value: "out_of_stock", label: "Out of Stock" }, { value: "reserved", label: "Reserved" }]}
                placeholder="Warehouse"
                allLabel="All"
                className="w-full"
              />
            </div>
            )}
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
                {allColumns.map(col => (
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
                {isCol('id') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">ID</th>}
                {isCol('createdAt') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Created</th>}
                {isCol('updatedAt') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Updated</th>}
                {isCol('seller') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Seller</th>}
                {isCol('customer') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Client</th>}
                {isCol('city') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">City</th>}
                {isCol('phone') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Phone</th>}
                {isCol('product') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Product</th>}
                {isCol('amount') && <th className="text-right py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Amount</th>}
                {isCol('confirmationStatus') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Confirmation</th>}
                {isCol('attempts') && isAdmin && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Attempts</th>}
                {isCol('deliveryStatus') && <th className="text-left py-3 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">Delivery</th>}
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
                  {isCol('id') && <td className="py-2.5 px-4 font-medium text-xs">{order.id}</td>}
                  {isCol('createdAt') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{format(new Date(order.createdAt), 'dd MMM yyyy')}</td>}
                  {isCol('updatedAt') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{format(new Date(order.updatedAt), 'dd MMM yyyy')}</td>}
                  {isCol('seller') && <td className="py-2.5 px-4 text-xs">{order.seller}</td>}
                  {isCol('customer') && <td className="py-2.5 px-4 text-xs">{order.customer}</td>}
                  {isCol('city') && <td className="py-2.5 px-4 text-xs text-muted-foreground">{order.city}</td>}
                  {isCol('phone') && <td className="py-2.5 px-4 text-xs text-muted-foreground tabular-nums">{order.phone}</td>}
                  {isCol('product') && <td className="py-2.5 px-4 text-xs text-muted-foreground">{order.products.map(p => p.name).join(', ')}</td>}
                  {isCol('amount') && <td className="py-2.5 px-4 text-xs font-medium tabular-nums text-right">{order.total.toLocaleString()} PKR</td>}
                  {isCol('confirmationStatus') && <td className="py-2.5 px-4"><StatusBadge {...confirmationConfig[order.confirmationStatus]} /></td>}
                  {isCol('attempts') && isAdmin && (
                    <td className="py-2.5 px-4 text-xs">
                      {(order.attemptCount || 0) > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border border-[hsl(38,90%,55%)]/20 px-2 py-0.5 text-[11px] font-medium">
                          {order.attemptCount}× attempt{(order.attemptCount || 0) > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                  {isCol('deliveryStatus') && <td className="py-2.5 px-4"><StatusBadge {...deliveryConfig[order.deliveryStatus]} /></td>}
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
                <span className="text-xs text-muted-foreground tabular-nums">{format(new Date(order.createdAt), 'dd MMM yyyy')}</span>
              </div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm">{order.customer}</span>
                <span className="text-xs text-muted-foreground">{order.city}</span>
              </div>
              <div className="text-xs text-muted-foreground mb-2">{order.products.map(p => p.name).join(', ')}</div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <StatusBadge {...confirmationConfig[order.confirmationStatus]} />
                  <StatusBadge {...deliveryConfig[order.deliveryStatus]} />
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


      {/* Edit Modal */}
      {editOrder && (
        <EditOrderModal
          open={!!editOrder}
          onOpenChange={(open) => !open && setEditOrder(null)}
          order={editOrder}
          onSave={async (updated) => {
            // Update in DB
            const dbUpdate: Record<string, any> = {
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
