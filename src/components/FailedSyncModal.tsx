import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";

interface FailedSyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function FailedSyncModal({ open, onOpenChange }: FailedSyncModalProps) {
  const navigate = useNavigate();

  const { data: failedOrders = [], isLoading } = useQuery({
    queryKey: ["failed-sync-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("order_id, customer_name, customer_city, orio_sync_error, updated_at, confirmation_status")
        .eq("orio_sync_status", "failed")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
    refetchInterval: open ? 15_000 : false,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-hidden flex flex-col">
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
                  <TableHead className="text-xs">Kunde</TableHead>
                  <TableHead className="text-xs">Stadt</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Fehler</TableHead>
                  <TableHead className="text-xs">Datum</TableHead>
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
