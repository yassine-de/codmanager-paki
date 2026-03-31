import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { type Product } from "@/lib/products-data";

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (product: Product) => void;
}

export function CreateProductModal({ open, onOpenChange, onCreate }: CreateProductModalProps) {
  const [seller, setSeller] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [totalQty, setTotalQty] = useState<number | "">("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSeller(""); setName(""); setSku(""); setImage(""); setPrice(""); setTotalQty("");
    setErrors({});
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!seller.trim()) errs.seller = "Required";
    if (!name.trim()) errs.name = "Required";
    if (!sku.trim()) errs.sku = "Required";
    if (!price || price <= 0) errs.price = "Must be > 0";
    if (!totalQty || totalQty <= 0) errs.totalQty = "Must be > 0";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreate = () => {
    if (!validate()) return;
    const now = new Date().toISOString();
    const product: Product = {
      id: `PRD-${String(Date.now()).slice(-6)}`,
      seller: seller.trim(),
      name: name.trim(),
      sku: sku.trim(),
      image: image.trim() || "",
      price: Number(price),
      totalQty: Number(totalQty),
      delivered: 0,
      shipped: 0,
      available: Number(totalQty),
      createdAt: now,
      variants: [],
      storeLink: '',
      videoLink: '',
      lastSellingPrice: Number(price),
      lastPrice: 0,
      offers: [],
    };
    onCreate(product);
    onOpenChange(false);
    resetForm();
    toast.success("Product created");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base">Create Product</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Seller *</Label>
            <Input value={seller} onChange={(e) => setSeller(e.target.value)} placeholder="e.g. Amine Shop" className={`h-9 text-sm ${errors.seller ? "border-destructive" : ""}`} />
            {errors.seller && <p className="text-[11px] text-destructive">{errors.seller}</p>}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Product Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wireless Earbuds Pro" className={`h-9 text-sm ${errors.name ? "border-destructive" : ""}`} />
            {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">SKU *</Label>
              <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="e.g. SKU-12345" className={`h-9 text-sm ${errors.sku ? "border-destructive" : ""}`} />
              {errors.sku && <p className="text-[11px] text-destructive">{errors.sku}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Price ($) *</Label>
              <Input type="number" min={0.01} step={0.01} value={price} onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : "")} placeholder="0.00" className={`h-9 text-sm ${errors.price ? "border-destructive" : ""}`} />
              {errors.price && <p className="text-[11px] text-destructive">{errors.price}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Total Quantity *</Label>
              <Input type="number" min={1} step={1} value={totalQty} onChange={(e) => setTotalQty(e.target.value ? Number(e.target.value) : "")} placeholder="0" className={`h-9 text-sm ${errors.totalQty ? "border-destructive" : ""}`} />
              {errors.totalQty && <p className="text-[11px] text-destructive">{errors.totalQty}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Image URL <span className="text-muted-foreground">(optional)</span></Label>
              <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://..." className="h-9 text-sm" />
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate}>Create Product</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
