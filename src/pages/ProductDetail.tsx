import { useMemo } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, ShoppingCart, CheckCircle2, Truck, Package, TrendingUp, ImageOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { mockProducts, type Product } from "@/lib/products-data";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from "recharts";
import { format, subDays } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";

  const isDbId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id || "");

  // Mock products only for admin
  const mockProduct = useMemo(() => isAdmin ? mockProducts.find(p => p.id === id) : undefined, [id, isAdmin]);

  // Fetch DB product
  const { data: dbProduct } = useQuery({
    queryKey: ["product-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, variants, weight")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isDbId && !mockProduct,
  });

  // Fetch seller profile (admin needs actual seller name)
  const { data: sellerProfile } = useQuery({
    queryKey: ["product-seller-profile", dbProduct?.seller_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("name")
        .eq("user_id", dbProduct!.seller_id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!dbProduct?.seller_id && isAdmin,
  });

  const product: Product | null = useMemo(() => {
    if (mockProduct) return mockProduct;
    if (!dbProduct) return null;
    const rawVariants = (dbProduct as any).variants as any[] | null;
    const mappedVariants = rawVariants
      ? rawVariants.map((v: any, i: number) => ({
          id: v.id || `v-${i}`,
          name: v.name || v.group || "",
          sku: "",
          price: 0,
          quantity: v.quantity || (v.subVariants ? v.subVariants.reduce((s: number, sv: any) => s + (sv.quantity || 0), 0) : 0),
        }))
      : [];
    return {
      id: dbProduct.id,
      seller: sellerProfile?.name || authUser?.name || "Unknown",
      sku: dbProduct.sku,
      name: dbProduct.name,
      image: dbProduct.image_url || "",
      price: Number(dbProduct.landed_price) || 0,
      totalQty: dbProduct.quantity || 0,
      delivered: 0,
      shipped: 0,
      available: dbProduct.quantity || 0,
      createdAt: dbProduct.created_at,
      variants: mappedVariants,
      storeLink: dbProduct.product_url || "",
      videoLink: dbProduct.video_url || "",
      lastSellingPrice: Number(dbProduct.price) || 0,
      lastPrice: Number(dbProduct.last_price) || 0,
      offers: ((dbProduct as any).offers || []).map((o: any, idx: number) => ({ id: `OFF-${idx}`, quantity: o.quantity || 1, price: o.price || 0 })),
      weight: (dbProduct as any).weight || undefined,
    } as Product;
  }, [dbProduct, mockProduct, sellerProfile, authUser]);

  // Fetch real orders — RLS handles seller isolation; admin filters by seller_id
  const { data: productOrders = [] } = useQuery({
    queryKey: ["product-orders", dbProduct?.name, dbProduct?.seller_id],
    queryFn: async () => {
      let query = supabase
        .from("orders")
        .select("*")
        .eq("product_name", dbProduct!.name)
        .order("created_at", { ascending: false });
      if (isAdmin) {
        query = query.eq("seller_id", dbProduct!.seller_id);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!dbProduct?.name && !!dbProduct?.seller_id,
  });

  // Compute real stats from orders
  const stats = useMemo(() => {
    if (!product) return null;
    const totalOrders = productOrders.length;
    const confirmed = productOrders.filter(o => o.confirmation_status === 'confirmed').length;
    const shipped = productOrders.filter(o =>
      o.shipping_status && ['shipped', 'in_transit', 'with_courier'].includes(o.shipping_status)
    ).length;
    const delivered = productOrders.filter(o =>
      o.delivery_status === 'delivered' || o.delivery_status === 'paid'
    ).length;
    const cancelled = productOrders.filter(o =>
      ['cancelled', 'no_answer', 'wrong_number', 'double'].includes(o.confirmation_status)
    ).length;
    // Total sales = sum of total_amount for confirmed/shipped/delivered orders
    const activeSales = productOrders.filter(o =>
      !['cancelled', 'no_answer', 'wrong_number', 'double'].includes(o.confirmation_status)
    );
    const totalSales = activeSales.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const avgOrderValue = activeSales.length > 0 ? Math.round(totalSales / activeSales.length) : 0;

    return {
      totalOrders,
      confirmed: confirmed + shipped + delivered, // all that passed confirmation
      shipped,
      delivered,
      cancelled,
      confirmationRate: totalOrders > 0 ? (((confirmed + shipped + delivered) / totalOrders) * 100).toFixed(1) : "0.0",
      deliveryRate: (confirmed + shipped + delivered) > 0 ? ((delivered / (confirmed + shipped + delivered)) * 100).toFixed(1) : "0.0",
      totalSales,
      avgOrderValue,
    };
  }, [product, productOrders]);

  // Compute real daily data from orders (last 30 days)
  const dailyData = useMemo(() => {
    if (!product) return [];
    return Array.from({ length: 30 }, (_, i) => {
      const date = subDays(new Date(), 29 - i);
      const dayStr = format(date, "yyyy-MM-dd");
      const dayOrders = productOrders.filter(o => format(new Date(o.created_at), "yyyy-MM-dd") === dayStr);
      const shipped = dayOrders.filter(o => o.shipping_status && ['shipped', 'in_transit', 'with_courier'].includes(o.shipping_status)).length;
      const delivered = dayOrders.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid').length;
      return {
        date: format(date, "dd MMM"),
        shortDate: format(date, "dd"),
        shipped,
        delivered,
        orders: dayOrders.length,
      };
    });
  }, [product, productOrders]);

  if (!product) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Package className="w-12 h-12 text-muted-foreground mb-4" />
        <h2 className="text-lg font-semibold mb-1">Product not found</h2>
        <p className="text-sm text-muted-foreground mb-4">This product doesn't exist</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1.5" /> Back to Products
        </Button>
      </div>
    );
  }

  // Compute real shipped/delivered counts from orders
  const realShipped = productOrders.filter(o => o.shipping_status && ['shipped', 'in_transit', 'with_courier'].includes(o.shipping_status)).length;
  const realDelivered = productOrders.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid').length;
  const realAvailable = Math.max(0, product.totalQty - realShipped - realDelivered);

  const inventoryData = [
    { label: "Total", value: product.totalQty, color: "hsl(30, 10%, 12%)" },
    { label: "In Stock", value: realAvailable, color: "hsl(210, 60%, 52%)" },
    { label: "Shipped", value: realShipped, color: "hsl(270, 50%, 55%)" },
    { label: "Delivered", value: realDelivered, color: "hsl(155, 50%, 42%)" },
  ];

  const inventoryPercent = product.totalQty > 0 ? (realAvailable / product.totalQty) * 100 : 0;
  const shippedPercent = product.totalQty > 0 ? (realShipped / product.totalQty) * 100 : 0;
  const deliveredPercent = product.totalQty > 0 ? (realDelivered / product.totalQty) * 100 : 0;

  return (
    <div className="space-y-5 max-w-7xl animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">Dashboard</Link>
        <span className="text-muted-foreground">/</span>
        <Link to="/products" className="text-muted-foreground hover:text-foreground transition-colors">Products</Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-primary font-medium truncate max-w-[200px]">{product.name}</span>
      </div>

      {/* Product Header */}
      <div className="flex items-center gap-4">
        <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => navigate("/products")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3 min-w-0">
          {product.image ? (
            <img src={product.image} alt={product.name} className="w-12 h-12 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
              <ImageOff className="w-5 h-5 text-muted-foreground" />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate">{product.name}</h1>
            <p className="text-sm text-muted-foreground">{product.seller} · {product.sku}</p>
          </div>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 animate-slide-up" style={{ animationDelay: "50ms" }}>
        <KPICard
          label="Orders"
          value={stats?.totalOrders ?? 0}
          highlight
        />
        <KPICard
          label="Total Sales"
          value={`${(stats?.totalSales ?? 0).toLocaleString()}`}
          suffix="$"
        />
        <KPICard
          label="Avg. Order Value"
          value={stats?.avgOrderValue ?? 0}
          suffix="$"
        />
        <KPICard
          label="Confirmed"
          value={stats?.confirmed ?? 0}
          percentage={stats?.confirmationRate ?? "0.0"}
        />
        <KPICard
          label="Delivered"
          value={stats?.delivered ?? 0}
          percentage={stats?.deliveryRate ?? "0.0"}
        />
        <KPICard
          label="Cancelled"
          value={stats?.cancelled ?? 0}
          destructive
        />
      </div>

      {/* Inventory + Performance Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 animate-slide-up" style={{ animationDelay: "100ms" }}>
        {/* Inventory Card */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-sm font-semibold mb-4">Inventory</h3>
          {/* Stacked bar */}
          <div className="w-full h-3 rounded-full bg-muted overflow-hidden flex">
            <div
              className="h-full transition-all"
              style={{ width: `${deliveredPercent}%`, backgroundColor: "hsl(155, 50%, 42%)" }}
            />
            <div
              className="h-full transition-all"
              style={{ width: `${shippedPercent}%`, backgroundColor: "hsl(270, 50%, 55%)" }}
            />
            <div
              className="h-full transition-all"
              style={{ width: `${inventoryPercent}%`, backgroundColor: "hsl(210, 60%, 52%)" }}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3">
            {inventoryData.map((item) => (
              <div key={item.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <span className="text-xs">
                  <span className="font-semibold tabular-nums">{item.value}</span>{" "}
                  <span className="text-muted-foreground">{item.label}</span>
                </span>
              </div>
            ))}
          </div>

          {/* Variants breakdown */}
          {product.variants.length > 0 && (
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Variants Stock</p>
              {product.variants.map((v) => (
                <div key={v.id} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{v.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground tabular-nums">{v.quantity} units</span>
                    <span className="tabular-nums font-medium">{v.price}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Performance Card */}
        <div className="bg-card rounded-lg border p-5">
          <h3 className="text-sm font-semibold mb-4">Performance</h3>
          <div className="grid grid-cols-2 gap-4">
            <PerformanceGauge
              label="Confirmation Rate"
              value={parseFloat(stats?.confirmationRate ?? "0")}
            />
            <PerformanceGauge
              label="Delivery Rate"
              value={parseFloat(stats?.deliveryRate ?? "0")}
            />
          </div>
        </div>
      </div>

      {/* Daily Activity Chart */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: "150ms" }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Daily Activity</h3>
          <span className="text-[11px] text-muted-foreground">Last 30 days</span>
        </div>

        {/* Summary row */}
        <div className="flex items-center gap-6 mb-4 mt-2">
          {[
            { label: "Orders", value: dailyData.reduce((s, d) => s + d.orders, 0), color: "hsl(210, 60%, 52%)" },
            { label: "Shipped", value: dailyData.reduce((s, d) => s + d.shipped, 0), color: "hsl(270, 50%, 55%)" },
            { label: "Delivered", value: dailyData.reduce((s, d) => s + d.delivered, 0), color: "hsl(155, 50%, 42%)" },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-xs text-muted-foreground">{item.label}</span>
              <span className="text-xs font-semibold tabular-nums">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={dailyData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <defs>
                <linearGradient id="gradOrders" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(210, 60%, 52%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(210, 60%, 52%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradShipped" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(270, 50%, 55%)" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="hsl(270, 50%, 55%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradDelivered" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(155, 50%, 42%)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="hsl(155, 50%, 42%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(35, 12%, 92%)" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "hsl(30, 6%, 50%)" }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "hsl(30, 6%, 50%)" }}
                axisLine={false}
                tickLine={false}
                width={35}
                allowDecimals={false}
              />
              <RechartsTooltip
                contentStyle={{
                  background: "hsl(0, 0%, 100%)",
                  border: "1px solid hsl(35, 12%, 90%)",
                  borderRadius: "10px",
                  fontSize: "12px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
                  padding: "10px 14px",
                }}
                labelStyle={{ fontWeight: 600, marginBottom: 6, fontSize: 12 }}
                itemStyle={{ padding: "2px 0" }}
                cursor={{ stroke: "hsl(30, 6%, 80%)", strokeWidth: 1, strokeDasharray: "4 4" }}
              />
              <Area
                type="monotone"
                dataKey="orders"
                name="Orders"
                stroke="hsl(210, 60%, 52%)"
                strokeWidth={2.5}
                fill="url(#gradOrders)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "white" }}
              />
              <Area
                type="monotone"
                dataKey="shipped"
                name="Shipped"
                stroke="hsl(270, 50%, 55%)"
                strokeWidth={2}
                fill="url(#gradShipped)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "white" }}
              />
              <Area
                type="monotone"
                dataKey="delivered"
                name="Delivered"
                stroke="hsl(155, 50%, 42%)"
                strokeWidth={2}
                fill="url(#gradDelivered)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, fill: "white" }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function KPICard({
  label,
  value,
  suffix,
  percentage,
  highlight,
  destructive,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  percentage?: string;
  highlight?: boolean;
  destructive?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        highlight
          ? "bg-info/10 border-info/25"
          : "bg-card"
      }`}
    >
      <p className={`text-xs font-medium mb-1 ${highlight ? "text-info" : "text-muted-foreground"}`}>
        {label}
      </p>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-xl font-bold tabular-nums ${destructive ? "text-destructive" : ""}`}>
          {value}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        {percentage && (
          <span className={`text-xs font-semibold ml-auto tabular-nums ${
            parseFloat(percentage) >= 70 ? "text-[hsl(155,50%,42%)]" :
            parseFloat(percentage) >= 40 ? "text-[hsl(38,90%,55%)]" :
            "text-destructive"
          }`}>
            {percentage}%
          </span>
        )}
      </div>
    </div>
  );
}

function PerformanceGauge({ label, value }: { label: string; value: number }) {
  const circumference = 2 * Math.PI * 45;
  const offset = circumference - (value / 100) * circumference;
  const color =
    value >= 70 ? "hsl(155, 50%, 42%)" :
    value >= 40 ? "hsl(38, 90%, 55%)" :
    "hsl(0, 65%, 52%)";

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-24 h-24">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="45" fill="none" stroke="hsl(35, 12%, 92%)" strokeWidth="8" />
          <circle
            cx="50" cy="50" r="45" fill="none"
            stroke={color} strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-bold tabular-nums">{Math.round(value)}%</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground font-medium text-center">{label}</p>
    </div>
  );
}
