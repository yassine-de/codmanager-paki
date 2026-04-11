import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Package2, Plus, Check, X, ExternalLink, Loader2, ImageIcon, Pencil } from "lucide-react";
import { SourcingVariantsBadge } from "@/components/SourcingVariantsBadge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchableSelect } from "@/components/SearchableSelect";
import { toast } from "sonner";
import { CreateSellerSourcingModal } from "@/components/CreateSellerSourcingModal";
import { EditSellerSourcingModal } from "@/components/EditSellerSourcingModal";

const paymentStatusConfig: Record<string, { label: string; color: string }> = {
  unpaid: { label: "Unpaid", color: "bg-destructive/15 text-destructive border-destructive/25" },
  paid: { label: "Paid", color: "bg-success/15 text-success border-success/25" },
  partial: { label: "Partial", color: "bg-warning/15 text-warning border-warning/25" },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  waiting_quote: { label: "Waiting Quote", color: "bg-warning/15 text-warning border-warning/25" },
  working_on_it: { label: "Working On It", color: "bg-orange-500/15 text-orange-600 border-orange-500/25" },
  quoted: { label: "Quoted", color: "bg-info/15 text-info border-info/25" },
  cancelled: { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/25" },
  ordered: { label: "Ordered", color: "bg-primary/15 text-primary border-primary/25" },
  shipped: { label: "Shipped", color: "bg-primary/15 text-primary border-primary/25" },
  received: { label: "Received", color: "bg-success/15 text-success border-success/25" },
};

const validationConfig: Record<string, { label: string; color: string }> = {
  validated: { label: "Validated", color: "bg-success/15 text-success border-success/25" },
  cancelled: { label: "Cancelled", color: "bg-destructive/15 text-destructive border-destructive/25" },
  pending: { label: "Pending", color: "bg-muted text-muted-foreground border-border" },
};

interface SourcingRequest {
  id: string;
  display_id: string | null;
  product_name: string;
  quantity: number;
  destination_country: string;
  shipping_method: string;
  product_url: string;
  notes: string | null;
  status: string;
  unit_price: number;
  shipping_cost: number;
  total_price: number;
  seller_price: number | null;
  product_image_url: string | null;
  seller_validated: boolean | null;
  seller_seen: boolean | null;
  created_at: string;
  variants: any[] | null;
  payment_status: string;
}

export default function SellerSourcing() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editRequest, setEditRequest] = useState<SourcingRequest | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [validationFilter, setValidationFilter] = useState("all");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["seller-sourcing", authUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as SourcingRequest[];
    },
    enabled: !!authUser,
  });

  // Mark unseen requests as seen when page loads
  useEffect(() => {
    if (!authUser || requests.length === 0) return;
    const unseenIds = requests.filter(r => r.seller_seen === false).map(r => r.id);
    if (unseenIds.length === 0) return;

    const markSeen = async () => {
      await supabase
        .from("sourcing_requests")
        .update({ seller_seen: true })
        .in("id", unseenIds);
      // Refresh the sidebar badge count
      queryClient.invalidateQueries({ queryKey: ["seller-sourcing-unseen"] });
    };
    markSeen();
  }, [authUser, requests, queryClient]);

  const filtered = useMemo(() => {
    return requests.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (validationFilter === "validated" && r.seller_validated !== true) return false;
      if (validationFilter === "cancelled" && r.seller_validated !== false) return false;
      if (validationFilter === "pending" && r.seller_validated !== null) return false;
      return true;
    });
  }, [requests, statusFilter, validationFilter]);

  const validateMutation = useMutation({
    mutationFn: async ({ id, validated }: { id: string; validated: boolean }) => {
      const { error } = await supabase
        .from("sourcing_requests")
        .update({
          seller_validated: validated,
          status: validated ? "validated" : "cancelled",
          updated_at: new Date().toISOString(),
          admin_seen: false,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, { validated }) => {
      queryClient.invalidateQueries({ queryKey: ["seller-sourcing"] });
      toast.success(validated ? "Request validated" : "Request cancelled");
    },
  });

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
          <h1 className="text-xl font-semibold text-foreground">My Sourcing</h1>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          Create Sourcing
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <SearchableSelect
          value={statusFilter}
          onValueChange={setStatusFilter}
          options={Object.entries(statusConfig).map(([k, v]) => ({ value: k, label: v.label }))}
          placeholder="Status"
          allLabel="All Status"
          className="w-[150px]"
        />
        <SearchableSelect
          value={validationFilter}
          onValueChange={setValidationFilter}
          options={[
            { value: "validated", label: "Validated" },
            { value: "cancelled", label: "Cancelled" },
            { value: "pending", label: "Pending" },
          ]}
          placeholder="Validation"
          allLabel="All Validation"
          className="w-[150px]"
        />
        <span className="ml-auto text-xs text-muted-foreground">{filtered.length} requests</span>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[40px]"></TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Product</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Shipping</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Validation</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Payment</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-center">Link</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={14} className="text-center py-10 text-muted-foreground text-sm">
                  No sourcing requests found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((req) => {
                const sConfig = statusConfig[req.status] || statusConfig.waiting_quote;
                const vKey = req.seller_validated === true ? "validated" : req.seller_validated === false ? "cancelled" : "pending";
                const vConfig = validationConfig[vKey];
                const canValidate = req.status === "quoted" && req.seller_validated === null;
                const isNew = req.seller_seen === false;

                return (
                  <TableRow key={req.id} className={`text-xs ${isNew ? "bg-primary/5" : ""}`}>
                    <TableCell className="pr-0">
                      {req.product_image_url ? (
                        <img src={req.product_image_url} alt="" className="w-8 h-8 rounded object-cover border" />
                      ) : (
                        <div className="w-8 h-8 rounded border bg-muted/30 flex items-center justify-center">
                          <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-[11px] text-muted-foreground whitespace-nowrap">
                      {req.display_id || req.id.slice(0, 8)}
                    </TableCell>
                    <TableCell className="font-medium max-w-[160px] truncate">
                      <div className="flex items-center gap-1.5">
                        {isNew && <span className="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0" />}
                        {req.product_name}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="tabular-nums">{req.quantity}</span>
                        <SourcingVariantsBadge variants={req.variants} />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{req.destination_country}</TableCell>
                    <TableCell className="text-muted-foreground">{shippingLabel(req.shipping_method)}</TableCell>
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
                    <TableCell className="text-right tabular-nums">
                      {(req.unit_price ?? 0) > 0 ? `$${req.unit_price}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {(req.total_price ?? 0) > 0 ? `$${req.total_price}` : "—"}
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const pKey = req.payment_status || "unpaid";
                        const pConfig = paymentStatusConfig[pKey] || paymentStatusConfig.unpaid;
                        return (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${pConfig.color}`}>
                            {pConfig.label}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {format(new Date(req.created_at), "dd MMM yyyy")}
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
                      <div className="flex items-center justify-center gap-1">
                        {/* Edit button - only before validation */}
                        {req.seller_validated === null && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                                onClick={() => setEditRequest(req)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                        )}
                        {canValidate && (
                          <>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-success hover:bg-success/10"
                                  onClick={() => validateMutation.mutate({ id: req.id, validated: true })}
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Validate</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                  onClick={() => validateMutation.mutate({ id: req.id, validated: false })}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Cancel</TooltipContent>
                            </Tooltip>
                          </>
                        )}
                        {!canValidate && req.seller_validated !== null && (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <CreateSellerSourcingModal open={createOpen} onOpenChange={setCreateOpen} />
      <EditSellerSourcingModal request={editRequest} open={!!editRequest} onOpenChange={(v) => { if (!v) setEditRequest(null); }} />
    </div>
  );
}
