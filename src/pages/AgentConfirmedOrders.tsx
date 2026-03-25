import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { mockOrders } from "@/lib/data";
import { cn } from "@/lib/utils";
import { CheckCircle2, Search, Package, MapPin } from "lucide-react";
import { format } from "date-fns";

const statusBadge: Record<string, { label: string; className: string }> = {
  confirmed: { label: "✅ Confirmed", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  shipped: { label: "📦 Shipped", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  delivered: { label: "🎉 Delivered", className: "bg-primary/10 text-primary border-primary/20" },
  cancelled: { label: "❌ Cancelled", className: "bg-destructive/10 text-destructive border-destructive/20" },
  postponed: { label: "⏰ Postponed", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  no_answer: { label: "📞 No Answer", className: "bg-muted text-muted-foreground border-border" },
  returned: { label: "↩️ Returned", className: "bg-destructive/10 text-destructive border-destructive/20" },
  in_transit: { label: "🚚 In Transit", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  with_courier: { label: "🏍️ With Courier", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
};

const AgentConfirmedOrders = () => {
  const [search, setSearch] = useState("");

  // All non-"new" orders (orders that have been treated)
  const treatedOrders = useMemo(() => {
    return mockOrders
      .filter((o) => o.confirmationStatus !== "new")
      .filter((o) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          o.id.toLowerCase().includes(q) ||
          o.customer.toLowerCase().includes(q) ||
          o.city.toLowerCase().includes(q) ||
          o.phone.includes(q)
        );
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [search]);

  return (
    <div className="p-4 md:p-6 max-w-[1200px] mx-auto space-y-5">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-primary" />
            Confirmed Orders
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            All orders you've processed — {treatedOrders.length} total
          </p>
        </div>
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search orders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 text-xs pl-9"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-[11px] w-[100px]">Order ID</TableHead>
                  <TableHead className="text-[11px]">Customer</TableHead>
                  <TableHead className="text-[11px]">City</TableHead>
                  <TableHead className="text-[11px]">Products</TableHead>
                  <TableHead className="text-[11px] text-right">Total</TableHead>
                  <TableHead className="text-[11px]">Status</TableHead>
                  <TableHead className="text-[11px]">Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {treatedOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-12">
                      No orders found
                    </TableCell>
                  </TableRow>
                ) : (
                  treatedOrders.map((order) => {
                    const badge = statusBadge[order.status] || { label: order.status, className: "bg-muted text-muted-foreground" };
                    return (
                      <TableRow key={order.id} className="text-xs">
                        <TableCell className="font-mono font-semibold text-primary">{order.id}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{order.customer}</p>
                            <p className="text-[10px] text-muted-foreground">{order.phone}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-muted-foreground" /> {order.city}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            {order.products.map((p, i) => (
                              <span key={i} className="inline-flex items-center gap-1 text-[11px]">
                                <Package className="h-3 w-3 text-muted-foreground" /> {p.name} ×{p.qty}
                              </span>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{order.total} MAD</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px]", badge.className)}>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(new Date(order.updatedAt), "dd/MM/yy HH:mm")}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AgentConfirmedOrders;
