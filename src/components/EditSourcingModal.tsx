import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Loader2, MapPin, Ship, ImageIcon } from "lucide-react";
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
  const [landedPrice, setLandedPrice] = useState(0);
  const [sellerPrice, setSellerPrice] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [status, setStatus] = useState("waiting_quote");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [prevId, setPrevId] = useState<string | null>(null);
  if (request && request.id !== prevId) {
    setPrevId(request.id);
    setUnitPrice(request.unit_price ?? 0);
    setShippingCost(request.shipping_cost ?? 0);
    setLandedPrice(request.landed_price ?? 0);
    setSellerPrice(request.seller_price ?? 0);
    setQuantity(request.quantity);
    setStatus(request.status);
    setNotes(request.notes ?? "");
    setErrors({});
  }

  const totalPrice = quantity * unitPrice + shippingCost;
  const sourcingProfit = sellerPrice > 0 && landedPrice > 0 ? sellerPrice - landedPrice : 0;
  const profitMargin = sellerPrice > 0 ? ((sourcingProfit / sellerPrice) * 100) : 0;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    if (unitPrice < 0) errs.unitPrice = "Price cannot be negative";
    if (shippingCost < 0) errs.shippingCost = "Shipping cost cannot be negative";
    if (landedPrice < 0) errs.landedPrice = "Landed price cannot be negative";
    if (sellerPrice < 0) errs.sellerPrice = "Seller price cannot be negative";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!request) return;
      const { error } = await supabase
        .from("sourcing_requests")
        .update({
          unit_price: unitPrice,
          shipping_cost: shippingCost,
          landed_price: landedPrice,
          seller_price: sellerPrice,
          quantity,
          total_price: totalPrice,
          status,
          notes: notes.trim() || "",
          updated_at: new Date().toISOString(),
          seller_seen: false,
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

  if (!request) return null;

  const imageUrl = request.product_image_url;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Product Info Card - improved design */}
          <div className="rounded-xl border bg-muted/20 overflow-hidden">
            <div className="flex gap-3 p-3">
              {/* Product Image */}
              <div className="flex-shrink-0">
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={request.product_name}
                    className="w-16 h-16 rounded-lg object-cover border bg-background"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg border bg-background flex items-center justify-center">
                    <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                  </div>
                )}
              </div>
              {/* Product Details */}
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm font-semibold truncate">{request.product_name}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {request.destination_country}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Ship className="h-3 w-3" />
                    {request.shipping_method === "air" ? "By Air" : "By Sea"}
                  </span>
                </div>
                <a
                  href={request.product_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  <ExternalLink className="h-3 w-3" /> View Product
                </a>
              </div>
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
            <span className="text-xs text-muted-foreground">Total Cost</span>
            <span className="text-sm font-semibold tabular-nums">{totalPrice.toLocaleString()} MAD</span>
          </div>

          {/* Landed Price & Seller Price */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-1 h-4 rounded-full bg-primary" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Landed Price (MAD)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={landedPrice}
                  onChange={e => setLandedPrice(Number(e.target.value))}
                  className={`h-9 text-sm ${errors.landedPrice ? "border-destructive" : ""}`}
                />
                {errors.landedPrice && <p className="text-[11px] text-destructive">{errors.landedPrice}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Seller Price (MAD)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={sellerPrice}
                  onChange={e => setSellerPrice(Number(e.target.value))}
                  className={`h-9 text-sm ${errors.sellerPrice ? "border-destructive" : ""}`}
                />
                {errors.sellerPrice && <p className="text-[11px] text-destructive">{errors.sellerPrice}</p>}
              </div>
            </div>
            {/* Profit display */}
            <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${sourcingProfit > 0 ? "bg-success/10 border-success/25" : sourcingProfit < 0 ? "bg-destructive/10 border-destructive/25" : "bg-muted/30"}`}>
              <span className="text-xs text-muted-foreground">Sourcing Profit</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold tabular-nums ${sourcingProfit > 0 ? "text-success" : sourcingProfit < 0 ? "text-destructive" : ""}`}>
                  {sourcingProfit > 0 ? "+" : ""}{sourcingProfit.toLocaleString()} MAD
                </span>
                {sellerPrice > 0 && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sourcingProfit > 0 ? "bg-success/15 text-success" : sourcingProfit < 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                    {profitMargin.toFixed(1)}%
                  </span>
                )}
              </div>
            </div>
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
