import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const countries = [
  "Morocco", "Turkey", "China", "UAE", "Saudi Arabia", "Egypt",
  "France", "Spain", "Germany", "USA", "UK", "India",
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CreateSourcingModal({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const [sellerId, setSellerId] = useState("");
  const [productName, setProductName] = useState("");
  const [quantity, setQuantity] = useState<number | "">("");
  const [country, setCountry] = useState("");
  const [shippingMethod, setShippingMethod] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Fetch sellers for dropdown
  const { data: sellers = [] } = useQuery({
    queryKey: ["sellers-list"],
    queryFn: async () => {
      const { data: roles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "seller");
      if (!roles || roles.length === 0) return [];
      const sellerIds = roles.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, name")
        .in("user_id", sellerIds);
      return profiles || [];
    },
  });

  const resetForm = () => {
    setSellerId("");
    setProductName("");
    setQuantity("");
    setCountry("");
    setShippingMethod("");
    setProductUrl("");
    setNotes("");
    setErrors({});
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!sellerId) errs.sellerId = "Seller is required";
    if (!productName.trim()) errs.productName = "Product name is required";
    if (!quantity || quantity <= 0) errs.quantity = "Quantity must be greater than 0";
    if (!country) errs.country = "Country is required";
    if (!shippingMethod) errs.shippingMethod = "Shipping method is required";
    if (!productUrl.trim()) errs.productUrl = "Product URL is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("sourcing_requests").insert({
        seller_id: sellerId,
        product_name: productName.trim(),
        quantity: Number(quantity),
        destination_country: country,
        shipping_method: shippingMethod,
        product_url: productUrl.trim(),
        notes: notes.trim() || "",
        status: "waiting_quote",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing"] });
      onOpenChange(false);
      resetForm();
      toast.success("Sourcing request created");
    },
    onError: () => {
      toast.error("Failed to create request");
    },
  });

  const handleCreate = () => {
    if (!validate()) return;
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">New Sourcing Request</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1 h-5 rounded-full bg-primary" />
            <span className="text-sm font-medium">Sourcing Informations</span>
          </div>

          {/* Seller */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Seller *</Label>
            <Select value={sellerId} onValueChange={setSellerId}>
              <SelectTrigger className={`h-9 text-sm ${errors.sellerId ? "border-destructive" : ""}`}>
                <SelectValue placeholder="Select Seller" />
              </SelectTrigger>
              <SelectContent>
                {sellers.map(s => (
                  <SelectItem key={s.user_id} value={s.user_id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.sellerId && <p className="text-[11px] text-destructive">{errors.sellerId}</p>}
          </div>

          {/* Product Name + Quantity */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Product Name *</Label>
              <Input
                value={productName}
                onChange={e => setProductName(e.target.value)}
                placeholder="e.g. Wireless Earbuds Pro"
                className={`h-9 text-sm ${errors.productName ? "border-destructive" : ""}`}
              />
              {errors.productName && <p className="text-[11px] text-destructive">{errors.productName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Quantity *</Label>
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
          </div>

          {/* Country + Shipping Method */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Destination Country *</Label>
              <Select value={country} onValueChange={setCountry}>
                <SelectTrigger className={`h-9 text-sm ${errors.country ? "border-destructive" : ""}`}>
                  <SelectValue placeholder="Select Country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
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
              <Input
                value={productUrl}
                onChange={e => setProductUrl(e.target.value)}
                placeholder="https://www.alibaba.com/product/..."
                className={`h-9 text-sm pl-9 ${errors.productUrl ? "border-destructive" : ""}`}
              />
            </div>
            {errors.productUrl && <p className="text-[11px] text-destructive">{errors.productUrl}</p>}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Add any notes or special requirements..."
              className="text-sm min-h-[70px] resize-none"
              maxLength={500}
            />
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
