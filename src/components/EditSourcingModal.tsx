import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  type SourcingRequest,
  type SourcingStatus,
  type PaymentStatus,
  sourcingStatusConfig,
  paymentStatusConfig,
} from "@/lib/sourcing-data";

interface EditSourcingModalProps {
  request: SourcingRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: SourcingRequest) => void;
}

export function EditSourcingModal({ request, open, onOpenChange, onSave }: EditSourcingModalProps) {
  const [unitPrice, setUnitPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [status, setStatus] = useState<SourcingStatus>("pending");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("unpaid");
  const [paidAmount, setPaidAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Sync state when request changes
  const [prevId, setPrevId] = useState<string | null>(null);
  if (request && request.id !== prevId) {
    setPrevId(request.id);
    setUnitPrice(request.unitPrice);
    setQuantity(request.quantity);
    setStatus(request.status);
    setPaymentStatus(request.paymentStatus);
    setPaidAmount(request.paidAmount);
    setNotes(request.notes ?? "");
    setErrors({});
  }

  if (!request) return null;

  const totalPrice = quantity * unitPrice;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (unitPrice <= 0) errs.unitPrice = "Price must be greater than 0";
    if (quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    if (!Number.isInteger(quantity)) errs.quantity = "Quantity must be a whole number";
    if (paidAmount < 0) errs.paidAmount = "Paid amount cannot be negative";
    if (paidAmount > totalPrice) errs.paidAmount = "Paid amount cannot exceed total";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    onSave({
      ...request,
      unitPrice,
      quantity,
      totalPrice,
      status,
      paymentStatus,
      paidAmount,
      notes: notes.trim() || undefined,
      updatedAt: new Date().toISOString(),
    });
    onOpenChange(false);
    toast.success("Request updated successfully");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Sourcing Request — {request.id}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Product Info (read-only) */}
          <div className="flex gap-3 rounded-lg border bg-muted/30 p-3">
            <img
              src={request.productImage}
              alt={request.productName}
              className="w-16 h-16 rounded-lg object-cover shrink-0"
            />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="text-sm font-medium truncate">{request.productName}</p>
              <p className="text-xs text-muted-foreground">Seller: <span className="text-foreground font-medium">{request.seller}</span></p>
              <a
                href={request.sourceLink}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-info hover:underline"
              >
                <ExternalLink className="h-3 w-3" /> Source Link
              </a>
            </div>
          </div>

          {/* Quantity & Unit Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                className={`h-9 text-sm ${errors.quantity ? 'border-destructive' : ''}`}
              />
              {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit Price (MAD)</Label>
              <Input
                type="number"
                min={0.01}
                step={0.01}
                value={unitPrice}
                onChange={e => setUnitPrice(Number(e.target.value))}
                className={`h-9 text-sm ${errors.unitPrice ? 'border-destructive' : ''}`}
              />
              {errors.unitPrice && <p className="text-[11px] text-destructive">{errors.unitPrice}</p>}
            </div>
          </div>

          {/* Total (calculated) */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-sm font-semibold tabular-nums">{totalPrice.toLocaleString()} MAD</span>
          </div>

          {/* Status & Payment Status */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={v => setStatus(v as SourcingStatus)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(sourcingStatusConfig) as SourcingStatus[]).map(s => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${sourcingStatusConfig[s].color.split(' ')[0].replace('/15', '')}`} />
                        {sourcingStatusConfig[s].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Payment</Label>
              <Select value={paymentStatus} onValueChange={v => setPaymentStatus(v as PaymentStatus)}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(paymentStatusConfig) as PaymentStatus[]).map(s => (
                    <SelectItem key={s} value={s}>
                      <span className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${paymentStatusConfig[s].color.split(' ')[0].replace('/15', '')}`} />
                        {paymentStatusConfig[s].label}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Paid Amount */}
          <div className="space-y-1.5">
            <Label className="text-xs">Paid Amount (MAD)</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={paidAmount}
              onChange={e => setPaidAmount(Number(e.target.value))}
              className={`h-9 text-sm ${errors.paidAmount ? 'border-destructive' : ''}`}
            />
            {errors.paidAmount && <p className="text-[11px] text-destructive">{errors.paidAmount}</p>}
            {totalPrice > 0 && (
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-success transition-all"
                    style={{ width: `${Math.min((paidAmount / totalPrice) * 100, 100)}%` }}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {Math.round((paidAmount / totalPrice) * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes..."
              className="text-sm min-h-[70px] resize-none"
              maxLength={500}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
