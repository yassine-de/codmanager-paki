import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { DbSourcingRequest } from "@/pages/Sourcing";

const statusOptions: { value: string; label: string }[] = [
  { value: "waiting_quote", label: "Waiting Quote" },
  { value: "quoted", label: "Quoted" },
  { value: "validated", label: "Validated" },
  { value: "ordered", label: "Ordered" },
  { value: "shipped", label: "Shipped" },
  { value: "received", label: "Received" },
  { value: "cancelled", label: "Cancelled" },
];

interface EditSourcingModalProps {
  request: DbSourcingRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSourcingModal({ request, open, onOpenChange }: EditSourcingModalProps) {
  const queryClient = useQueryClient();
  const [unitPrice, setUnitPrice] = useState(0);
  const [shippingCost, setShippingCost] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [status, setStatus] = useState("waiting_quote");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [prevId, setPrevId] = useState<string | null>(null);
  if (request && request.id !== prevId) {
    setPrevId(request.id);
    setUnitPrice(request.unit_price ?? 0);
    setShippingCost(request.shipping_cost ?? 0);
    setQuantity(request.quantity);
    setStatus(request.status);
    setNotes(request.notes ?? "");
    setErrors({});
  }

  if (!request) return null;

  const totalPrice = quantity * unitPrice + shippingCost;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    if (unitPrice < 0) errs.unitPrice = "Price cannot be negative";
    if (shippingCost < 0) errs.shippingCost = "Shipping cost cannot be negative";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("sourcing_requests")
        .update({
          unit_price: unitPrice,
          shipping_cost: shippingCost,
          quantity,
          total_price: totalPrice,
          status,
          notes: notes.trim() || "",
          updated_at: new Date().toISOString(),
        })
        .eq("id", request.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing"] });
      onOpenChange(false);
      toast.success("Request updated successfully");
    },
    onError: () => {
      toast.error("Failed to update request");
    },
  });

  const handleSave = () => {
    if (!validate()) return;
    updateMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Product Info (read-only) */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-medium">{request.product_name}</p>
            <p className="text-xs text-muted-foreground">
              {request.destination_country} · {request.shipping_method === "air" ? "By Air ✈️" : "By Sea 🚢"}
            </p>
            <a
              href={request.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-info hover:underline"
            >
              <ExternalLink className="h-3 w-3" /> Product Link
            </a>
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
                className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`}
              />
              {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit Price (MAD)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                value={unitPrice}
                onChange={e => setUnitPrice(Number(e.target.value))}
                className={`h-9 text-sm ${errors.unitPrice ? "border-destructive" : ""}`}
              />
              {errors.unitPrice && <p className="text-[11px] text-destructive">{errors.unitPrice}</p>}
            </div>
          </div>

          {/* Shipping Cost */}
          <div className="space-y-1.5">
            <Label className="text-xs">Shipping Cost (MAD)</Label>
            <Input
              type="number"
              min={0}
              step={0.01}
              value={shippingCost}
              onChange={e => setShippingCost(Number(e.target.value))}
              className={`h-9 text-sm ${errors.shippingCost ? "border-destructive" : ""}`}
            />
            {errors.shippingCost && <p className="text-[11px] text-destructive">{errors.shippingCost}</p>}
          </div>

          {/* Total (calculated) */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
            <span className="text-xs text-muted-foreground">Total</span>
            <span className="text-sm font-semibold tabular-nums">{totalPrice.toLocaleString()} MAD</span>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {statusOptions.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button size="sm" onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
