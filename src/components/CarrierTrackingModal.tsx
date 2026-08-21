import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package, MapPin, Calendar, User, DollarSign, Truck } from "lucide-react";

interface CarrierTrackingModalProps {
  carrierOrderId: string | number;
  systemId?: number | null;
  sellerId?: string | null;
  open: boolean;
  onClose: () => void;
}

interface TrackingEvent {
  dateTime?: string;
  status?: string;
  transactionStatusMessage?: string;
  transactionStatusMessageCode?: string | number;
  transactionStatusDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface TrackingPayload {
  status?: string;
  consigment_no?: string;
  order_date?: string;
  consignee_name?: string;
  cod_amount?: number;
  origin?: string;
  destination?: string;
  detail?: TrackingEvent[];
  customerName?: string;
  customerPhone?: string;
  deliveryAddress?: string;
  invoicePayment?: number;
  orderDetail?: string;
  orderPickupDate?: string;
  orderDeliveryDate?: string;
  orderRefNumber?: string;
  trackingNumber?: string;
  transactionDate?: string;
  transactionStatus?: string;
  cityName?: string;
  transactionNotes?: string;
  transactionStatusHistory?: TrackingEvent[];
}

function formatTrackingDate(value?: string) {
  if (!value) return "";
  const normalizedValue = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalizedValue);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Karachi",
    timeZoneName: "short",
  }).format(date);
}

export default function CarrierTrackingModal({ carrierOrderId, systemId, sellerId, open, onClose }: CarrierTrackingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrackingPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPayload(null);

    supabase.functions
      .invoke("shipping-sync", {
        body: { action: "track-by-carrier-order-id", carrier_order_id: carrierOrderId },
      })
      .then(({ data, error: fnError }) => {
        if (fnError) {
          setError(fnError.message);
        } else if (data?.error) {
          setError(data.error);
        } else {
          setPayload(data);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open, carrierOrderId]);

  const view = useMemo(() => {
    const trackingNumber = payload?.trackingNumber || payload?.consigment_no || String(carrierOrderId || "");
    const currentStatus = payload?.transactionStatus || payload?.status || "-";
    const orderDate = payload?.transactionDate || payload?.order_date || payload?.orderPickupDate || "-";
    const customerName = payload?.customerName || payload?.consignee_name || "-";
    const codAmount = payload?.invoicePayment ?? payload?.cod_amount;
    const location = payload?.origin || payload?.destination
      ? `${payload?.origin || "?"} -> ${payload?.destination || "?"}`
      : payload?.cityName || "-";
    const events = (payload?.transactionStatusHistory || payload?.detail || []).map((event) => ({
      status: event.transactionStatusMessage || event.status || "-",
      code: event.transactionStatusMessageCode ? String(event.transactionStatusMessageCode) : "",
      dateTime: formatTrackingDate(event.updatedAt || event.transactionStatusDate || event.dateTime || event.createdAt),
    }));

    return {
      trackingNumber,
      currentStatus,
      orderDate,
      customerName,
      codAmount,
      location,
      events,
    };
  }, [carrierOrderId, payload]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4" />
            TRACK DETAIL {view.trackingNumber ? `- ${view.trackingNumber}` : `- Carrier #${carrierOrderId}`}
          </DialogTitle>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {systemId && <span className="text-[10px] font-semibold text-muted-foreground">SYSTEM ID: <span className="text-foreground">{systemId}</span></span>}
            {sellerId && <span className="text-[10px] font-semibold text-muted-foreground">SELLER ID: <span className="text-foreground">{sellerId}</span></span>}
            <span className="text-[10px] font-semibold text-muted-foreground">CARRIER ID: <span className="text-foreground">{carrierOrderId}</span></span>
          </div>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {payload && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SummaryItem icon={<Truck className="w-3.5 h-3.5" />} label="STATUS" value={view.currentStatus} />
              <SummaryItem icon={<Package className="w-3.5 h-3.5" />} label="CN#" value={view.trackingNumber || "-"} />
              <SummaryItem icon={<Calendar className="w-3.5 h-3.5" />} label="DATE" value={view.orderDate} />
              <SummaryItem icon={<User className="w-3.5 h-3.5" />} label="CUSTOMER" value={view.customerName} />
              <SummaryItem icon={<DollarSign className="w-3.5 h-3.5" />} label="COD" value={view.codAmount != null ? `${view.codAmount}` : "-"} />
              <SummaryItem icon={<MapPin className="w-3.5 h-3.5" />} label="LOCATION" value={view.location} />
            </div>

            {view.trackingNumber && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                COURIER SHIPPING LABEL: <span className="text-foreground font-semibold">{view.trackingNumber}</span>
              </div>
            )}

            {view.events.length > 0 && (
              <div className="space-y-0">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Tracking Timeline</h4>
                <div className="relative pl-6 border-l-2 border-muted space-y-4">
                  {view.events.map((event, i) => (
                    <div key={`${event.status}-${event.code}-${i}`} className="relative">
                      <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${i === view.events.length - 1 ? "bg-primary border-primary" : "bg-background border-muted-foreground/40"}`} />
                      <div>
                        <p className="text-sm font-medium">
                          {event.status}
                          {event.code && <span className="ml-2 text-xs text-muted-foreground">#{event.code}</span>}
                        </p>
                        {event.dateTime && <p className="text-xs text-muted-foreground">{event.dateTime}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {view.events.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No tracking events available yet.</p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SummaryItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs font-medium truncate">{value}</p>
    </div>
  );
}
