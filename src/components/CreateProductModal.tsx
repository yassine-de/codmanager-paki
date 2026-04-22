import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { type Product } from "@/lib/products-data";
import { cn } from "@/lib/utils";

interface CreateProductModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (product: Product) => void;
}

export function CreateProductModal({ open, onOpenChange, onCreate }: CreateProductModalProps) {
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";
  const [seller, setSeller] = useState("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [totalQty, setTotalQty] = useState<number | "">("");
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [pendingWhatsappValue, setPendingWhatsappValue] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const resetForm = () => {
    setSeller(""); setName(""); setSku(""); setImage(""); setPrice(""); setTotalQty("");
    setWhatsappEnabled(false); setPendingWhatsappValue(null);
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
      cancelled: 0,
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

  const confirmWhatsappChange = () => {
    if (pendingWhatsappValue === null) return;
    const newValue = pendingWhatsappValue;
    setWhatsappEnabled(newValue);
    setPendingWhatsappValue(null);
    toast.success(newValue
      ? "WhatsApp confirmation enabled for this product"
      : "WhatsApp confirmation disabled for this product");
  };

  return (
    <>
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

          {/* WhatsApp Confirmation toggle (Admin only) */}
          {isAdmin && (
            <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/20 p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  <Label className="text-sm font-medium">Enable WhatsApp Confirmation</Label>
                  <Badge
                    variant="outline"
                    className={cn(
                      "text-[10px] h-5",
                      whatsappEnabled
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-muted-foreground/30 bg-muted text-muted-foreground",
                    )}
                  >
                    {whatsappEnabled ? "WhatsApp Enabled" : "Agent Confirmation"}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">
                  If enabled, all new orders for this product will go through WhatsApp confirmation before reaching agents.
                </p>
              </div>
              <Switch
                checked={whatsappEnabled}
                onCheckedChange={(v) => setPendingWhatsappValue(v)}
              />
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate}>Create Product</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={pendingWhatsappValue !== null} onOpenChange={(o) => { if (!o) setPendingWhatsappValue(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {pendingWhatsappValue ? "Enable WhatsApp Confirmation?" : "Disable WhatsApp Confirmation?"}
          </AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">
            {pendingWhatsappValue
              ? "Are you sure you want to enable WhatsApp confirmation for this product?\n\nAll new orders will be handled by the WhatsApp automation first and will not appear in the agent queue unless needed."
              : "Are you sure you want to disable WhatsApp confirmation for this product?\n\nNew orders will go directly to agents for manual confirmation."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => { e.preventDefault(); confirmWhatsappChange(); }}
            className={pendingWhatsappValue === false ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            Confirm
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
