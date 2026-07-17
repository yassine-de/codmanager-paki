import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type FinColor = "gray" | "orange" | "green";

interface Props {
  confirmationStatus: string;
  deliveryStatus: string;
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  invoiceFinalizedAt?: string | null;
  confirmedAt?: string | null;
  deliveredAt?: string | null;
  updatedAt?: string | null;
}

const HIDDEN_STATUSES = ["new", "new_wts", "no_answer", "postponed", "wrong_number", "double"];

function isAfterFinalized(eventAt: string | null | undefined, invoiceFinalizedAt: string | null | undefined) {
  if (!eventAt || !invoiceFinalizedAt) return false;
  return new Date(eventAt).getTime() > new Date(invoiceFinalizedAt).getTime();
}

function getInvoiceColor(
  invoiceId: string | null | undefined,
  invoiceStatus: string | null | undefined,
  eventAt?: string | null,
  invoiceFinalizedAt?: string | null,
): FinColor {
  if (!invoiceId) return "gray";
  if (invoiceStatus === "paid" && isAfterFinalized(eventAt, invoiceFinalizedAt)) return "orange";
  if (invoiceStatus === "paid") return "green";
  return "orange";
}

const colorMap: Record<FinColor, string> = {
  gray:   "bg-[hsl(220,10%,72%)]",
  orange: "bg-[hsl(38,90%,55%)]",
  green:  "bg-[hsl(155,50%,42%)]",
};

const labelMap: Record<FinColor, string> = {
  gray:   "Not in any invoice",
  orange: "In current/unpaid invoice period",
  green:  "In invoice — paid",
};

function Dot({ color, label, letter }: { color: FinColor; label: string; letter: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white leading-none select-none ${colorMap[color]}`}>
          {letter}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function FinancialIndicators({
  confirmationStatus,
  deliveryStatus,
  invoiceId,
  invoiceStatus,
  invoiceFinalizedAt,
  confirmedAt,
  deliveredAt,
  updatedAt,
}: Props) {
  if (HIDDEN_STATUSES.includes(confirmationStatus)) return null;

  const shippedStatuses = ["shipped", "in_transit", "with_courier", "out_for_delivery", "delivered", "paid", "failed_attempt", "returned", "return", "ready_for_return", "return_received"];

  // C — confirmed
  const cActive = confirmationStatus === "confirmed";
  const cColor: FinColor = cActive ? getInvoiceColor(invoiceId, invoiceStatus, confirmedAt || updatedAt, invoiceFinalizedAt) : "gray";

  // S — shipped or beyond
  const sActive = shippedStatuses.some(s => deliveryStatus === s);
  const sColor: FinColor = sActive ? getInvoiceColor(invoiceId, invoiceStatus, deliveredAt || updatedAt, invoiceFinalizedAt) : "gray";

  // D — delivered / paid
  const dActive = deliveryStatus === "delivered" || deliveryStatus === "paid";
  const dColor: FinColor = dActive ? getInvoiceColor(invoiceId, invoiceStatus, deliveredAt || updatedAt, invoiceFinalizedAt) : "gray";

  return (
    <div className="inline-flex items-center gap-0.5">
      <Dot color={cColor} letter="C" label={`Confirmed: ${labelMap[cColor]}`} />
      <Dot color={sColor} letter="S" label={`Shipped: ${labelMap[sColor]}`} />
      <Dot color={dColor} letter="D" label={`Delivered: ${labelMap[dColor]}`} />
    </div>
  );
}
