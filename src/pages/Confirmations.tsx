import { mockOrders } from "@/lib/data";
import { StatusBadge } from "@/components/StatusBadge";
import { useNavigate } from "react-router-dom";
import { Phone, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Confirmations() {
  const navigate = useNavigate();
  const pendingOrders = mockOrders
    .filter(o => o.status === 'pending')
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Confirmations</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {pendingOrders.length} orders awaiting confirmation
        </p>
      </div>

      {pendingOrders.length === 0 ? (
        <div className="bg-card rounded-lg border p-12 text-center animate-slide-up">
          <p className="text-muted-foreground">All caught up! No pending orders.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingOrders.map((order, i) => (
            <div
              key={order.id}
              className="bg-card rounded-lg border p-5 space-y-3 animate-slide-up hover:shadow-md transition-shadow cursor-pointer"
              style={{ animationDelay: `${80 + i * 60}ms` }}
              onClick={() => navigate(`/orders/${order.id}`)}
            >
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">{order.id}</span>
                  <StatusBadge status={order.status} />
                </div>
                <span className="text-lg font-semibold tabular-nums">{order.total.toLocaleString()} PKR</span>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:gap-6 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{order.customer}</span>
                <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{order.phone}</span>
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{order.city}</span>
              </div>

              <div className="text-sm text-muted-foreground">
                {order.products.map(p => `${p.name} ×${p.qty}`).join(', ')}
              </div>

              <div className="flex gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
                <Button size="sm" className="active:scale-[0.97]">Confirm</Button>
                <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10 active:scale-[0.97]">
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
