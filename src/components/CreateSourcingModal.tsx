import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { type SourcingRequest } from "@/lib/sourcing-data";

interface CreateSourcingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (request: SourcingRequest) => void;
}

export function CreateSourcingModal({ open, onOpenChange, onCreate }: CreateSourcingModalProps) {
  const [seller, setSeller] = useState("");
  const [productName, setProductName] = useState("");
  const [productImage, setProductImage] = useState("");
  const [sourceLink, setSourceLink] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [unitPrice, setUnitPrice] = useState<number | "">("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSeller("");
    setProductName("");
    setProductImage("");
    setSourceLink("");
    setQuantity("");
    setUnitPrice("");
    setNotes("");
    setErrors({});
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!seller.trim()) errs.seller = "Seller is required";
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!sourceLink.trim()) errs.sourceLink = "Source link is required";
    if (!quantity || quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    if (quantity && !Number.isInteger(quantity)) errs.quantity = "Must be a whole number";
    if (!unitPrice || unitPrice <= 0) errs.unitPrice = "Price must be greater than 0";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = () => {
    if (!validate()) return;

    const qty = Number(quantity);
    const price = Number(unitPrice);
    const now = new Date().toISOString();

    const newRequest: SourcingRequest = {
      id: `SRC-${String(Date.now()).slice(-6)}`,
      seller: seller.trim(),
      productName: productName.trim(),
      productImage: productImage.trim() || "https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=80&h=80&fit=crop",
      sourceLink: sourceLink.trim(),
      quantity: qty,
      unitPrice: price,
      totalPrice: qty * price,
      status: "pending",
      paymentStatus: "unpaid",
      paidAmount: 0,
      createdAt: now,
      updatedAt: now,
      notes: notes.trim() || undefined,
    };

    onCreate(newRequest);
    onOpenChange(false);
    resetForm();
    toast.success("Sourcing request created");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">New Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Seller */}
          <div className="space-y-1.5">
            <Label className="text-xs">Seller *</Label>
            <Input
              value={seller}
              onChange={e => setSeller(e.target.value)}
              placeholder="e.g. Amine Shop"
              className={`h-9 text-sm ${errors.seller ? "border-destructive" : ""}`}
            />
            {errors.seller && <p className="text-[11px] text-destructive">{errors.seller}</p>}
          </div>

          {/* Product Name */}
          <div className="space-y-1.5">
            <Label className="text-xs">Product Name *</Label>
            <Input
              value={productName}
              onChange={e => setProductName(e.target.value)}
              placeholder="e.g. Wireless Earbuds Pro"
              className={`h-9 text-sm ${errors.productName ? "border-destructive" : ""}`}
            />
            {errors.productName && <p className="text-[11px] text-destructive">{errors.productName}</p>}
          </div>

          {/* Product Image URL */}
          <div className="space-y-1.5">
            <Label className="text-xs">Product Image URL <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              value={productImage}
              onChange={e => setProductImage(e.target.value)}
              placeholder="https://..."
              className="h-9 text-sm"
            />
          </div>

          {/* Source Link */}
          <div className="space-y-1.5">
            <Label className="text-xs">Source Link (Alibaba / AliExpress) *</Label>
            <Input
              value={sourceLink}
              onChange={e => setSourceLink(e.target.value)}
              placeholder="https://www.alibaba.com/product/..."
              className={`h-9 text-sm ${errors.sourceLink ? "border-destructive" : ""}`}
            />
            {errors.sourceLink && <p className="text-[11px] text-destructive">{errors.sourceLink}</p>}
          </div>

          {/* Quantity & Unit Price */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity *</Label>
              <Input
                type="number"
                min={1}
                step={1}
                value={quantity}
                onChange={e => setQuantity(e.target.value ? Number(e.target.value) : "")}
                placeholder="0"
                className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`}
              />
              {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Unit Price (MAD) *</Label>
              <Input
                type="number"
                min={0.01}
                step={0.01}
                value={unitPrice}
                onChange={e => setUnitPrice(e.target.value ? Number(e.target.value) : "")}
                placeholder="0.00"
                className={`h-9 text-sm ${errors.unitPrice ? "border-destructive" : ""}`}
              />
              {errors.unitPrice && <p className="text-[11px] text-destructive">{errors.unitPrice}</p>}
            </div>
          </div>

          {/* Total Preview */}
          {quantity && unitPrice ? (
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">Total</span>
              <span className="text-sm font-semibold tabular-nums">
                {(Number(quantity) * Number(unitPrice)).toLocaleString()} MAD
              </span>
            </div>
          ) : null}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs">Notes <span className="text-muted-foreground">(optional)</span></Label>
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
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate}>Create Request</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
