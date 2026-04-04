import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatUSD, pkrToUsd, formatPKR } from "@/lib/currency";
import { toast } from "sonner";
import { AlertTriangle, Check, X, Eye, ArrowUpDown } from "lucide-react";
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
  reason: string;
  status: string;
  applied_invoice_id: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

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

  const approveMutation = useMutation({
    mutationFn: async (adj: Adjustment) => {
      // Find seller's current open invoice to apply adjustment
      let openInvoiceId: string | null = null;
      const { data: openInv } = await supabase
        .from("invoices")
        .select("id")
        .eq("seller_id", adj.seller_id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (openInv) {
        openInvoiceId = openInv.id;
      } else {
        // Create a new open invoice
        const { data: newInv, error } = await supabase
          .from("invoices")
          .insert({ seller_id: adj.seller_id, status: "open" })
          .select("id")
          .single();
        if (error) throw error;
        openInvoiceId = newInv.id;
      }

      // Add as addon to the open invoice
      const { error: addonErr } = await supabase.from("invoice_addons").insert({
        invoice_id: openInvoiceId,
        type: adj.difference >= 0 ? "in" : "out",
        amount: Math.abs(adj.difference),
        reason: `Adjustment: ${adj.order_id} (${adj.old_status} → ${adj.new_status})`,
      });
      if (addonErr) throw addonErr;

      // Update adjustment status
      const { error: updErr } = await supabase
        .from("invoice_adjustments")
        .update({
          status: "approved",
          applied_invoice_id: openInvoiceId,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", adj.id);
      if (updErr) throw updErr;
    },
    onSuccess: () => {
      toast.success("Adjustment approved and applied to next invoice");
      queryClient.invalidateQueries({ queryKey: ["invoice-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["pending-adjustments-count"] });
      setSelectedAdj(null);
    },
    onError: () => toast.error("Failed to approve adjustment"),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("invoice_adjustments")
        .update({
          status: "rejected",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Adjustment rejected");
      queryClient.invalidateQueries({ queryKey: ["invoice-adjustments"] });
      queryClient.invalidateQueries({ queryKey: ["pending-adjustments-count"] });
      setSelectedAdj(null);
    },
    onError: () => toast.error("Failed to reject adjustment"),
  });

  const pendingCount = adjustments.filter(a => a.status === "pending").length;

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending": return <Badge variant="outline" className="bg-warning/10 text-warning border-warning/30 text-[10px]">Pending</Badge>;
      case "approved": return <Badge variant="outline" className="bg-success/10 text-success border-success/30 text-[10px]">Approved</Badge>;
      case "rejected": return <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 text-[10px]">Rejected</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

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
                <TableHead className="text-xs text-right">Difference</TableHead>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Status</TableHead>
                <TableHead className="text-xs text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">Loading...</TableCell></TableRow>
              ) : adjustments.length === 0 ? (
                <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-xs">No adjustments found</TableCell></TableRow>
              ) : adjustments.map((adj) => (
                <TableRow key={adj.id} className="text-xs">
                  <TableCell className="font-mono font-semibold">{adj.order_id}</TableCell>
                  <TableCell>{sellerMap[adj.seller_id] || "Unknown"}</TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{adj.old_status}</Badge></TableCell>
                  <TableCell><Badge variant="outline" className="text-[10px]">{adj.new_status}</Badge></TableCell>
                  <TableCell className={`text-right tabular-nums font-semibold ${adj.difference >= 0 ? "text-success" : "text-destructive"}`}>
                    {adj.difference >= 0 ? "+" : ""}{formatUSD(adj.difference)}
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
              ))}
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
            <div className="space-y-4">
              {/* Order Info */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-muted-foreground">Order ID</span>
                  <p className="font-mono font-semibold">{selectedAdj.order_id}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Seller</span>
                  <p className="font-semibold">{sellerMap[selectedAdj.seller_id] || "Unknown"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Reason</span>
                  <p className="font-semibold capitalize">{selectedAdj.reason.replace(/_/g, " ")}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Date</span>
                  <p className="font-semibold">{format(new Date(selectedAdj.created_at), "dd/MM/yyyy HH:mm")}</p>
                </div>
              </div>

              {/* Status Change */}
              <Card>
                <CardContent className="py-3 px-4">
                  <p className="text-xs font-semibold mb-2">Status Change</p>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge variant="outline" className="bg-muted">{selectedAdj.old_status}</Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="outline" className="bg-primary/10 text-primary">{selectedAdj.new_status}</Badge>
                  </div>
                </CardContent>
              </Card>

              {/* Financial Impact */}
              <Card>
                <CardContent className="py-3 px-4 space-y-2">
                  <p className="text-xs font-semibold mb-2">Financial Impact</p>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Previous Amount (PKR)</span>
                    <span className="tabular-nums">{formatPKR(selectedAdj.previous_amount)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">New Amount (PKR)</span>
                    <span className="tabular-nums">{formatPKR(selectedAdj.new_amount)}</span>
                  </div>
                  <div className="border-t pt-2 flex justify-between text-xs font-bold">
                    <span>Difference (USD)</span>
                    <span className={`tabular-nums ${selectedAdj.difference >= 0 ? "text-success" : "text-destructive"}`}>
                      {selectedAdj.difference >= 0 ? "+" : ""}{formatUSD(pkrToUsd(selectedAdj.difference))}
                    </span>
                  </div>
                </CardContent>
              </Card>

              {/* Status */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">Status:</span>
                  {statusBadge(selectedAdj.status)}
                </div>
                {selectedAdj.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10 h-8 text-xs" onClick={() => rejectMutation.mutate(selectedAdj.id)}>
                      <X className="h-3 w-3 mr-1" /> Reject
                    </Button>
                    <Button size="sm" className="bg-success hover:bg-success/90 h-8 text-xs" onClick={() => approveMutation.mutate(selectedAdj)}>
                      <Check className="h-3 w-3 mr-1" /> Approve
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
