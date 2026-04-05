import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatPKR } from "@/lib/currency";
import { toast } from "sonner";
import { AlertTriangle, Check, X, Eye, ArrowUpDown, Truck } from "lucide-react";
import { format } from "date-fns";

interface Adjustment {
  id: string;
  order_id: string;
  seller_id: string;
  invoice_id: string | null;
  old_status: string;
  new_status: string;
  previous_amount: number;
  new_amount: number;
  difference: number;
  previous_shipping_fee: number;
  new_shipping_fee: number;
  shipping_difference: number;
  reason: string;
  status: string;
  applied_invoice_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

const statusBadge = (status: string) => {
  switch (status) {
    case "pending": return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px]">Pending</Badge>;
    case "approved": return <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-[10px]">Approved</Badge>;
    case "rejected": return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]">Rejected</Badge>;
    default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
};

export default function Adjustments() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedAdj, setSelectedAdj] = useState<Adjustment | null>(null);

  const { data: adjustments = [], isLoading } = useQuery({
    queryKey: ["invoice-adjustments", statusFilter],
    queryFn: async () => {
      let q = supabase
        .from("invoice_adjustments")
        .select("*")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") q = q.eq("status", statusFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as Adjustment[];
    },
  });

  const { data: profiles = [] } = useQuery({
    queryKey: ["all-profiles-adj"],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("user_id, name");
      return data || [];
    },
  });

  const sellerMap: Record<string, string> = {};
  profiles.forEach((p: any) => { sellerMap[p.user_id] = p.name; });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["invoice-adjustments"] });
    queryClient.invalidateQueries({ queryKey: ["pending-adjustments-count"] });
    queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
  };

  const approveMutation = useMutation({
    mutationFn: async (adj: Adjustment) => {
      const { data, error } = await supabase.rpc("approve_invoice_adjustment", { p_adjustment_id: adj.id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Adjustment approved and applied to next invoice"); invalidateAll(); setSelectedAdj(null); },
    onError: () => toast.error("Failed to approve adjustment"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("reject_invoice_adjustment", { p_adjustment_id: id });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Adjustment rejected"); invalidateAll(); setSelectedAdj(null); },
    onError: () => toast.error("Failed to reject adjustment"),
  });

  const pendingCount = adjustments.filter(a => a.status === "pending").length;

  const getTotalDiff = (adj: Adjustment) => adj.difference + (adj.shipping_difference || 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Adjustments</h1>
          {pendingCount > 0 && (
            <Badge className="bg-warning text-warning-foreground">{pendingCount} pending</Badge>
          )}
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Alert banner */}
      {pendingCount > 0 && (
        <Card className="border-warning/50 bg-warning/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div>
              <p className="text-sm font-semibold text-warning">⚠️ {pendingCount} Adjustment{pendingCount > 1 ? "s" : ""} Pending Review</p>
              <p className="text-xs text-muted-foreground">Order status changes detected on closed invoices. Please review and approve or reject.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="text-xs">Order ID</TableHead>
                <TableHead className="text-xs">Seller</TableHead>
                <TableHead className="text-xs">Old Status</TableHead>
                <TableHead className="text-xs">New Status</TableHead>
                <TableHead className="text-xs text-right">Revenue Δ</TableHead>
                <TableHead className="text-xs text-right">Shipping Δ</TableHead>
                <TableHead className="text-xs text-right">Total Δ</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-xs">Loading...</TableCell></TableRow>
              ) : adjustments.length === 0 ? (
                <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-xs">No adjustments found</TableCell></TableRow>
              ) : adjustments.map((adj) => {
                const totalDiff = getTotalDiff(adj);
                const shippingDiff = adj.shipping_difference || 0;
                return (
                  <TableRow key={adj.id} className="text-xs">
                    <TableCell className="font-mono font-semibold">{adj.order_id}</TableCell>
                    <TableCell>{sellerMap[adj.seller_id] || "Unknown"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{adj.old_status}</Badge></TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px]">{adj.new_status}</Badge></TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${adj.difference >= 0 ? "text-success" : "text-destructive"}`}>
                      {adj.difference !== 0 ? (adj.difference >= 0 ? "+" : "") + formatPKR(adj.difference) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${shippingDiff >= 0 ? "text-success" : "text-destructive"}`}>
                      {shippingDiff !== 0 ? (
                        <span className="flex items-center justify-end gap-1">
                          <Truck className="h-3 w-3" />
                          {shippingDiff >= 0 ? "+" : ""}{formatPKR(shippingDiff)}
                        </span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-bold ${totalDiff >= 0 ? "text-success" : "text-destructive"}`}>
                      {totalDiff !== 0 ? (totalDiff >= 0 ? "+" : "") + formatPKR(totalDiff) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{format(new Date(adj.created_at), "dd/MM/yy HH:mm")}</TableCell>
                    <TableCell>{statusBadge(adj.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center gap-1 justify-end">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setSelectedAdj(adj)}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {adj.status === "pending" && (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-success hover:text-success" onClick={() => approveMutation.mutate(adj)}>
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => rejectMutation.mutate(adj.id)}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Detail Modal */}
      <Dialog open={!!selectedAdj} onOpenChange={(o) => !o && setSelectedAdj(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ArrowUpDown className="h-4 w-4 text-primary" />
              Adjustment Detail
            </DialogTitle>
          </DialogHeader>
          {selectedAdj && (
            <AdjustmentDetail
              adj={selectedAdj}
              sellerMap={sellerMap}
              onApprove={() => approveMutation.mutate(selectedAdj)}
              onReject={() => rejectMutation.mutate(selectedAdj.id)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdjustmentDetail({ adj, sellerMap, onApprove, onReject }: {
  adj: Adjustment;
  sellerMap: Record<string, string>;
  onApprove: () => void;
  onReject: () => void;
}) {
  const shippingDiff = adj.shipping_difference || 0;
  const totalDiff = adj.difference + shippingDiff;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <span className="text-muted-foreground">Order ID</span>
          <p className="font-mono font-semibold">{adj.order_id}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Seller</span>
          <p className="font-semibold">{sellerMap[adj.seller_id] || "Unknown"}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Reason</span>
          <p className="font-semibold capitalize">{adj.reason.replace(/_/g, " ")}</p>
        </div>
        <div>
          <span className="text-muted-foreground">Date</span>
          <p className="font-semibold">{format(new Date(adj.created_at), "dd/MM/yyyy HH:mm")}</p>
        </div>
      </div>

      {/* Status Change */}
      <Card>
        <CardContent className="py-3 px-4">
          <p className="text-xs font-semibold mb-2">Status Change</p>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="bg-muted">{adj.old_status}</Badge>
            <span className="text-muted-foreground">→</span>
            <Badge variant="outline" className="bg-primary/10 text-primary">{adj.new_status}</Badge>
          </div>
        </CardContent>
      </Card>

      {/* Revenue Impact */}
      <Card>
        <CardContent className="py-3 px-4 space-y-2">
          <p className="text-xs font-semibold mb-2">Revenue Impact</p>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Previous Amount (PKR)</span>
            <span className="tabular-nums">{formatPKR(adj.previous_amount)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">New Amount (PKR)</span>
            <span className="tabular-nums">{formatPKR(adj.new_amount)}</span>
          </div>
          <div className="border-t pt-2 flex justify-between text-xs font-bold">
            <span>Revenue Δ (PKR)</span>
            <span className={`tabular-nums ${adj.difference >= 0 ? "text-success" : "text-destructive"}`}>
              {adj.difference >= 0 ? "+" : ""}{formatPKR(adj.difference)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Shipping Impact - only show if non-zero */}
      {shippingDiff !== 0 && (
        <Card className="border-primary/20">
          <CardContent className="py-3 px-4 space-y-2">
            <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5 text-primary" />
              Shipping Fee Impact
            </p>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Previous Shipping Fee</span>
              <span className="tabular-nums">{formatPKR(adj.previous_shipping_fee)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">New Shipping Fee</span>
              <span className="tabular-nums">{formatPKR(adj.new_shipping_fee)}</span>
            </div>
            <div className="border-t pt-2 flex justify-between text-xs font-bold">
              <span>Shipping Δ</span>
              <span className={`tabular-nums ${shippingDiff >= 0 ? "text-success" : "text-destructive"}`}>
                {shippingDiff >= 0 ? "+" : ""}{formatPKR(shippingDiff)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Total */}
      {(adj.difference !== 0 || shippingDiff !== 0) && (
        <Card className="bg-muted/50">
          <CardContent className="py-3 px-4">
            <div className="flex justify-between text-xs font-bold">
              <span>Total Adjustment (PKR)</span>
              <span className={`tabular-nums text-sm ${totalDiff >= 0 ? "text-success" : "text-destructive"}`}>
                {totalDiff >= 0 ? "+" : ""}{formatPKR(totalDiff)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Status & Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Status:</span>
          {statusBadge(adj.status)}
        </div>
        {adj.status === "pending" && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8 text-xs" onClick={onReject}>
              <X className="h-3 w-3 mr-1" /> Reject
            </Button>
            <Button size="sm" className="bg-success hover:bg-success/90 h-8 text-xs" onClick={onApprove}>
              <Check className="h-3 w-3 mr-1" /> Approve
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
