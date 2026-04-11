import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type FinColor = "gray" | "orange" | "green";

interface Props {
  confirmationStatus: string;
  deliveryStatus: string;
  invoiceId?: string | null;
  invoiceStatus?: string | null;
  isAdmin: boolean;
}

const HIDDEN_STATUSES = ["new", "no_answer", "postponed"];

function getInvoiceColor(invoiceId: string | null | undefined, invoiceStatus: string | null | undefined): FinColor {
  if (!invoiceId) return "gray";
  if (invoiceStatus === "paid") return "green";
  return "orange";
}

const colorMap: Record<FinColor, string> = {
  gray: "bg-[#d1d5db]",
  orange: "bg-[#f59e0b]",
  green: "bg-[#10b981]",
};

const labelMap: Record<FinColor, string> = {
  gray: "Not in any invoice",
  orange: "In invoice — pending payment",
  green: "In invoice — paid",
};

function Dot({ color, label, letter }: { color: FinColor; label: string; letter: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[9px] font-bold text-white leading-none ${colorMap[color]}`}>
          {letter}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function FinancialIndicators({ confirmationStatus, deliveryStatus, invoiceId, invoiceStatus, isAdmin }: Props) {
  // Hide for early-stage orders
  if (HIDDEN_STATUSES.includes(confirmationStatus)) return null;

  const invoiceColor = getInvoiceColor(invoiceId, invoiceStatus);
  const shippedStatuses = ["shipped", "in_transit", "with_courier", "delivered", "returned"];

  // C: confirmed → uses invoice color; otherwise gray (not yet counted)
  const cActive = confirmationStatus === "confirmed";
  const cColor: FinColor = cActive ? invoiceColor : "gray";

  // S: has been shipped → uses invoice color
  const sActive = shippedStatuses.includes(deliveryStatus);
  const sColor: FinColor = sActive ? invoiceColor : "gray";

  // D: delivered → uses invoice color
  const dActive = deliveryStatus === "delivered";
  const dColor: FinColor = dActive ? invoiceColor : "gray";

  // Seller view: simple label
  if (!isAdmin) {
    if (!invoiceId) return null;
    const isPaid = invoiceStatus === "paid";
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium leading-none ${
        isPaid
          ? "bg-[#10b981]/15 text-[#10b981]"
          : "bg-[#f59e0b]/15 text-[#f59e0b]"
      }`}>
        {isPaid ? "Paid" : "Pending"}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      <Dot color={cColor} letter="C" label={`Confirmation: ${labelMap[cColor]}`} />
      <Dot color={sColor} letter="S" label={`Shipping: ${labelMap[sColor]}`} />
      <Dot color={dColor} letter="D" label={`Delivery: ${labelMap[dColor]}`} />
    </div>
  );
}
