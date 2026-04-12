import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Package, MapPin, Calendar, User, DollarSign, Truck } from "lucide-react";

interface OrioTrackingModalProps {
  orioOrderId: number;
  open: boolean;
  onClose: () => void;
}

interface TrackingDetail {
  dateTime: string;
  status: string;
}

interface TrackingPayload {
  order_id: number;
  status: string;
  consigment_no: string;
  order_date: string;
  consignee_name: string;
  cod_amount: number;
  shipping_charges: number;
  origin: string;
  destination: string;
  detail: TrackingDetail[];
}

export default function OrioTrackingModal({ orioOrderId, open, onClose }: OrioTrackingModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<TrackingPayload | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setPayload(null);

    supabase.functions
      .invoke("orio-sync", {
        body: { action: "track-by-orio-id", orio_order_id: orioOrderId },
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
  }, [open, orioOrderId]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4" />
            TRACK DETAIL {payload?.consigment_no ? `- ${payload.consigment_no}` : `- ORIO #${orioOrderId}`}
          </DialogTitle>
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
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <SummaryItem icon={<Truck className="w-3.5 h-3.5" />} label="STATUS" value={payload.status} />
              <SummaryItem icon={<Package className="w-3.5 h-3.5" />} label="CN#" value={payload.consigment_no || "—"} />
              <SummaryItem icon={<Calendar className="w-3.5 h-3.5" />} label="DATE" value={payload.order_date || "—"} />
              <SummaryItem icon={<User className="w-3.5 h-3.5" />} label="CUSTOMER" value={payload.consignee_name || "—"} />
              <SummaryItem icon={<DollarSign className="w-3.5 h-3.5" />} label="COD" value={payload.cod_amount != null ? `${payload.cod_amount}` : "—"} />
              <SummaryItem icon={<MapPin className="w-3.5 h-3.5" />} label="FROM → TO" value={`${payload.origin || "?"} → ${payload.destination || "?"}`} />
            </div>

            {/* Shipping label */}
            {payload.consigment_no && (
              <div className="rounded-md bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                COURIER SHIPPING LABEL: <span className="text-foreground font-semibold">{payload.consigment_no}</span>
              </div>
            )}

            {/* Timeline */}
            {payload.detail && payload.detail.length > 0 && (
              <div className="space-y-0">
                <h4 className="text-xs font-semibold uppercase text-muted-foreground mb-3">Tracking Timeline</h4>
                <div className="relative pl-6 border-l-2 border-muted space-y-4">
                  {payload.detail.map((event, i) => (
                    <div key={i} className="relative">
                      <div className={`absolute -left-[25px] w-3 h-3 rounded-full border-2 ${i === 0 ? "bg-primary border-primary" : "bg-background border-muted-foreground/40"}`} />
                      <div>
                        <p className="text-sm font-medium">{event.status}</p>
                        <p className="text-xs text-muted-foreground">{event.dateTime}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(!payload.detail || payload.detail.length === 0) && (
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
