import { useState, useMemo, useCallback, useEffect } from "react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Filter, X, Pencil, Plus, Package, ImageOff, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Layers, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { mockProducts, type Product } from "@/lib/products-data";
import { CreateProductModal } from "@/components/CreateProductModal";
import { EditProductModal } from "@/components/EditProductModal";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function Products() {
  const navigate = useNavigate();
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = authUser?.role === "admin";
  const isSeller = authUser?.role === "seller";
  const [localProducts, setLocalProducts] = useState<Product[]>(mockProducts);

  // Fetch DB products (RLS ensures sellers only see their own)
  const { data: dbProducts = [] } = useQuery({
    queryKey: ["db-products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*, variants, weight")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch order status rows so delivered/shipped/available match the real orders system
  const { data: productOrderRows = [] } = useQuery({
    queryKey: ["product-order-stats", authUser?.role],
    queryFn: async () => {
      const pageSize = 1000;
      const allRows: Array<{ seller_id: string; product_name: string; delivery_status: string | null }> = [];
      let from = 0;

      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("seller_id, product_name, delivery_status")
          .in("delivery_status", ["shipped", "in_transit", "with_courier", "delivered", "paid", "returned"])
          .range(from, from + pageSize - 1);

        if (error) throw error;
        if (!data || data.length === 0) break;

        allRows.push(...data);

        if (data.length < pageSize) break;
        from += pageSize;
      }

      return allRows;
    },
    refetchInterval: 10000,
  });

  const productOrderStatsMap = useMemo(() => {
    const map: Record<string, { delivered: number; shipped: number; returned: number }> = {};

    productOrderRows.forEach((row) => {
      const key = `${row.seller_id}::${row.product_name}`;
      const current = map[key] || { delivered: 0, shipped: 0, returned: 0 };

      if (row.delivery_status === "delivered" || row.delivery_status === "paid") {
        current.delivered += 1;
      } else if (["shipped", "in_transit", "with_courier"].includes(row.delivery_status || "")) {
        current.shipped += 1;
      } else if (row.delivery_status === "returned") {
        current.returned += 1;
      }

      map[key] = current;
    });

    return map;
  }, [productOrderRows]);

  // Fetch seller profiles for DB products (admin only needs this)
  const dbSellerIds = useMemo(() => [...new Set(dbProducts.map(p => p.seller_id))], [dbProducts]);
  const { data: dbSellerProfiles = [] } = useQuery({
    queryKey: ["product-seller-profiles", dbSellerIds],
    queryFn: async () => {
      if (dbSellerIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", dbSellerIds);
      if (error) throw error;
      return data;
    },
    enabled: dbSellerIds.length > 0 && isAdmin,
  });

  const dbSellerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    dbSellerProfiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [dbSellerProfiles]);

  // Merge: admin sees mock + DB, seller sees only their DB products
  const products = useMemo(() => {
    const dbMapped: Product[] = dbProducts.map(p => {
      const orderStats = productOrderStatsMap[`${p.seller_id}::${p.name}`] || { delivered: 0, shipped: 0, returned: 0 };
      const availableQty = Math.max(0, (p.quantity || 0) - orderStats.delivered - orderStats.shipped);

      // Map sourcing-style variants to product variants
      const rawVariants = (p as any).variants as any[] | null;
      const mappedVariants: Product["variants"] = rawVariants
        ? rawVariants.map((v: any, i: number) => ({
            id: v.id || `v-${i}`,
            name: v.name || v.group || "",
            sku: v.sku || "",
            price: v.price || Number((p as any).landed_price) || 0,
            quantity: v.quantity || (v.subVariants ? v.subVariants.reduce((s: number, sv: any) => s + (sv.quantity || 0), 0) : 0),
          }))
        : [];
      return {
        id: p.id,
        displayId: (p as any).display_id || undefined,
        seller: dbSellerNameMap[p.seller_id] || authUser?.name || "Unknown",
        sku: p.sku,
        name: p.name,
        image: p.image_url || "",
        price: Number((p as any).landed_price) || 0,
        totalQty: p.quantity || 0,
        delivered: orderStats.delivered,
        shipped: orderStats.shipped,
        available: availableQty,
        createdAt: p.created_at,
        variants: mappedVariants,
        storeLink: p.product_url || "",
        videoLink: p.video_url || "",
        lastSellingPrice: Number(p.price) || 0,
        lastPrice: Number((p as any).last_price) || 0,
        offers: ((p as any).offers || []).map((o: any, idx: number) => ({ id: `OFF-${idx}`, quantity: o.quantity || 1, price: o.price || 0 })),
        weight: (p as any).weight || undefined,
        weightKg: (p as any).weight_kg ?? null,
        active: (p as any).active ?? false,
      };
    });
    // Sellers only see DB products, admins see both
    return isAdmin ? [...dbMapped, ...localProducts] : dbMapped;
  }, [dbProducts, dbSellerNameMap, localProducts, isAdmin, authUser, productOrderStatsMap]);

  // Mark unseen products as seen for sellers
  useEffect(() => {
    if (!isSeller || dbProducts.length === 0) return;
    const unseenIds = dbProducts.filter(p => p.seller_seen === false).map(p => p.id);
    if (unseenIds.length === 0) return;
    const markSeen = async () => {
      await supabase.from("products").update({ seller_seen: true }).in("id", unseenIds);
      queryClient.invalidateQueries({ queryKey: ["seller-product-unseen"] });
    };
    markSeen();
  }, [isSeller, dbProducts, queryClient]);

  // Set of DB product IDs missing required links
  const missingLinksIds = useMemo(() => {
    const set = new Set<string>();
    dbProducts.forEach(p => {
      if (!p.product_url || !p.video_url) set.add(p.id);
    });
    return set;
  }, [dbProducts]);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);

  // Filters
  const [filterSeller, setFilterSeller] = useState("all");
  const [appliedSeller, setAppliedSeller] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [appliedStatus, setAppliedStatus] = useState("all");

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Build seller options from DB products (admin only)
  const sellerOptions = useMemo(() => {
    if (!isAdmin) return [];
    const sellers = new Set<string>();
    products.forEach(p => sellers.add(p.seller));
    return [...sellers].sort().map(s => ({ value: s, label: s }));
  }, [products, isAdmin]);

  const applyFilters = useCallback(() => {
    setAppliedSeller(filterSeller);
    setAppliedStatus(filterStatus);
    setCurrentPage(1);
  }, [filterSeller, filterStatus]);

  const clearFilters = useCallback(() => {
    setFilterSeller("all");
    setAppliedSeller("all");
    setFilterStatus("all");
    setAppliedStatus("all");
    setSearch("");
    setCurrentPage(1);
  }, []);

  const activeFilterCount = useMemo(() => {
    let c = 0;
    if (appliedSeller !== "all") c++;
    if (appliedStatus !== "all") c++;
    return c;
  }, [appliedSeller, appliedStatus]);

  const filtered = useMemo(() => {
    return products.filter((p) => {
      if (appliedSeller !== "all" && p.seller !== appliedSeller) return false;
      if (appliedStatus !== "all") {
        const isActive = !!(p as any).active;
        if (appliedStatus === "active" && !isActive) return false;
        if (appliedStatus === "inactive" && isActive) return false;
      }
      if (search) {
        const s = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(s) ||
          p.sku.toLowerCase().includes(s) ||
          p.id.toLowerCase().includes(s) ||
          (p.displayId && p.displayId.toLowerCase().includes(s))
        );
      }
      return true;
    });
  }, [products, appliedSeller, appliedStatus, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useMemo(() => {
    setCurrentPage(1);
  }, [search, appliedSeller, appliedStatus, pageSize]);

  const handleCreate = (product: Product) => {
    setLocalProducts((prev) => [product, ...prev]);
  };

  const handleEdit = (updated: Product) => {
    setLocalProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between animate-fade-in">
          <div>
            <h1 className="text-2xl font-semibold">Products</h1>
            <p className="text-muted-foreground text-sm mt-0.5">Manage your products</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search by name or SKU..."
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
            {isAdmin && (
              <Button size="sm" className="h-9 gap-1.5" onClick={() => setCreateOpen(true)}>
                <Plus className="w-3.5 h-3.5" />
                Create Product
              </Button>
            )}
          </div>
        </div>

        {/* Filter Panel */}
        {showFilters && (
          <div className="bg-card rounded-lg border p-4 animate-fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {isAdmin && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Seller</label>
                  <SearchableSelect
                    value={filterSeller}
                    onValueChange={setFilterSeller}
                    options={sellerOptions}
                    placeholder="Seller"
                    allLabel="All Sellers"
                    className="w-full"
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button size="sm" className="h-9 px-4" onClick={applyFilters}>
                  Apply
                </Button>
                <Button variant="outline" size="sm" className="h-9 px-3" onClick={clearFilters}>
                  Clear
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Table Card */}
        <div className="bg-card rounded-lg border animate-slide-up" style={{ animationDelay: "100ms" }}>
          {/* Toolbar */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b">
            <div className="flex items-center gap-3">
              <p className="text-sm font-medium">
                {filtered.length}{" "}
                <span className="text-muted-foreground font-normal">
                  product{filtered.length !== 1 ? "s" : ""}
                </span>
              </p>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Show</span>
                <Select value={String(pageSize)} onValueChange={(v) => setPageSize(Number(v))}>
                  <SelectTrigger className="h-7 w-[70px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((n) => (
                      <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">per page</span>
              </div>
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 px-4">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Package className="w-7 h-7 text-muted-foreground" />
              </div>
              <h3 className="text-sm font-semibold mb-1">No products found</h3>
              <p className="text-xs text-muted-foreground mb-4">
                Try adjusting your search or filters
              </p>
              {isAdmin && (
                <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                  <Plus className="w-3.5 h-3.5" />
                  Create Product
                </Button>
              )}
            </div>
          ) : (
            <>
              {/* Desktop */}
              <div className="overflow-x-auto hidden md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left py-2.5 px-4 font-medium text-xs text-muted-foreground uppercase tracking-wider">ID</th>
                      <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Created</th>
                      <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Image</th>
                      <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Seller</th>
                      <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">SKU</th>
                      <th className="text-left py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Name</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Buying Price</th>
                      <th className="text-right py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Selling Price</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Total Qty</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Delivered</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Shipped</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Available</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Weight</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider">Variants</th>
                      <th className="text-center py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider w-[60px]">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginated.map((product) => {
                      const isMissingLinks = missingLinksIds.has(product.id);
                      return (
                      <tr
                        key={product.id}
                        className={`border-b last:border-b-0 transition-colors ${isMissingLinks ? "bg-destructive/5 hover:bg-destructive/10" : "hover:bg-muted/30"}`}
                        title={isMissingLinks ? "Missing required links (Product Link / Video Link)" : undefined}
                      >
                        <td className="py-2 px-4 font-mono text-xs text-muted-foreground">{product.displayId || product.id.slice(0, 8)}</td>
                        <td className="py-2 px-3 text-xs text-muted-foreground whitespace-nowrap">
                          {format(new Date(product.createdAt), "dd MMM yyyy")}
                        </td>
                        <td className="py-2 px-3">
                          {product.image ? (
                            <img
                              src={product.image}
                              alt={product.name}
                              className="w-9 h-9 rounded-md object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center">
                              <ImageOff className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">{product.seller}</td>
                        <td className="py-2 px-3 font-mono text-xs">{product.sku}</td>
                        <td className="py-2 px-3 text-xs font-medium max-w-[160px] truncate">{product.name}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            (product as any).active
                              ? "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20"
                              : "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20"
                          }`}>
                            {(product as any).active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums text-xs font-medium">${product.price}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-xs font-medium">${product.lastSellingPrice}</td>
                        <td className="py-2 px-3 text-center tabular-nums text-xs">{product.totalQty}</td>
                        <td className="py-2 px-3 text-center">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20">
                            {product.delivered}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20">
                            {product.shipped}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                            product.available > 0
                              ? "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20"
                              : "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20"
                          }`}>
                            {product.available}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          {product.weightKg ? (
                            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
                              {product.weightKg} KG
                            </span>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {product.variants.length > 0 ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium bg-[hsl(270,50%,55%)]/12 text-[hsl(270,50%,55%)] border-[hsl(270,50%,55%)]/20 cursor-default">
                                  <Layers className="h-2.5 w-2.5" />
                                  {product.variants.length}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="text-xs">
                                {product.variants.map(v => v.name).join(', ')}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-info hover:bg-info/10"
                                  onClick={() => navigate(`/products/${product.id}`)}
                                >
                                  <Eye className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>View insights</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-warning hover:bg-warning/10"
                                  onClick={() => setEditProduct(product)}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Edit product</TooltipContent>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y">
                {paginated.map((product) => (
                  <div key={product.id} className="p-4 flex gap-3">
                    {product.image ? (
                      <img
                        src={product.image}
                        alt={product.name}
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <ImageOff className="w-5 h-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-medium truncate">{product.name}</p>
                          <p className="text-xs text-muted-foreground">{product.displayId ? `${product.displayId} · ` : ''}{product.seller} · {product.sku}</p>
                          <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-medium mt-0.5 ${
                            (product as any).active
                              ? "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20"
                              : "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20"
                          }`}>
                            {(product as any).active ? "Active" : "Inactive"}
                          </span>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-warning hover:bg-warning/10 shrink-0"
                          onClick={() => setEditProduct(product)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-xs">
                        <span className="font-medium">{product.price}</span>
                        <span className="text-muted-foreground">Selling: {product.lastSellingPrice}</span>
                        <span className="text-muted-foreground">Qty: {product.totalQty}</span>
                        <span className="text-muted-foreground">Avail: {product.available}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-4 py-2.5 border-t">
                  <span className="text-xs text-muted-foreground">
                    {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === 1} onClick={() => setCurrentPage(1)}>
                      <ChevronsLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <span className="text-xs px-2 text-muted-foreground">
                      Page {currentPage}/{totalPages}
                    </span>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="icon" className="h-7 w-7" disabled={currentPage === totalPages} onClick={() => setCurrentPage(totalPages)}>
                      <ChevronsRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modals */}
        <CreateProductModal open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
        <EditProductModal product={editProduct} open={!!editProduct} onOpenChange={(v) => { if (!v) setEditProduct(null); }} onSave={handleEdit} />
      </div>
    </TooltipProvider>
  );
}
