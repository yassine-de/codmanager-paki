import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, Loader2, Upload, X, ImageIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const countries = [
  "Morocco", "Turkey", "China", "UAE", "Saudi Arabia", "Egypt",
  "France", "Spain", "Germany", "USA", "UK", "India",
];

interface SourcingRequest {
  id: string;
  product_name: string;
  quantity: number;
  destination_country: string;
  shipping_method: string;
  product_url: string;
  notes: string | null;
  product_image_url: string | null;
  variants: any[] | null;
}

interface Props {
  request: SourcingRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface VariantItem {
  name: string;
  quantity: number | "";
  subVariants?: { name: string; quantity: number | "" }[];
}

export function EditSellerSourcingModal({ request, open, onOpenChange }: Props) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [country, setCountry] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [hasVariants, setHasVariants] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [prevId, setPrevId] = useState<string | null>(null);
  if (request && request.id !== prevId) {
    setPrevId(request.id);
    setProductName(request.product_name);
    setQuantity(request.quantity);
    setCountry(request.destination_country);
    setShippingMethod(request.shipping_method);
    setProductUrl(request.product_url || "");
    setNotes(request.notes || "");
    setImageFile(null);
    setImagePreview(request.product_image_url || null);
    setErrors({});

    const v = request.variants;
    if (v && Array.isArray(v) && v.length > 0) {
      setHasVariants(true);
      setVariants(v.map((vi: any) => ({
        name: vi.name || "",
        quantity: vi.quantity ?? "",
        subVariants: vi.subVariants?.map((sv: any) => ({ name: sv.name || "", quantity: sv.quantity ?? "" })) || undefined,
      })));
    } else {
      setHasVariants(false);
      setVariants([]);
    }
  }

  // Auto-calculate total quantity from variants
  useEffect(() => {
    if (!hasVariants || variants.length === 0) return;
    const total = variants.reduce((sum, v) => {
      if (v.subVariants && v.subVariants.length > 0) {
        return sum + v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0);
      }
      return sum + (typeof v.quantity === "number" ? v.quantity : 0);
    }, 0);
    setQuantity(total > 0 ? total : "");
  }, [hasVariants, variants]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be less than 5MB"); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const updateVariantQty = (vi: number, val: number | "") => {
    setVariants(prev => prev.map((v, i) => i === vi ? { ...v, quantity: val } : v));
  };

  const updateSubVariantQty = (vi: number, si: number, val: number | "") => {
    setVariants(prev => prev.map((v, i) => i === vi ? {
      ...v,
      subVariants: v.subVariants?.map((sv, j) => j === si ? { ...sv, quantity: val } : sv),
    } : v));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!country) errs.country = "Country is required";
    if (!shippingMethod) errs.shippingMethod = "Shipping method is required";

    if (hasVariants) {
      variants.forEach((v, i) => {
        if (v.subVariants && v.subVariants.length > 0) {
          v.subVariants.forEach((sv, j) => {
            if (!sv.quantity || sv.quantity <= 0) errs[`sv_qty_${i}_${j}`] = "> 0";
          });
        } else {
          if (!v.quantity || v.quantity <= 0) errs[`v_qty_${i}`] = "> 0";
        }
      });
    } else {
      if (!quantity || quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!request || !authUser) return;

      let productImageUrl = imagePreview || "";
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() || "jpg";
        const filePath = `${authUser.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("sourcing-images").upload(filePath, imageFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("sourcing-images").getPublicUrl(filePath);
        productImageUrl = urlData.publicUrl;
      }

      const variantsData = hasVariants
        ? variants.map(v => ({
            name: v.name,
            quantity: v.subVariants && v.subVariants.length > 0
              ? v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0)
              : Number(v.quantity),
            ...(v.subVariants && v.subVariants.length > 0
              ? { subVariants: v.subVariants.map(sv => ({ name: sv.name, quantity: Number(sv.quantity) })) }
              : {}),
          }))
        : null;

      const { error } = await supabase
        .from("sourcing_requests")
        .update({
          product_name: productName.trim(),
          quantity: Number(quantity),
          destination_country: country,
          shipping_method: shippingMethod,
          product_url: productUrl.trim(),
          notes: notes.trim() || "",
          product_image_url: productImageUrl,
          variants: variantsData as any,
          updated_at: new Date().toISOString(),
          admin_seen: false,
        })
        .eq("id", request.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seller-sourcing"] });
      onOpenChange(false);
      toast.success("Request updated");
    },
    onError: () => { toast.error("Failed to update request"); },
  });

  if (!request) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">Edit Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Product Name */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Product Name *</Label>
            <Input value={productName} onChange={(e) => setProductName(e.target.value)}
              className={`h-9 text-sm ${errors.productName ? "border-destructive" : ""}`} />
            {errors.productName && <p className="text-[11px] text-destructive">{errors.productName}</p>}
          </div>

          {/* Variants (quantity only editable, names read-only) */}
          {hasVariants && variants.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium">Variant Quantities *</Label>
              {variants.map((v, vi) => (
                <div key={vi} className="rounded-lg border bg-card">
                  <div className="flex items-center gap-2 p-2.5">
                    <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {vi + 1}
                    </div>
                    <span className="text-xs font-medium flex-1">{v.name}</span>
                    {(!v.subVariants || v.subVariants.length === 0) && (
                      <Input
                        type="number" min={1}
                        value={v.quantity}
                        onChange={e => updateVariantQty(vi, e.target.value ? Number(e.target.value) : "")}
                        placeholder="Qty"
                        className={`h-8 text-xs w-[72px] ${errors[`v_qty_${vi}`] ? "border-destructive" : ""}`}
                      />
                    )}
                    {v.subVariants && v.subVariants.length > 0 && (
                      <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-[72px] text-center">
                        = {v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0)}
                      </span>
                    )}
                  </div>
                  {v.subVariants && v.subVariants.length > 0 && (
                    <div className="border-t bg-muted/20 px-2.5 pb-2 pt-1.5 space-y-1.5">
                      {v.subVariants.map((sv, si) => (
                        <div key={si} className="flex items-center gap-2 pl-7">
                          <span className="text-[10px] text-muted-foreground shrink-0">↳</span>
                          <span className="text-[11px] flex-1">{sv.name}</span>
                          <Input
                            type="number" min={1}
                            value={sv.quantity}
                            onChange={e => updateSubVariantQty(vi, si, e.target.value ? Number(e.target.value) : "")}
                            placeholder="Qty"
                            className={`h-7 text-[11px] w-[64px] ${errors[`sv_qty_${vi}_${si}`] ? "border-destructive" : ""}`}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Total Quantity</span>
                <span className="text-sm font-bold tabular-nums">{quantity || 0}</span>
              </div>
            </div>
          )}

          {/* Quantity (no variants) */}
          {!hasVariants && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Quantity *</Label>
              <Input type="number" min={1} value={quantity}
                onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
              {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
            </div>
          )}

          {/* Country + Shipping */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Destination Country *</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className={`h-9 text-sm ${errors.country ? "border-destructive" : ""}`}>
                  <SelectValue placeholder="Select Country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((c) => (<SelectItem key={c} value={c}>{c}</SelectItem>))}
                </SelectContent>
              </Select>
              {errors.country && <p className="text-[11px] text-destructive">{errors.country}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Shipping Method *</Label>
              <Select value={shippingMethod} onValueChange={setShippingMethod}>
                <SelectTrigger className={`h-9 text-sm ${errors.shippingMethod ? "border-destructive" : ""}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sea">By Sea 🚢</SelectItem>
                  <SelectItem value="air">By Air ✈️</SelectItem>
                </SelectContent>
              </Select>
              {errors.shippingMethod && <p className="text-[11px] text-destructive">{errors.shippingMethod}</p>}
            </div>
          </div>

          {/* Product URL */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Product URL</Label>
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={productUrl} onChange={(e) => setProductUrl(e.target.value)}
                placeholder="https://..."
                className="h-9 text-sm pl-9" />
            </div>
          </div>

          {/* Image */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Product Image</Label>
            {imagePreview ? (
              <div className="relative w-20 h-20">
                <img src={imagePreview} alt="Preview" className="w-20 h-20 rounded-lg object-cover border" />
                <button type="button" onClick={removeImage}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm hover:bg-destructive/90">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => fileInputRef.current?.click()}
                className="w-full h-16 rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
                <Upload className="h-4 w-4" />
                <span className="text-[11px]">Click to upload</span>
              </button>
            )}
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes..."
              className="text-sm min-h-[60px] resize-none" maxLength={500} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={() => { if (validate()) updateMutation.mutate(); }} disabled={updateMutation.isPending}>
            {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
