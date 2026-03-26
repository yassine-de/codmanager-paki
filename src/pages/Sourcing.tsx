import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ExternalLink, Pencil, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Package2, Plus, Loader2, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EditSourcingModal } from "@/components/EditSourcingModal";
import { CreateSourcingModal } from "@/components/CreateSourcingModal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const statusConfig: Record<string, { label: string; color: string }> = {
  waiting_quote: { label: "Waiting Quote", color: "bg-warning/15 text-warning border-warning/25" },
  quoted: { label: "Quoted", color: "bg-info/15 text-info border-info/25" },
  validated: { label: "Validated", color: "bg-success/15 text-success border-success/25" },
  cancelled: { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/25" },
  ordered: { label: "Ordered", color: "bg-primary/15 text-primary border-primary/25" },
  shipped: { label: "Shipped", color: "bg-primary/15 text-primary border-primary/25" },
  received: { label: "Received", color: "bg-success/15 text-success border-success/25" },
};

const paymentConfig: Record<string, { label: string; color: string }> = {
  unpaid: { label: "Unpaid", color: "bg-destructive/15 text-destructive border-destructive/25" },
  paid: { label: "Paid", color: "bg-success/15 text-success border-success/25" },
};

const validationConfig: Record<string, { label: string; color: string }> = {
  validated: { label: "Validated", color: "bg-success/15 text-success border-success/25" },
  cancelled: { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/25" },
  pending: { label: "Pending", color: "bg-muted text-muted-foreground border-border" },
};

const weightConfig: Record<string, { label: string; short: string }> = {
  up_to_1kg: { label: "Up to 1kg", short: "≤1kg" },
  up_to_2kg: { label: "Up to 2kg", short: "≤2kg" },
  up_to_3kg: { label: "Up to 3kg", short: "≤3kg" },
  more_than_3kg: { label: "More than 3kg", short: ">3kg" },
};

export interface DbSourcingRequest {
  id: string;
  seller_id: string;
  product_name: string;
  quantity: number;
  destination_country: string;
  shipping_method: string;
  product_url: string;
  notes: string | null;
  status: string;
  unit_price: number | null;
  shipping_cost: number | null;
  total_price: number | null;
  landed_price: number | null;
  seller_price: number | null;
  product_image_url: string | null;
  seller_validated: boolean | null;
  admin_seen: boolean | null;
  product_created: boolean | null;
  product_weight: string | null;
  payment_status: string;
  payment_method: string | null;
  payment_date: string | null;
  created_at: string;
  updated_at: string;
}

export default function Sourcing() {
  const queryClient = useQueryClient();
  const [sellerFilter, setSellerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [validationFilter, setValidationFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editRequest, setEditRequest] = useState<DbSourcingRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["admin-sourcing"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DbSourcingRequest[];
    },
  });

  // Mark unseen requests as seen when admin views the page
  useEffect(() => {
    if (requests.length === 0) return;
    const unseenIds = requests.filter(r => r.admin_seen === false).map(r => r.id);
    if (unseenIds.length === 0) return;
    const markSeen = async () => {
      await supabase
        .from("sourcing_requests")
        .update({ admin_seen: true })
        .in("id", unseenIds);
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing-unseen"] });
    };
    markSeen();
  }, [requests, queryClient]);

  const sellerIds = useMemo(() => [...new Set(requests.map(r => r.seller_id))], [requests]);
  const { data: sellerProfiles = [] } = useQuery({
    queryKey: ["seller-profiles", sellerIds],
    queryFn: async () => {
      if (sellerIds.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", sellerIds);
      if (error) throw error;
      return data;
    },
    enabled: sellerIds.length > 0,
  });

  const sellerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    sellerProfiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [sellerProfiles]);

  const sellerOptions = useMemo(() => {
    return sellerIds.map(id => ({
      value: id,
      label: sellerNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [sellerIds, sellerNameMap]);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (sellerFilter !== "all" && r.seller_id !== sellerFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (validationFilter === "validated" && r.seller_validated !== true) return false;
      if (validationFilter === "cancelled" && r.seller_validated !== false) return false;
      if (validationFilter === "pending" && r.seller_validated !== null) return false;
      return true;
    });
  }, [requests, sellerFilter, statusFilter, validationFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const shippingLabel = (m: string) => m === "air" ? "By Air ✈️" : "By Sea 🚢";

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Sourcing</h1>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <SearchableSelect
          value={sellerFilter}
          onValueChange={v => { setSellerFilter(v); setPage(1); }}
          options={sellerOptions}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[160px]"
        />
        <SearchableSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1); }}
          options={Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label }))}
          placeholder="Status"
          allLabel="All Status"
          className="w-[150px]"
        />
        <SearchableSelect
          value={validationFilter}
          onValueChange={v => { setValidationFilter(v); setPage(1); }}
          options={[
            { value: "validated", label: "Validated" },
            { value: "cancelled", label: "Cancelled" },
            { value: "pending", label: "Pending" },
          ]}
          placeholder="Validation"
          allLabel="All Validation"
          className="w-[150px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} requests</span>
          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-[80px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-center">Weight</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total Price</TableHead>
              <TableHead>Country</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Validation</TableHead>
              <TableHead className="text-center">Payment</TableHead>
              <TableHead>Payment Date</TableHead>
              <TableHead className="text-center">Link</TableHead>
              <TableHead className="text-center w-[70px]">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.length === 0 ? (
              <TableRow>
                <TableCell colSpan={15} className="text-center py-10 text-muted-foreground text-sm">
                  No sourcing requests found.
                </TableCell>
              </TableRow>
            ) : (
              paginated.map(req => {
                const sConfig = statusConfig[req.status] || statusConfig.waiting_quote;
                const vKey = req.seller_validated === true ? "validated" : req.seller_validated === false ? "cancelled" : "pending";
                const vConfig = validationConfig[vKey];
                const isReceivedNoProduct = req.status === "received" && req.product_created === false;

                return (
                  <TableRow key={req.id} className={`text-xs ${isReceivedNoProduct ? "bg-destructive/5 hover:bg-destructive/10" : ""}`}>
                    <TableCell className="pr-0">
                      {req.product_image_url ? (
                        <img src={req.product_image_url} alt="" className="w-8 h-8 rounded object-cover border" />
                      ) : (
                        <div className="w-8 h-8 rounded border bg-muted/30 flex items-center justify-center">
                          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(req.created_at), "dd MMM yyyy")}
                    </TableCell>
                    <TableCell className="font-medium max-w-[140px] truncate">{req.product_name}</TableCell>
                    <TableCell className="text-muted-foreground">{sellerNameMap[req.seller_id] || "—"}</TableCell>
                    <TableCell className="text-center tabular-nums">{req.quantity}</TableCell>
                    <TableCell className="text-center">
                      {req.product_weight ? (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium bg-accent text-accent-foreground">
                          {weightConfig[req.product_weight]?.short || "—"}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(req.unit_price ?? 0) > 0 ? `${req.unit_price} MAD` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(req.total_price ?? 0) > 0 ? `${req.total_price} MAD` : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{req.destination_country}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sConfig.color}`}>
                        {sConfig.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${vConfig.color}`}>
                        {vConfig.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const pConfig = paymentConfig[req.payment_status] || paymentConfig.unpaid;
                        const methodLabel = req.payment_method === 'from_invoice' ? 'Invoice' : req.payment_method === 'binance' ? 'Binance' : req.payment_method === 'wise' ? 'Wise' : req.payment_method === 'cih' ? 'CIH' : null;
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium cursor-default ${pConfig.color}`}>
                                {pConfig.label}{methodLabel ? ` · ${methodLabel}` : ''}
                              </span>
                            </TooltipTrigger>
                            {methodLabel && <TooltipContent>{`Paid via ${methodLabel}`}</TooltipContent>}
                          </Tooltip>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {req.payment_date ? format(new Date(req.payment_date), "dd MMM yyyy") : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a href={req.product_url} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-info hover:bg-info/10 transition-colors">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </TooltipTrigger>
                        <TooltipContent>Open product link</TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell className="text-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-warning hover:bg-warning/10" onClick={() => setEditRequest(req)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Edit request</TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(1)}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2 text-muted-foreground">Page {page}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(totalPages)}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <CreateSourcingModal open={createOpen} onOpenChange={setCreateOpen} />
      <EditSourcingModal
        request={editRequest}
        open={!!editRequest}
        onOpenChange={open => { if (!open) setEditRequest(null); }}
      />
    </div>
  );
}
