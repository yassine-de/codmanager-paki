import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Link2, Loader2, Upload, X, Plus, Trash2, Package, PackagePlus, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { SearchableSelect } from "@/components/SearchableSelect";

const countries = ["Pakistan"];

interface VariantItem {
  id: string;
  name: string;
  quantity: number | "";
  subVariants: { id: string; name: string; quantity: number | "" }[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type ProductType = null | "existing" | "new";

export function CreateSellerSourcingModal({ open, onOpenChange }: Props) {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step management
  const [productType, setProductType] = useState<ProductType>(null);
  const [showValidateConfirm, setShowValidateConfirm] = useState(false);

  // Existing product fields
  const [selectedProductId, setSelectedProductId] = useState("");

  // Common / new product fields
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [country, setCountry] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasVariants, setHasVariants] = useState(false);
  const [variants, setVariants] = useState<VariantItem[]>([]);

  // Fetch seller's products
  const { data: sellerProducts = [] } = useQuery({
    queryKey: ["seller-products-for-sourcing", authUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, image_url, variants, quantity")
        .eq("seller_id", authUser!.id)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!authUser && open,
  });

  // When existing product selected, populate fields
  const selectedProduct = sellerProducts.find(p => p.id === selectedProductId);

  useEffect(() => {
    if (!selectedProduct) return;
    setProductName(selectedProduct.name);
    setImagePreview(selectedProduct.image_url || null);

    // Handle variants from existing product
    const prodVariants = selectedProduct.variants as any[] | null;
    if (prodVariants && prodVariants.length > 0) {
      setHasVariants(true);
      const mapped: VariantItem[] = prodVariants.map((v: any, i: number) => ({
        id: `v-${Date.now()}-${i}`,
        name: v.name || "",
        quantity: "" as number | "",
        subVariants: v.subVariants
          ? v.subVariants.map((sv: any, j: number) => ({
              id: `sv-${Date.now()}-${j}`,
              name: sv.name || "",
              quantity: "" as number | "",
            }))
          : [],
      }));
      setVariants(mapped);
      setQuantity("");
    } else {
      setHasVariants(false);
      setVariants([]);
      setQuantity("");
    }
  }, [selectedProductId]);

  // Auto-calculate total quantity
  useEffect(() => {
    if (!hasVariants || variants.length === 0) return;
    const total = variants.reduce((sum, v) => {
      if (v.subVariants.length > 0) {
        return sum + v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0);
      }
      return sum + (typeof v.quantity === "number" ? v.quantity : 0);
    }, 0);
    setQuantity(total > 0 ? total : "");
  }, [hasVariants, variants]);

  const resetForm = () => {
    setProductType(null);
    setSelectedProductId("");
    setProductName(""); setQuantity(""); setCountry(""); setShippingMethod("");
    setProductUrl(""); setNotes(""); setImageFile(null); setImagePreview(null);
    setErrors({}); setHasVariants(false); setVariants([]);
    setShowValidateConfirm(false);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Image must be less than 5MB"); return; }
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const removeImage = () => {
    setImageFile(null); setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleVariantToggle = (checked: boolean) => {
    setHasVariants(checked);
    if (checked) {
      setVariants([{ id: `v-${Date.now()}`, name: "", quantity: "", subVariants: [] }]);
      setQuantity("");
    } else {
      setVariants([]);
      setQuantity("");
    }
  };

  const addVariant = () => {
    setVariants(prev => [...prev, { id: `v-${Date.now()}-${prev.length}`, name: "", quantity: "", subVariants: [] }]);
  };

  const updateVariant = (i: number, field: "name" | "quantity", value: string | number) => {
    setVariants(prev => prev.map((v, idx) => idx === i ? { ...v, [field]: value } : v));
  };

  const removeVariant = (i: number) => setVariants(prev => prev.filter((_, idx) => idx !== i));

  const addSubVariant = (vi: number) => {
    setVariants(prev => prev.map((v, i) => i === vi ? {
      ...v,
      quantity: "",
      subVariants: [...v.subVariants, { id: `sv-${Date.now()}-${v.subVariants.length}`, name: "", quantity: "" }],
    } : v));
  };

  const updateSubVariant = (vi: number, si: number, field: "name" | "quantity", value: string | number) => {
    setVariants(prev => prev.map((v, i) => i === vi ? {
      ...v,
      subVariants: v.subVariants.map((sv, j) => j === si ? { ...sv, [field]: value } : sv),
    } : v));
  };

  const removeSubVariant = (vi: number, si: number) => {
    setVariants(prev => prev.map((v, i) => i === vi ? {
      ...v,
      subVariants: v.subVariants.filter((_, j) => j !== si),
    } : v));
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!country) errs.country = "Country is required";
    if (!shippingMethod) errs.shippingMethod = "Shipping method is required";

    // Product URL only required for new products
    if (productType === "new" && !productUrl.trim()) errs.productUrl = "Product URL is required";

    if (hasVariants) {
      if (variants.length === 0) errs.variants = "Add at least one variant";
      variants.forEach((v, i) => {
        if (!v.name.trim()) errs[`v_name_${i}`] = "Required";
        if (v.subVariants.length === 0) {
          if (!v.quantity || v.quantity <= 0) errs[`v_qty_${i}`] = "> 0";
        } else {
          v.subVariants.forEach((sv, j) => {
            if (!sv.name.trim()) errs[`sv_name_${i}_${j}`] = "Required";
            if (!sv.quantity || sv.quantity <= 0) errs[`sv_qty_${i}_${j}`] = "> 0";
          });
        }
      });
    } else {
      if (!quantity || quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: async (autoValidate: boolean) => {
      let productImageUrl = "";

      // If existing product, use its image
      if (productType === "existing" && selectedProduct?.image_url && !imageFile) {
        productImageUrl = selectedProduct.image_url;
      }

      if (imageFile) {
        const ext = imageFile.name.split(".").pop() || "jpg";
        const filePath = `${authUser!.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("sourcing-images").upload(filePath, imageFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("sourcing-images").getPublicUrl(filePath);
        productImageUrl = urlData.publicUrl;
      }

      const variantsData = hasVariants
        ? variants.map(v => ({
            name: v.name.trim(),
            quantity: v.subVariants.length > 0
              ? v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0)
              : Number(v.quantity),
            ...(v.subVariants.length > 0
              ? { subVariants: v.subVariants.map(sv => ({ name: sv.name.trim(), quantity: Number(sv.quantity) })) }
              : {}),
          }))
        : null;

      const insertData: Record<string, unknown> = {
        seller_id: authUser!.id,
        product_name: productName.trim(),
        quantity: Number(quantity),
        destination_country: country,
        shipping_method: shippingMethod,
        product_url: productUrl.trim(),
        notes: notes.trim() || "",
        status: autoValidate ? "validated" : "waiting_quote",
        seller_validated: autoValidate ? true : null,
        admin_seen: false,
        product_image_url: productImageUrl,
        variants: variantsData as any,
      };
      if (productType === "existing" && selectedProductId) {
        insertData.source_product_id = selectedProductId;
      }
      const { error } = await supabase.from("sourcing_requests").insert(insertData as any);
      if (error) throw error;
    },
    onSuccess: (_, autoValidate) => {
      queryClient.invalidateQueries({ queryKey: ["seller-sourcing"] });
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing-unseen"] });
      onOpenChange(false);
      resetForm();
      toast.success(autoValidate ? "Sourcing request created & validated" : "Sourcing request created");
    },
    onError: () => { toast.error("Failed to create request"); },
  });

  const handleCreate = () => {
    if (!validate()) return;
    // Only show auto-validate for existing products (restock)
    if (productType === "existing") {
      setShowValidateConfirm(true);
    } else {
      // New products go directly as waiting_quote
      createMutation.mutate(false);
    }
  };

  const handleConfirmCreate = (autoValidate: boolean) => {
    setShowValidateConfirm(false);
    createMutation.mutate(autoValidate);
  };

  // Product type selection screen
  if (productType === null) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle className="text-base">New Sourcing Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground text-center">Choose the product source</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setProductType("existing")}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <Package className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">Existing Product</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">From your catalog</p>
                </div>
              </button>
              <button
                onClick={() => setProductType("new")}
                className="flex flex-col items-center gap-3 p-5 rounded-xl border-2 border-border hover:border-primary hover:bg-primary/5 transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                  <PackagePlus className="h-6 w-6 text-primary" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold">New Product</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Add a new item</p>
                </div>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Auto-validate confirmation screen
  if (showValidateConfirm) {
    return (
      <Dialog open={open} onOpenChange={(v) => { if (!v) { resetForm(); } onOpenChange(v); }}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle className="text-base">Auto-validate this request?</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="flex items-start gap-3 rounded-lg border bg-success/5 border-success/20 p-3">
              <ShieldCheck className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Skip validation step</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  The request will be sent directly as "Validated" to the admin for sourcing.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => handleConfirmCreate(false)} disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              No, waiting quote
            </Button>
            <Button size="sm" onClick={() => handleConfirmCreate(true)} disabled={createMutation.isPending}
              className="bg-success hover:bg-success/90 text-success-foreground">
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Yes, auto-validate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setProductType(null); setSelectedProductId(""); }}>
              ← Back
            </Button>
            {productType === "existing" ? "Existing Product Sourcing" : "New Product Sourcing"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ---- EXISTING PRODUCT: Product selector ---- */}
          {productType === "existing" && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-5 rounded-full bg-primary" />
                <span className="text-sm font-medium">Select Product</span>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Product *</Label>
                <SearchableSelect
                  value={selectedProductId}
                  onValueChange={setSelectedProductId}
                  options={sellerProducts.map(p => ({ value: p.id, label: p.name }))}
                  placeholder="Choose a product..."
                  className="w-full"
                />
              </div>

              {selectedProduct && (
                <>
                  {/* Product preview */}
                  <div className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3">
                    {selectedProduct.image_url ? (
                      <img src={selectedProduct.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg border bg-muted flex items-center justify-center">
                        <Package className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{selectedProduct.name}</p>
                      <p className="text-[11px] text-muted-foreground">Stock: {selectedProduct.quantity} units</p>
                    </div>
                  </div>

                  {/* Variants from product (quantity editable) */}
                  {hasVariants && variants.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs font-medium">Variant Quantities *</Label>
                      {variants.map((v, vi) => (
                        <div key={v.id} className="rounded-lg border bg-card">
                          <div className="flex items-center gap-2 p-2.5">
                            <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                              {vi + 1}
                            </div>
                            <span className="text-xs font-medium flex-1">{v.name}</span>
                            {v.subVariants.length === 0 && (
                              <Input
                                type="number" min={1}
                                value={v.quantity}
                                onChange={e => updateVariant(vi, "quantity", e.target.value ? Number(e.target.value) : "")}
                                placeholder="Qty"
                                className={`h-8 text-xs w-[72px] ${errors[`v_qty_${vi}`] ? "border-destructive" : ""}`}
                              />
                            )}
                            {v.subVariants.length > 0 && (
                              <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-[72px] text-center">
                                = {v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0)}
                              </span>
                            )}
                          </div>
                          {v.subVariants.length > 0 && (
                            <div className="border-t bg-muted/20 px-2.5 pb-2 pt-1.5 space-y-1.5">
                              {v.subVariants.map((sv, si) => (
                                <div key={sv.id} className="flex items-center gap-2 pl-7">
                                  <span className="text-[10px] text-muted-foreground shrink-0">↳</span>
                                  <span className="text-[11px] flex-1">{sv.name}</span>
                                  <Input
                                    type="number" min={1}
                                    value={sv.quantity}
                                    onChange={e => updateSubVariant(vi, si, "quantity", e.target.value ? Number(e.target.value) : "")}
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

                  {/* Quantity (no variants) for existing product */}
                  {!hasVariants && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-medium">Quantity *</Label>
                      <Input type="number" min={1} step={1} value={quantity}
                        onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                        placeholder="0" className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
                      {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ---- NEW PRODUCT: Full form ---- */}
          {productType === "new" && (
            <>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-1 h-5 rounded-full bg-primary" />
                <span className="text-sm font-medium">Sourcing Informations</span>
              </div>

              {/* Product Name */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Product Name *</Label>
                <Input value={productName} onChange={(e) => setProductName(e.target.value)}
                  placeholder="e.g. Wireless Earbuds Pro"
                  className={`h-9 text-sm ${errors.productName ? "border-destructive" : ""}`} />
                {errors.productName && <p className="text-[11px] text-destructive">{errors.productName}</p>}
              </div>

              {/* Variant Toggle */}
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2.5">
                <div>
                  <p className="text-xs font-medium">This product has variants</p>
                  <p className="text-[11px] text-muted-foreground">e.g. sizes, colors, etc.</p>
                </div>
                <Switch checked={hasVariants} onCheckedChange={handleVariantToggle} />
              </div>

              {/* Variants */}
              {hasVariants && (
                <div className="space-y-2">
                  {variants.map((v, vi) => (
                    <div key={v.id} className="rounded-lg border bg-card">
                      <div className="flex items-center gap-2 p-2.5">
                        <div className="w-5 h-5 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                          {vi + 1}
                        </div>
                        <Input
                          value={v.name}
                          onChange={e => updateVariant(vi, "name", e.target.value)}
                          placeholder="Variant name (e.g. Size S, Red...)"
                          className={`h-8 text-xs flex-1 ${errors[`v_name_${vi}`] ? "border-destructive" : ""}`}
                        />
                        {v.subVariants.length === 0 && (
                          <Input
                            type="number" min={1}
                            value={v.quantity}
                            onChange={e => updateVariant(vi, "quantity", e.target.value ? Number(e.target.value) : "")}
                            placeholder="Qty"
                            className={`h-8 text-xs w-[72px] ${errors[`v_qty_${vi}`] ? "border-destructive" : ""}`}
                          />
                        )}
                        {v.subVariants.length > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums text-muted-foreground w-[72px] text-center">
                            = {v.subVariants.reduce((s, sv) => s + (typeof sv.quantity === "number" ? sv.quantity : 0), 0)}
                          </span>
                        )}
                        <Button type="button" variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => removeVariant(vi)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                      {v.subVariants.length > 0 && (
                        <div className="border-t bg-muted/20 px-2.5 pb-2 pt-1.5 space-y-1.5">
                          {v.subVariants.map((sv, si) => (
                            <div key={sv.id} className="flex items-center gap-2 pl-7">
                              <span className="text-[10px] text-muted-foreground shrink-0">↳</span>
                              <Input
                                value={sv.name}
                                onChange={e => updateSubVariant(vi, si, "name", e.target.value)}
                                placeholder="Sub-variant (e.g. Red, Blue...)"
                                className={`h-7 text-[11px] flex-1 ${errors[`sv_name_${vi}_${si}`] ? "border-destructive" : ""}`}
                              />
                              <Input
                                type="number" min={1}
                                value={sv.quantity}
                                onChange={e => updateSubVariant(vi, si, "quantity", e.target.value ? Number(e.target.value) : "")}
                                placeholder="Qty"
                                className={`h-7 text-[11px] w-[64px] ${errors[`sv_qty_${vi}_${si}`] ? "border-destructive" : ""}`}
                              />
                              <Button type="button" variant="ghost" size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                onClick={() => removeSubVariant(vi, si)}>
                                <X className="h-2.5 w-2.5" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="border-t px-2.5 py-1.5">
                        <Button type="button" variant="ghost" size="sm"
                          className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-primary pl-7"
                          onClick={() => addSubVariant(vi)}>
                          <Plus className="h-2.5 w-2.5" /> Add sub-variant
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full" onClick={addVariant}>
                    <Plus className="h-3.5 w-3.5" /> Add Variant
                  </Button>
                  <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Total Quantity</span>
                    <span className="text-sm font-bold tabular-nums">{quantity || 0}</span>
                  </div>
                  {errors.variants && <p className="text-[11px] text-destructive">{errors.variants}</p>}
                </div>
              )}

              {/* Quantity (no variants) */}
              {!hasVariants && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Quantity *</Label>
                  <Input type="number" min={1} step={1} value={quantity}
                    onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                    placeholder="0" className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
                  {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
                </div>
              )}

              {/* Product URL */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Product URL *</Label>
                <div className="relative">
                  <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input value={productUrl} onChange={(e) => setProductUrl(e.target.value)}
                    placeholder="https://www.alibaba.com/product/..."
                    className={`h-9 text-sm pl-9 ${errors.productUrl ? "border-destructive" : ""}`} />
                </div>
                {errors.productUrl && <p className="text-[11px] text-destructive">{errors.productUrl}</p>}
              </div>

              {/* Image */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Product Image <span className="text-muted-foreground">(optional)</span></Label>
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
                    className="w-full h-20 rounded-lg border-2 border-dashed border-border hover:border-primary/50 transition-colors flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground">
                    <Upload className="h-4 w-4" />
                    <span className="text-[11px]">Click to upload</span>
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
              </div>
            </>
          )}

          {/* ---- COMMON FIELDS (Country, Shipping, Notes) ---- */}
          {(productType === "new" || (productType === "existing" && selectedProduct)) && (
            <>
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
                      <SelectValue placeholder="Not Selected" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="sea">By Sea 🚢</SelectItem>
                      <SelectItem value="air">By Air ✈️</SelectItem>
                    </SelectContent>
                  </Select>
                  {errors.shippingMethod && <p className="text-[11px] text-destructive">{errors.shippingMethod}</p>}
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Notes <span className="text-muted-foreground">(optional)</span></Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add any notes or special requirements..."
                  className="text-sm min-h-[70px] resize-none" maxLength={500} />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending || (productType === "existing" && !selectedProduct)}>
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
