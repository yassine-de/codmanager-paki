import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { format } from "date-fns";
import {
  PlusCircle, CheckCircle, Truck, Package, PhoneOff,
  ArrowRightLeft, Hash, DollarSign, StickyNote, UserCheck, PhoneCall,
} from "lucide-react";
import type { OrderHistoryEvent } from "@/lib/data";

const eventConfig: Record<OrderHistoryEvent['type'], { icon: React.ElementType; color: string }> = {
  created: { icon: PlusCircle, color: 'text-[hsl(210,60%,52%)] bg-[hsl(210,60%,52%)]/10' },
  status_change: { icon: ArrowRightLeft, color: 'text-[hsl(38,90%,55%)] bg-[hsl(38,90%,55%)]/10' },
  confirmation: { icon: CheckCircle, color: 'text-[hsl(155,50%,42%)] bg-[hsl(155,50%,42%)]/10' },
  delivery_update: { icon: Truck, color: 'text-[hsl(230,55%,55%)] bg-[hsl(230,55%,55%)]/10' },
  quantity_change: { icon: Hash, color: 'text-[hsl(25,85%,55%)] bg-[hsl(25,85%,55%)]/10' },
  price_change: { icon: DollarSign, color: 'text-[hsl(0,65%,52%)] bg-[hsl(0,65%,52%)]/10' },
  note: { icon: StickyNote, color: 'text-[hsl(30,6%,50%)] bg-[hsl(30,6%,50%)]/10' },
  assigned: { icon: UserCheck, color: 'text-[hsl(270,50%,55%)] bg-[hsl(270,50%,55%)]/10' },
  call_attempt: { icon: PhoneCall, color: 'text-[hsl(185,55%,42%)] bg-[hsl(185,55%,42%)]/10' },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: string;
  customerName: string;
  history: OrderHistoryEvent[];
}

export default function OrderHistoryModal({ open, onOpenChange, orderId, customerName, history }: Props) {
  const sorted = [...history].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Order History
            <span className="ml-2 text-xs font-normal text-muted-foreground">{orderId} · {customerName}</span>
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          <div className="px-5 py-4">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border" />

              <div className="space-y-0">
                {sorted.map((event, idx) => {
                  const cfg = eventConfig[event.type];
                  const Icon = cfg.icon;
                  return (
                    <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                      {/* Icon */}
                      <div className={`relative z-10 flex items-center justify-center w-[31px] h-[31px] rounded-full shrink-0 ${cfg.color}`}>
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-sm font-medium leading-snug">{event.description}</p>
                        {(event.oldValue || event.newValue) && (
                          <div className="flex items-center gap-1.5 mt-1">
                            {event.oldValue && (
                              <span className="inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground line-through">
                                {event.oldValue}
                              </span>
                            )}
                            {event.oldValue && event.newValue && <span className="text-muted-foreground text-[10px]">→</span>}
                            {event.newValue && (
                              <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {event.newValue}
                              </span>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            {format(new Date(event.timestamp), 'dd MMM yyyy · HH:mm')}
                          </span>
                          {event.agent && (
                            <span className="text-[11px] text-muted-foreground">
                              by <span className="font-medium text-foreground/70">{event.agent}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
