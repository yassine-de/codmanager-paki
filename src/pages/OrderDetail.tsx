import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Phone, MapPin, Calendar, StickyNote, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { mockOrders } from "@/lib/data";
import { format } from "date-fns";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { authUser } = useAuth();

  // Try mock orders first
  const mockOrder = mockOrders.find(o => o.id === id);

  // Fetch from DB if not in mock (match by order_id)
  const { data: dbOrder, isLoading } = useQuery({
    queryKey: ["order-detail", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("order_id", id!)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      // Get seller name
      let sellerName = authUser?.name || "Unknown";
      if (authUser?.role === "admin") {
        const { data: profile } = await supabase
          .from("profiles")
          .select("name")
          .eq("user_id", data.seller_id)
          .maybeSingle();
        if (profile) sellerName = profile.name;
      }

      return {
        id: data.order_id,
        dbId: data.id,
        customer: data.customer_name,
        phone: data.customer_phone,
        city: data.customer_city,
        address: data.customer_address || "",
        products: [{ name: data.product_name, qty: data.quantity, price: Number(data.price) }],
        total: Number(data.total_amount),
        confirmationStatus: data.confirmation_status,
        deliveryStatus: data.delivery_status || "pending",
        shippingStatus: data.shipping_status,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        confirmedAt: data.confirmed_at,
        deliveredAt: data.delivered_at,
        notes: data.note,
        seller: sellerName,
        cancelReason: data.cancel_reason,
        postponeDate: data.postpone_date,
        offers: data.offers,
        shippingCost: Number(data.shipping_cost || 0),
        attemptCount: data.attempt_count,
        fragile: data.fragile,
      };
    },
    enabled: !mockOrder && !!id,
  });

  const order = mockOrder || dbOrder;

  if (isLoading && !mockOrder) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="flex flex-col items-center justify-center py-24 space-y-4">
        <p className="text-muted-foreground">Order not found</p>
        <Button variant="outline" onClick={() => navigate('/orders')}>Back to orders</Button>
      </div>
    );
  }

  // Normalize for both mock and DB orders
  const isDbOrder = !mockOrder && !!dbOrder;
  const customer = isDbOrder ? dbOrder.customer : order.customer;
  const phone = isDbOrder ? dbOrder.phone : (order as any).phone;
  const city = isDbOrder ? dbOrder.city : (order as any).city;
  const address = isDbOrder ? dbOrder.address : (order as any).address;
  const products = isDbOrder ? dbOrder.products : (order as any).products;
  const total = isDbOrder ? dbOrder.total : (order as any).total;
  const createdAt = isDbOrder ? dbOrder.createdAt : (order as any).createdAt;
  const confirmedAt = isDbOrder ? dbOrder.confirmedAt : (order as any).confirmedAt;
  const deliveredAt = isDbOrder ? dbOrder.deliveredAt : (order as any).deliveredAt;
  const notes = isDbOrder ? dbOrder.notes : (order as any).notes;
  const seller = isDbOrder ? dbOrder.seller : (order as any).seller;
  const confirmationStatus = isDbOrder ? dbOrder.confirmationStatus : (order as any).confirmationStatus || (order as any).status;
  const deliveryStatus = isDbOrder ? dbOrder.deliveryStatus : (order as any).deliveryStatus;
  const shippingCost = isDbOrder ? dbOrder.shippingCost : 0;
  const cancelReason = isDbOrder ? dbOrder.cancelReason : undefined;
  const postponeDate = isDbOrder ? dbOrder.postponeDate : undefined;
  const attemptCount = isDbOrder ? dbOrder.attemptCount : 0;
  const fragile = isDbOrder ? dbOrder.fragile : false;
  const offers = isDbOrder ? dbOrder.offers : undefined;

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
          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
            confirmationStatus === 'confirmed' ? 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' :
            confirmationStatus === 'cancelled' ? 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' :
            confirmationStatus === 'new' ? 'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20' :
            'bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20'
          }`}>
            {confirmationStatus}
          </span>
          {deliveryStatus && deliveryStatus !== 'pending' && (
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
              deliveryStatus === 'delivered' ? 'bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20' :
              deliveryStatus === 'returned' ? 'bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20' :
              'bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20'
            }`}>
              {deliveryStatus}
            </span>
          )}
        </div>
        {seller && <p className="text-sm text-muted-foreground mt-1">Seller: {seller}</p>}
      </div>

      {/* Customer Info */}
      <div className="bg-card rounded-lg border p-5 space-y-4 animate-slide-up" style={{ animationDelay: '80ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer</h2>
        <div className="space-y-2.5">
          <p className="font-medium text-lg">{customer}</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Phone className="w-4 h-4" /> {phone}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4" /> {address ? `${address}, ` : ''}{city}
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" /> Ordered {format(new Date(createdAt), 'dd MMM yyyy, HH:mm')}
          </div>
          {notes && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <StickyNote className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{notes}</span>
            </div>
          )}
        </div>
      </div>

      {/* Order Details */}
      <div className="bg-card rounded-lg border p-5 space-y-3 animate-slide-up" style={{ animationDelay: '120ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Order Details</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {attemptCount > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Attempts</p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">{attemptCount}</p>
            </div>
          )}
          {shippingCost > 0 && (
            <div className="rounded-lg border bg-muted/30 p-3 text-center">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Shipping</p>
              <p className="text-sm font-semibold tabular-nums mt-0.5">{shippingCost} PKR</p>
            </div>
          )}
          {fragile && (
            <div className="rounded-lg border bg-warning/10 border-warning/20 p-3 text-center">
              <p className="text-[10px] text-warning uppercase tracking-wider font-medium">Fragile</p>
              <p className="text-sm font-semibold mt-0.5">⚠️ Yes</p>
            </div>
          )}
          {cancelReason && (
            <div className="rounded-lg border bg-destructive/10 border-destructive/20 p-3 text-center col-span-2">
              <p className="text-[10px] text-destructive uppercase tracking-wider">Cancel Reason</p>
              <p className="text-sm font-medium mt-0.5">{cancelReason}</p>
            </div>
          )}
          {postponeDate && (
            <div className="rounded-lg border bg-warning/10 border-warning/20 p-3 text-center">
              <p className="text-[10px] text-warning uppercase tracking-wider">Postponed To</p>
              <p className="text-sm font-semibold mt-0.5">{format(new Date(postponeDate), 'dd MMM yyyy')}</p>
            </div>
          )}
        </div>
        {offers && (
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Offers:</span> {offers}
          </div>
        )}
      </div>

      {/* Products */}
      <div className="bg-card rounded-lg border animate-slide-up" style={{ animationDelay: '160ms' }}>
        <div className="p-5 border-b">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Products</h2>
        </div>
        <div className="divide-y">
          {products.map((p: any, i: number) => (
            <div key={i} className="flex items-center justify-between p-4">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-sm text-muted-foreground">Qty: {p.qty} × {p.price.toLocaleString()} PKR</p>
              </div>
              <p className="font-medium tabular-nums">{(p.qty * p.price).toLocaleString()} PKR</p>
            </div>
          ))}
        </div>
        <div className="p-4 border-t flex justify-between items-center bg-muted/30">
          <span className="font-semibold">Total</span>
          <span className="text-lg font-semibold tabular-nums">{total.toLocaleString()} PKR</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-card rounded-lg border p-5 space-y-4 animate-slide-up" style={{ animationDelay: '240ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Timeline</h2>
        <div className="space-y-3">
          <TimelineItem label="Created" date={createdAt} />
          {confirmedAt && <TimelineItem label="Confirmed" date={confirmedAt} />}
          {deliveredAt && <TimelineItem label="Delivered" date={deliveredAt} />}
          {confirmationStatus === 'cancelled' && <TimelineItem label="Cancelled" date={createdAt} />}
        </div>
      </div>
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