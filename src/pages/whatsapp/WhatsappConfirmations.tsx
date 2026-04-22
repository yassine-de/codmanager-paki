import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";

export default function WhatsappConfirmations() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["wts-confirmations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("order_id, customer_name, customer_phone, product_name, total_amount, confirmation_status, confirmation_channel, whatsapp_status, whatsapp_last_sent_at, whatsapp_last_reply_at, created_at")
        .or("confirmation_status.eq.new_wts,confirmation_channel.eq.whatsapp")
        .order("created_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">WhatsApp confirmation pipeline</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">No WhatsApp orders yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>WhatsApp</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Reply</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r: any) => (
                <TableRow key={r.order_id}>
                  <TableCell className="font-mono text-xs">{r.order_id}</TableCell>
                  <TableCell className="text-sm">
                    <div>{r.customer_name}</div>
                    <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.product_name}</TableCell>
                  <TableCell className="text-sm">{r.total_amount}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">{r.confirmation_status}</Badge>
                  </TableCell>
                  <TableCell>
                    {r.whatsapp_status ? (
                      <Badge variant="secondary" className="text-[10px]">{r.whatsapp_status}</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.whatsapp_last_sent_at ? format(new Date(r.whatsapp_last_sent_at), "MMM d HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.whatsapp_last_reply_at ? format(new Date(r.whatsapp_last_reply_at), "MMM d HH:mm") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
