import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ExternalLink, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";
import { CitySelect } from "@/components/CitySelect";

interface FailedSyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function FailedSyncModal({ open, onOpenChange }: FailedSyncModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const { data: failedOrders = [], isLoading } = useQuery({
    queryKey: ["failed-sync-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, customer_name, customer_city, orio_sync_error, updated_at, confirmation_status")
        .eq("orio_sync_status", "failed")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  const [updatingCityId, setUpdatingCityId] = useState<string | null>(null);

  const handleRetry = async (orderId: string, orderDbId: string) => {
    setRetryingId(orderId);
    try {
      // Reset sync status first so the edge function doesn't skip it
      await supabase
        .from("orders")
        .update({ orio_sync_status: "pending", orio_sync_error: null })
        .eq("order_id", orderId);

      const { data, error } = await supabase.functions.invoke("orio-sync", {
        body: { action: "sync-order", order_id: orderId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.skipped) {
        toast.info(data.reason || "Order skipped");
      } else {
        toast.success(`Order ${orderId} synced successfully`);
      }
      queryClient.invalidateQueries({ queryKey: ["failed-sync-orders"] });
      queryClient.invalidateQueries({ queryKey: ["system-failed-syncs"] });
    } catch (e: any) {
      toast.error(`Retry failed: ${e.message}`);
      queryClient.invalidateQueries({ queryKey: ["failed-sync-orders"] });
    } finally {
      setRetryingId(null);
    }
  };

  const handleCityChange = async (orderId: string, newCity: string) => {
    setUpdatingCityId(orderId);
    try {
      const { error } = await supabase
        .from("orders")
        .update({ customer_city: newCity })
        .eq("order_id", orderId);
      if (error) throw error;
      toast.success(`City updated to ${newCity}`);
      queryClient.invalidateQueries({ queryKey: ["failed-sync-orders"] });
      // Auto-retry sync since the most common failure is invalid city
      await handleRetry(orderId, orderId);
    } catch (e: any) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setUpdatingCityId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            ORIO Sync Errors ({failedOrders.length})
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-auto flex-1 -mx-6 px-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading...</p>
          ) : failedOrders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No failed syncs.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order ID</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">City</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Error</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs w-[60px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failedOrders.map((order) => (
                  <TableRow
                    key={order.order_id}
                    className="cursor-pointer hover:bg-muted/60"
                    onClick={() => {
                      onOpenChange(false);
                      navigate(`/orders?search=${order.order_id}`);
                    }}
                  >
                    <TableCell className="text-xs font-semibold">
                      <div className="flex items-center gap-1">
                        {order.order_id}
                        <ExternalLink className="w-3 h-3 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell className="text-xs">{order.customer_name}</TableCell>
                    <TableCell className="text-xs">{order.customer_city}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">
                        {order.confirmation_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-destructive max-w-[200px] truncate" title={order.orio_sync_error || ""}>
                      {order.orio_sync_error || "Unknown error"}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(order.updated_at), "dd.MM.yy HH:mm")}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        title="Retry sync"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(order.order_id, order.order_id);
                        }}
                        disabled={retryingId === order.order_id}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${retryingId === order.order_id ? "animate-spin" : ""}`} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
