import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, MapPin, Calendar, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { mockOrders } from "@/lib/data";
import { format } from "date-fns";

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const order = mockOrders.find(o => o.id === id);

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="outline" onClick={() => navigate('/orders')}>Back to orders</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="animate-fade-in">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold">{order.id}</h1>
          <StatusBadge status={order.status} />
        </div>
      </div>

      {/* Customer Info */}
      <div className="bg-card rounded-lg border p-5 space-y-4 animate-slide-up" style={{ animationDelay: '80ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer</h2>
        <div className="space-y-2.5">
          <p className="font-medium text-lg">{order.customer}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="w-4 h-4" /> {order.phone}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4" /> {order.address}, {order.city}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" /> Ordered {format(new Date(order.createdAt), 'dd MMM yyyy, HH:mm')}
          </div>
          {order.notes && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <StickyNote className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{order.notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Products */}
      <div className="bg-card rounded-lg border animate-slide-up" style={{ animationDelay: '160ms' }}>
        <div className="p-5 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Products</h2>
        </div>
        <div className="divide-y">
          {order.products.map((p, i) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-muted-foreground">Qty: {p.qty} × {p.price.toLocaleString()} MAD</p>
              </div>
              <p className="font-medium tabular-nums">{(p.qty * p.price).toLocaleString()} MAD</p>
            </div>
          ))}
        </div>
        <div className="p-4 border-t flex justify-between items-center bg-muted/30">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-semibold tabular-nums">{order.total.toLocaleString()} MAD</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-card rounded-lg border p-5 space-y-4 animate-slide-up" style={{ animationDelay: '240ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Timeline</h2>
        <div className="space-y-3">
          <TimelineItem label="Created" date={order.createdAt} />
          {order.confirmedAt && <TimelineItem label="Confirmed" date={order.confirmedAt} />}
          {order.shippedAt && <TimelineItem label="Shipped" date={order.shippedAt} />}
          {order.deliveredAt && <TimelineItem label="Delivered" date={order.deliveredAt} />}
          {order.status === 'cancelled' && <TimelineItem label="Cancelled" date={order.createdAt} />}
          {order.status === 'returned' && <TimelineItem label="Returned" date={order.createdAt} />}
        </div>
      </div>

      {/* Actions */}
      {order.status === 'pending' && (
        <div className="flex gap-3 animate-slide-up" style={{ animationDelay: '320ms' }}>
          <Button className="active:scale-[0.97]">Confirm Order</Button>
          <Button variant="outline" className="text-destructive hover:bg-destructive/10 active:scale-[0.97]">
            Cancel Order
          </Button>
        </div>
      )}
      {order.status === 'confirmed' && (
        <div className="animate-slide-up" style={{ animationDelay: '320ms' }}>
          <Button className="active:scale-[0.97]">Mark as Shipped</Button>
        </div>
      )}
    </div>
  );
}

function TimelineItem({ label, date }: { label: string; date: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-2 h-2 rounded-full bg-primary shrink-0" />
      <span className="text-sm font-medium w-24">{label}</span>
      <span className="text-sm text-muted-foreground">{format(new Date(date), 'dd MMM yyyy, HH:mm')}</span>
    </div>
  );
}
