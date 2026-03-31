import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, ExternalLink, Video, Tag, Loader2, Weight } from "lucide-react";
import { toast } from "sonner";
import { type Product, type ProductVariant, type ProductOffer } from "@/lib/products-data";
import { supabase } from "@/integrations/supabase/client";

const isValidUrl = (str: string): boolean => {
  if (!str.trim()) return false;
  // Accept URLs like google.com, www.google.com, https://google.com
  const pattern = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)$/i;
  return pattern.test(str.trim());
};

interface EditProductModalProps {
  product: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (updated: Product) => void;
}

export function EditProductModal({ product, open, onOpenChange, onSave }: EditProductModalProps) {
  const { authUser } = useAuth();
  const isSeller = authUser?.role === "seller";
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [seller, setSeller] = useState("");
  const [sku, setSku] = useState("");
  const [image, setImage] = useState("");
  const [price, setPrice] = useState(0);
  const [totalQty, setTotalQty] = useState(0);
  const [variants, setVariants] = useState<ProductVariant[]>([]);
  const [storeLink, setStoreLink] = useState("");
  const [videoLink, setVideoLink] = useState("");
  const [lastSellingPrice, setLastSellingPrice] = useState(0);
  const [lastPrice, setLastPrice] = useState(0);
  const [offers, setOffers] = useState<ProductOffer[]>([]);
  const [weight, setWeight] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [prevId, setPrevId] = useState<string | null>(null);

  // Check if this is a DB product (UUID format)
  const isDbProduct = product ? /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(product.id) : false;

  const dbUpdateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("products")
        .update({
          name: name.trim(),
          price: lastSellingPrice,
          landed_price: price,
          last_price: lastPrice,
          offers: offers.map(o => ({ quantity: o.quantity, price: o.price })),
          quantity: totalQty,
          weight: weight || null,
          product_url: storeLink.trim(),
          video_url: videoLink.trim(),
          image_url: image.trim(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", product!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["db-products"] });
      onOpenChange(false);
      toast.success("Product updated");
    },
    onError: () => {
      toast.error("Failed to update product");
    },
  });

  if (product && product.id !== prevId) {
    setPrevId(product.id);
    setName(product.name);
    setSeller(product.seller);
    setSku(product.sku);
    setImage(product.image);
    setPrice(product.price);
    setTotalQty(product.totalQty);
    setVariants(product.variants.map(v => ({ ...v })));
    setStoreLink(product.storeLink || "");
    setVideoLink(product.videoLink || "");
    setLastSellingPrice(product.lastSellingPrice || 0);
    setLastPrice(product.lastPrice || 0);
    setOffers(product.offers?.map(o => ({ ...o })) || []);
    setWeight(product.weight || "");
    setErrors({});
  }

  const addVariant = () => {
    setVariants(prev => [...prev, { id: `VAR-${Date.now()}-${prev.length}`, name: "", sku: "", price, quantity: 0 }]);
  };
  const updateVariant = (i: number, field: keyof ProductVariant, value: string | number) => {
    setVariants(prev => prev.map((v, idx) => (idx === i ? { ...v, [field]: value } : v)));
  };
  const removeVariant = (i: number) => setVariants(prev => prev.filter((_, idx) => idx !== i));

  const addOffer = () => {
    setOffers(prev => [...prev, { id: `OFF-${Date.now()}-${prev.length}`, quantity: 1, price: 0 }]);
  };
  const updateOffer = (i: number, field: keyof ProductOffer, value: string | number) => {
    setOffers(prev => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  };
  const removeOffer = (i: number) => setOffers(prev => prev.filter((_, idx) => idx !== i));

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!seller.trim()) errs.seller = "Required";
    if (!name.trim()) errs.name = "Required";
    if (!sku.trim()) errs.sku = "Required";
    if (price <= 0) errs.price = "Must be > 0";
    if (totalQty <= 0) errs.totalQty = "Must be > 0";
    if (isDbProduct) {
      if (isSeller) {
        if (!storeLink.trim()) {
          errs.storeLink = "Product link is required";
        } else if (!isValidUrl(storeLink)) {
          errs.storeLink = "Invalid URL format";
        }
        if (!videoLink.trim()) {
          errs.videoLink = "Video link is required";
        } else if (!isValidUrl(videoLink)) {
          errs.videoLink = "Invalid URL format";
        }
      } else {
        if (storeLink.trim() && !isValidUrl(storeLink)) {
          errs.storeLink = "Invalid URL format";
        }
        if (videoLink.trim() && !isValidUrl(videoLink)) {
          errs.videoLink = "Invalid URL format";
        }
      }
      if (isSeller && lastSellingPrice <= 0) {
        errs.sellingPrice = "Selling price is required";
      }
    }
    variants.forEach((v, i) => {
      if (!v.name.trim()) errs[`v_name_${i}`] = "Required";
      if (v.price <= 0) errs[`v_price_${i}`] = "Must be > 0";
    });
    offers.forEach((o, i) => {
      if (o.quantity <= 0) errs[`o_qty_${i}`] = "Must be > 0";
      if (o.price <= 0) errs[`o_price_${i}`] = "Must be > 0";
    });
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  if (!product) return null;

  const handleSave = () => {
    if (!validate()) return;
    if (isDbProduct) {
      dbUpdateMutation.mutate();
    } else {
      const qtyDiff = totalQty - product.totalQty;
      onSave({
        ...product,
        name: name.trim(),
        seller: seller.trim(),
        sku: sku.trim(),
        image: image.trim(),
        price,
        totalQty,
        available: Math.max(0, product.available + qtyDiff),
        variants: variants.map(v => ({
          ...v,
          name: v.name.trim(),
          sku: v.sku.trim() || `${sku}-${v.name.trim().toUpperCase().replace(/\s/g, '')}`,
        })),
        storeLink: storeLink.trim(),
        videoLink: videoLink.trim(),
        lastSellingPrice,
        lastPrice,
        offers,
        weight,
      });
      onOpenChange(false);
      toast.success("Product updated");
    }
  };

  const sectionTitle = "text-xs font-semibold text-foreground uppercase tracking-wider mb-2";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Edit Product
            {product.displayId && <span className="ml-2 text-xs font-normal text-muted-foreground">{product.displayId}</span>}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh]">
          <div className="px-5 py-4 space-y-5">
            {/* Image preview */}
            {product.image && (
              <div className="flex justify-center">
                <img src={product.image} alt={product.name} className="w-16 h-16 rounded-lg object-cover" />
              </div>
            )}

            {/* Basic Info */}
            <div>
              <h3 className={sectionTitle}>Basic Information</h3>
              <div className="grid grid-cols-2 gap-3">
                {!isSeller && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Seller *</Label>
                    <Input value={seller} onChange={e => setSeller(e.target.value)} className={`h-9 text-sm ${errors.seller ? "border-destructive" : ""}`} disabled={isDbProduct} />
                    {errors.seller && <p className="text-[11px] text-destructive">{errors.seller}</p>}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Product Name *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} className={`h-9 text-sm ${errors.name ? "border-destructive" : ""}`} />
                  {errors.name && <p className="text-[11px] text-destructive">{errors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">SKU *</Label>
                  <Input value={sku} onChange={e => setSku(e.target.value)} className={`h-9 text-sm ${errors.sku ? "border-destructive" : ""}`} disabled={isDbProduct} />
                  {errors.sku && <p className="text-[11px] text-destructive">{errors.sku}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Image URL</Label>
                  <Input value={image} onChange={e => setImage(e.target.value)} placeholder="https://..." className="h-9 text-sm" />
                </div>
              </div>
            </div>

            {/* Pricing & Stock */}
            <div>
              <h3 className={sectionTitle}>Pricing & Stock</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Buying Price ($) *</Label>
                  <Input type="number" min={0.01} step={0.01} value={price} onChange={e => setPrice(Number(e.target.value))} className={`h-9 text-sm ${errors.price ? "border-destructive" : ""}`} disabled={isSeller} />
                  {errors.price && <p className="text-[11px] text-destructive">{errors.price}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Selling Price ($) {isSeller && isDbProduct && <span className="text-destructive">*</span>}</Label>
                  <Input type="number" min={0} step={0.01} value={lastSellingPrice || ""} onChange={e => setLastSellingPrice(Number(e.target.value))} placeholder={isSeller ? "Enter selling price" : ""} className={`h-9 text-sm ${errors.sellingPrice ? "border-destructive" : ""}`} />
                  {errors.sellingPrice && <p className="text-[11px] text-destructive">{errors.sellingPrice}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Total Quantity *</Label>
                  <Input type="number" min={1} step={1} value={totalQty} onChange={e => setTotalQty(Number(e.target.value))} className={`h-9 text-sm ${errors.totalQty ? "border-destructive" : ""}`} disabled={isSeller} />
                  {errors.totalQty && <p className="text-[11px] text-destructive">{errors.totalQty}</p>}
                </div>
              </div>
              {/* Stock summary */}
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Delivered</p>
                  <p className="text-sm font-semibold tabular-nums mt-0.5">{product.delivered}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Shipped</p>
                  <p className="text-sm font-semibold tabular-nums mt-0.5">{product.shipped}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-2.5 text-center">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Available</p>
                  <p className="text-sm font-semibold tabular-nums mt-0.5">{Math.max(0, product.available + (totalQty - product.totalQty))}</p>
                </div>
              </div>
            </div>

            {/* Weight */}
            <div>
              <h3 className={sectionTitle}>
                <span className="flex items-center gap-1.5">
                  <Weight className="w-3.5 h-3.5 text-muted-foreground" />
                  Weight
                </span>
              </h3>
              <div className="w-1/2">
                {isSeller ? (
                  <div className="h-9 flex items-center px-3 rounded-md border bg-muted/50 text-sm text-muted-foreground">
                    {weight === "up_to_1kg" ? "Up to 1 kg" : weight === "up_to_2kg" ? "Up to 2 kg" : weight === "up_to_3kg" ? "Up to 3 kg" : weight === "more_than_3kg" ? "More than 3 kg" : "Not set"}
                  </div>
                ) : (
                  <Select value={weight} onValueChange={setWeight}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select weight bracket" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="up_to_1kg">Up to 1 kg</SelectItem>
                      <SelectItem value="up_to_2kg">Up to 2 kg</SelectItem>
                      <SelectItem value="up_to_3kg">Up to 3 kg</SelectItem>
                      <SelectItem value="more_than_3kg">More than 3 kg</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Links */}
            <div>
              <h3 className={sectionTitle}>Links</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className={`text-xs flex items-center gap-1.5 ${errors.storeLink ? "text-destructive" : ""}`}>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" /> Product Link {isDbProduct && isSeller && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    value={storeLink}
                    onChange={e => setStoreLink(e.target.value)}
                    placeholder="www.google.com, https://store.com/..."
                    className={`h-9 text-sm ${errors.storeLink ? "border-destructive" : ""}`}
                  />
                  {errors.storeLink && <p className="text-[11px] text-destructive">{errors.storeLink}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className={`text-xs flex items-center gap-1.5 ${errors.videoLink ? "text-destructive" : ""}`}>
                    <Video className="w-3 h-3 text-muted-foreground" /> Video Link {isDbProduct && isSeller && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    value={videoLink}
                    onChange={e => setVideoLink(e.target.value)}
                    placeholder="www.youtube.com/..., https://..."
                    className={`h-9 text-sm ${errors.videoLink ? "border-destructive" : ""}`}
                  />
                  {errors.videoLink && <p className="text-[11px] text-destructive">{errors.videoLink}</p>}
                </div>
              </div>
            </div>

            {/* Offers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className={sectionTitle + " mb-0"}>
                  <span className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                    Offers
                    {offers.length > 0 && (
                      <span className="inline-flex items-center justify-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">
                        {offers.length}
                      </span>
                    )}
                  </span>
                </h3>
                <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addOffer}>
                  <Plus className="h-3 w-3" /> Add Offer
                </Button>
              </div>
              {offers.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center">
                  <p className="text-xs text-muted-foreground">No offers yet. Add quantity-based pricing offers.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {offers.map((offer, i) => (
                    <div key={offer.id} className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Quantity *</Label>
                          <Input
                            type="number" min={1} step={1} value={offer.quantity}
                            onChange={e => updateOffer(i, "quantity", Math.max(1, Number(e.target.value)))}
                            className={`h-8 text-xs ${errors[`o_qty_${i}`] ? "border-destructive" : ""}`}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Price ($) *</Label>
                          <Input
                            type="number" min={0.01} step={0.01} value={offer.price}
                            onChange={e => updateOffer(i, "price", Math.max(0, Number(e.target.value)))}
                            className={`h-8 text-xs ${errors[`o_price_${i}`] ? "border-destructive" : ""}`}
                          />
                        </div>
                      </div>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => removeOffer(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Last Selling Price (for agent) */}
            <div>
              <h3 className={sectionTitle}>Last Selling Price</h3>
              <p className="text-[11px] text-muted-foreground mb-2">This price will be shown to the confirmation agent</p>
              <div className="w-1/2">
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={lastPrice}
                  onChange={e => setLastPrice(Number(e.target.value))}
                  className="h-9 text-sm"
                  placeholder="0"
                />
              </div>
            </div>

            {/* Variants */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className={sectionTitle + " mb-0"}>
                  Variants
                  {variants.length > 0 && (
                    <span className="ml-1.5 inline-flex items-center justify-center rounded-full bg-primary/10 text-primary px-1.5 py-0.5 text-[10px] font-semibold">
                      {variants.length}
                    </span>
                  )}
                </h3>
                {!isSeller && (
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addVariant}>
                    <Plus className="h-3 w-3" /> Add Variant
                  </Button>
                )}
              </div>
              {variants.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center">
                  <p className="text-xs text-muted-foreground">No variants yet. Add variants like colors, sizes, etc.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {variants.map((variant, i) => (
                    <div key={variant.id} className="rounded-lg border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Variant {i + 1}</span>
                        {!isSeller && (
                          <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:bg-destructive/10" onClick={() => removeVariant(i)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Name *</Label>
                          <Input value={variant.name} onChange={e => updateVariant(i, "name", e.target.value)} placeholder="e.g. Black, XL" className={`h-8 text-xs ${errors[`v_name_${i}`] ? "border-destructive" : ""}`} disabled={isSeller} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Price ($)</Label>
                          <Input type="number" min={0.01} step={0.01} value={variant.price} onChange={e => updateVariant(i, "price", Number(e.target.value))} className={`h-8 text-xs ${errors[`v_price_${i}`] ? "border-destructive" : ""}`} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[10px] text-muted-foreground">Quantity</Label>
                          <Input type="number" min={0} step={1} value={variant.quantity} onChange={e => updateVariant(i, "quantity", Number(e.target.value))} className={`h-8 text-xs`} disabled={isSeller} />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">SKU <span className="text-muted-foreground/60">(auto if empty)</span></Label>
                        <Input value={variant.sku} onChange={e => updateVariant(i, "sku", e.target.value)} placeholder={`${sku}-${variant.name.toUpperCase().replace(/\s/g, '') || '...'}`} className="h-8 text-xs" />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={dbUpdateMutation.isPending}>
            {dbUpdateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
