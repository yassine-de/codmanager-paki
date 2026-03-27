import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Link2, Loader2, Upload, X, Plus, Trash2, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const countries = [
  "Morocco", "Turkey", "China", "UAE", "Saudi Arabia", "Egypt",
  "France", "Spain", "Germany", "USA", "UK", "India",
];

interface VariantOption {
  id: string;
  name: string;
  quantity: number | "";
}

interface VariantGroup {
  id: string;
  groupName: string;
  options: VariantOption[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSellerSourcingModal({ open, onOpenChange }: Props) {
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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [hasVariants, setHasVariants] = useState(false);
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);

  // Auto-calculate total quantity from all variant options across groups
  useEffect(() => {
    if (hasVariants && variantGroups.length > 0) {
      const total = variantGroups.reduce((groupSum, g) =>
        groupSum + g.options.reduce((optSum, o) => optSum + (typeof o.quantity === "number" ? o.quantity : 0), 0)
      , 0);
      setQuantity(total > 0 ? total : "");
    }
  }, [hasVariants, variantGroups]);

  const resetForm = () => {
    setProductName(""); setQuantity(""); setCountry(""); setShippingMethod("");
    setProductUrl(""); setNotes(""); setImageFile(null); setImagePreview(null);
    setErrors({}); setHasVariants(false); setVariantGroups([]);
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

  const addVariantGroup = () => {
    setVariantGroups(prev => [...prev, {
      id: `g-${Date.now()}-${prev.length}`,
      groupName: "",
      options: [{ id: `o-${Date.now()}-0`, name: "", quantity: "" }],
    }]);
  };

  const removeVariantGroup = (gi: number) => {
    setVariantGroups(prev => prev.filter((_, i) => i !== gi));
  };

  const updateGroupName = (gi: number, name: string) => {
    setVariantGroups(prev => prev.map((g, i) => i === gi ? { ...g, groupName: name } : g));
  };

  const addOption = (gi: number) => {
    setVariantGroups(prev => prev.map((g, i) => i === gi ? {
      ...g, options: [...g.options, { id: `o-${Date.now()}-${g.options.length}`, name: "", quantity: "" }],
    } : g));
  };

  const updateOption = (gi: number, oi: number, field: "name" | "quantity", value: string | number) => {
    setVariantGroups(prev => prev.map((g, i) => i === gi ? {
      ...g, options: g.options.map((o, j) => j === oi ? { ...o, [field]: value } : o),
    } : g));
  };

  const removeOption = (gi: number, oi: number) => {
    setVariantGroups(prev => prev.map((g, i) => i === gi ? {
      ...g, options: g.options.filter((_, j) => j !== oi),
    } : g));
  };

  const handleVariantToggle = (checked: boolean) => {
    setHasVariants(checked);
    if (checked) {
      setVariantGroups([{
        id: `g-${Date.now()}-0`,
        groupName: "",
        options: [{ id: `o-${Date.now()}-0`, name: "", quantity: "" }],
      }]);
      setQuantity("");
    } else {
      setVariantGroups([]);
      setQuantity("");
    }
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!country) errs.country = "Country is required";
    if (!shippingMethod) errs.shippingMethod = "Shipping method is required";
    if (!productUrl.trim()) errs.productUrl = "Product URL is required";

    if (hasVariants) {
      if (variantGroups.length === 0) errs.variants = "Add at least one variant group";
      variantGroups.forEach((g, gi) => {
        if (!g.groupName.trim()) errs[`g_name_${gi}`] = "Required";
        if (g.options.length === 0) errs[`g_opts_${gi}`] = "Add at least one option";
        g.options.forEach((o, oi) => {
          if (!o.name.trim()) errs[`o_name_${gi}_${oi}`] = "Required";
          if (!o.quantity || o.quantity <= 0) errs[`o_qty_${gi}_${oi}`] = "> 0";
        });
      });
      const total = variantGroups.reduce((s, g) =>
        s + g.options.reduce((os, o) => os + (typeof o.quantity === "number" ? o.quantity : 0), 0), 0);
      if (total <= 0) errs.quantity = "Total quantity must be > 0";
    } else {
      if (!quantity || quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      let productImageUrl = "";
      if (imageFile) {
        const ext = imageFile.name.split(".").pop() || "jpg";
        const filePath = `${authUser!.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from("sourcing-images").upload(filePath, imageFile);
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from("sourcing-images").getPublicUrl(filePath);
        productImageUrl = urlData.publicUrl;
      }

      const variantsData = hasVariants
        ? variantGroups.map(g => ({
            group: g.groupName.trim(),
            options: g.options.map(o => ({ name: o.name.trim(), quantity: Number(o.quantity) })),
          }))
        : null;

      const { error } = await supabase.from("sourcing_requests").insert({
        seller_id: authUser!.id,
        product_name: productName.trim(),
        quantity: Number(quantity),
        destination_country: country,
        shipping_method: shippingMethod,
        product_url: productUrl.trim(),
        notes: notes.trim() || "",
        status: "waiting_quote",
        product_image_url: productImageUrl,
        variants: variantsData as any,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seller-sourcing"] });
      onOpenChange(false);
      resetForm();
      toast.success("Sourcing request created");
    },
    onError: () => { toast.error("Failed to create request"); },
  });

  const handleCreate = () => { if (!validate()) return; createMutation.mutate(); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[580px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">New Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
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
              <p className="text-xs font-medium">Has Variants?</p>
              <p className="text-[11px] text-muted-foreground">Sizes, colors, or other variations</p>
            </div>
            <Switch checked={hasVariants} onCheckedChange={handleVariantToggle} />
          </div>

          {/* Variant Groups */}
          {hasVariants && (
            <div className="space-y-3">
              {variantGroups.map((group, gi) => (
                <div key={group.id} className="rounded-lg border bg-muted/20 p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-primary shrink-0" />
                    <Input
                      value={group.groupName}
                      onChange={e => updateGroupName(gi, e.target.value)}
                      placeholder="e.g. Size, Color, Material..."
                      className={`h-8 text-xs font-medium flex-1 ${errors[`g_name_${gi}`] ? "border-destructive" : ""}`}
                    />
                    <Button type="button" variant="ghost" size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      onClick={() => removeVariantGroup(gi)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {/* Options */}
                  <div className="space-y-1.5 pl-5">
                    {group.options.map((opt, oi) => (
                      <div key={opt.id} className="flex items-center gap-2">
                        <Input
                          value={opt.name}
                          onChange={e => updateOption(gi, oi, "name", e.target.value)}
                          placeholder="e.g. S, Red..."
                          className={`h-7 text-xs flex-1 ${errors[`o_name_${gi}_${oi}`] ? "border-destructive" : ""}`}
                        />
                        <Input
                          type="number" min={1}
                          value={opt.quantity}
                          onChange={e => updateOption(gi, oi, "quantity", e.target.value ? Number(e.target.value) : "")}
                          placeholder="Qty"
                          className={`h-7 text-xs w-20 ${errors[`o_qty_${gi}_${oi}`] ? "border-destructive" : ""}`}
                        />
                        <Button type="button" variant="ghost" size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => removeOption(gi, oi)}
                          disabled={group.options.length <= 1}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                    <Button type="button" variant="ghost" size="sm"
                      className="h-6 text-[10px] gap-1 text-muted-foreground hover:text-foreground"
                      onClick={() => addOption(gi)}>
                      <Plus className="h-3 w-3" /> Add Option
                    </Button>
                  </div>

                  {/* Group subtotal */}
                  <div className="flex items-center justify-between px-2 pt-1 border-t border-border/50">
                    <span className="text-[10px] text-muted-foreground">Subtotal</span>
                    <span className="text-xs font-semibold tabular-nums">
                      {group.options.reduce((s, o) => s + (typeof o.quantity === "number" ? o.quantity : 0), 0)}
                    </span>
                  </div>
                </div>
              ))}

              <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full" onClick={addVariantGroup}>
                <Layers className="h-3.5 w-3.5" /> Add Variant Group
              </Button>

              {/* Total */}
              <div className="flex items-center justify-between rounded-md bg-primary/5 border border-primary/20 px-3 py-2">
                <span className="text-xs font-medium text-muted-foreground">Total Quantity</span>
                <span className="text-sm font-semibold tabular-nums">{quantity || 0}</span>
              </div>
              {errors.variants && <p className="text-[11px] text-destructive">{errors.variants}</p>}
            </div>
          )}

          {/* Quantity (only when no variants) */}
          {!hasVariants && (
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Quantity *</Label>
              <Input type="number" min={1} step={1} value={quantity}
                onChange={(e) => setQuantity(e.target.value ? Number(e.target.value) : "")}
                placeholder="0" className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
              {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
            </div>
          )}

          {/* Country + Shipping Method */}
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

          {/* Product Image */}
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

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes or special requirements..."
              className="text-sm min-h-[70px] resize-none" maxLength={500} />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => { resetForm(); onOpenChange(false); }}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Create Request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
