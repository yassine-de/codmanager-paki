import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Loader2, MapPin, Ship, ImageIcon, PackageCheck, Layers } from "lucide-react";
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
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [productWeight, setProductWeight] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showProductConfirm, setShowProductConfirm] = useState(false);

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
    setPaymentStatus(request.payment_status ?? "unpaid");
    setPaymentMethod(request.payment_method ?? null);
    setProductWeight((request as any).product_weight ?? null);
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

  const doUpdate = async (productCreated?: boolean) => {
    if (!request) return;
    const updateData: Record<string, unknown> = {
      unit_price: unitPrice,
      shipping_cost: shippingCost,
      landed_price: landedPrice,
      seller_price: sellerPrice,
      quantity,
      total_price: totalPrice,
      status,
      notes: notes.trim() || "",
      payment_status: paymentStatus,
      payment_method: paymentStatus === "paid" ? paymentMethod : null,
      payment_date: paymentStatus === "paid" && request.payment_status !== "paid" ? new Date().toISOString() : (paymentStatus === "unpaid" ? null : undefined),
      product_weight: productWeight,
      updated_at: new Date().toISOString(),
      seller_seen: false,
    };
    if (productCreated !== undefined) {
      updateData.product_created = productCreated;
    }
    const { error } = await supabase
      .from("sourcing_requests")
      .update(updateData)
      .eq("id", request.id);
    if (error) throw error;

    // Auto-add deduction to draft invoice when paid via "from_invoice"
    if (
      paymentStatus === "paid" &&
      paymentMethod === "from_invoice" &&
      request.payment_status !== "paid" &&
      totalPrice > 0
    ) {
      // Find or create draft invoice for this seller
      let draftInvoiceId: string | null = null;
      const { data: draftInvoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("seller_id", request.seller_id)
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (draftInvoice) {
        draftInvoiceId = draftInvoice.id;
      } else {
        const { data: newInvoice, error: invErr } = await supabase
          .from("invoices")
          .insert({ seller_id: request.seller_id, status: "draft" })
          .select("id")
          .single();
        if (invErr) throw invErr;
        draftInvoiceId = newInvoice.id;
      }

      // Add deduction addon
      const { error: addonErr } = await supabase
        .from("invoice_addons")
        .insert({
          invoice_id: draftInvoiceId,
          type: "out",
          amount: totalPrice,
          reason: `Sourcing: ${request.product_name}`,
        });
      if (addonErr) throw addonErr;
    }
  };

  const createProduct = async () => {
    if (!request) return;
    // Generate SKU
    const { data: skuData, error: skuError } = await supabase.rpc("generate_product_sku");
    if (skuError) throw skuError;
    const sku = skuData as string;

    const insertData: Record<string, unknown> = {
      seller_id: request.seller_id,
      sku,
      name: request.product_name,
      image_url: request.product_image_url || "",
      price: 0,
      landed_price: landedPrice || 0,
      quantity: quantity,
      product_url: request.product_url || "",
      sourcing_request_id: request.id,
      weight: productWeight || null,
      variants: request.variants || null,
    };
    const { error } = await supabase.from("products").insert(insertData as any);
    if (error) throw error;
  };

  const updateMutation = useMutation({
    mutationFn: async ({ withProduct }: { withProduct?: boolean } = {}) => {
      if (withProduct) {
        await createProduct();
        await doUpdate(true);
      } else {
        await doUpdate(withProduct === false ? false : undefined);
      }
    },
    onSuccess: (_, { withProduct }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing"] });
      onOpenChange(false);
      if (withProduct) {
        toast.success("Request updated & product created");
      } else {
        toast.success("Request updated successfully");
      }
    },
    onError: () => {
      toast.error("Failed to update request");
    },
  });

  // Validate product for requests where product_created is false
  const validateProductMutation = useMutation({
    mutationFn: async () => {
      if (!productWeight) {
        toast.error("Product weight is required before creating a product");
        throw new Error("Weight required");
      }
      // Save weight first
      await supabase
        .from("sourcing_requests")
        .update({ product_weight: productWeight } as any)
        .eq("id", request!.id);
      await createProduct();
      if (!request) return;
      await supabase
        .from("sourcing_requests")
        .update({ product_created: true, product_weight: productWeight, updated_at: new Date().toISOString() } as any)
        .eq("id", request.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing"] });
      toast.success("Product created successfully");
    },
    onError: (err: any) => {
      if (err?.message !== "Weight required") toast.error("Failed to create product");
    },
  });

  const handleSave = () => {
    if (!validate()) return;
    // If status changed to received and product not yet created, show confirmation
    const wasReceived = request?.status === "received";
    const isNowReceived = status === "received";
    const alreadyCreated = request?.product_created === true;

    if (isNowReceived && !wasReceived && !alreadyCreated) {
      if (!productWeight) {
        toast.error("Product weight is required before creating a product");
        setErrors(prev => ({ ...prev, productWeight: "Weight is required" }));
        return;
      }
      setShowProductConfirm(true);
      return;
    }
    updateMutation.mutate({});
  };

  const handleProductConfirm = (yes: boolean) => {
    setShowProductConfirm(false);
    updateMutation.mutate({ withProduct: yes ? true : false });
  };

  if (!request) return null;

  const imageUrl = request.product_image_url;
  const canValidateProduct = request.status === "received" && request.product_created === false;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Sourcing Request</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Product Info Card */}
            <div className="rounded-xl border bg-muted/20 overflow-hidden">
              <div className="flex gap-3 p-3">
                <div className="flex-shrink-0">
                  {imageUrl ? (
                    <img src={imageUrl} alt={request.product_name} className="w-16 h-16 rounded-lg object-cover border bg-background" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg border bg-background flex items-center justify-center">
                      <ImageIcon className="h-6 w-6 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="text-sm font-semibold truncate">{request.product_name}</p>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{request.destination_country}</span>
                    <span className="inline-flex items-center gap-1"><Ship className="h-3 w-3" />{request.shipping_method === "air" ? "By Air" : "By Sea"}</span>
                  </div>
                  <a href={request.product_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium">
                    <ExternalLink className="h-3 w-3" /> View Product
                  </a>
                </div>
              </div>
            </div>

            {/* Variants Display (read-only) */}
            {request.variants && Array.isArray(request.variants) && (request.variants as any[]).length > 0 && (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Layers className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variants</span>
                </div>
                <div className="space-y-2">
                  {(request.variants as any[]).map((variant: any, vi: number) => (
                    <div key={vi} className="rounded-lg border bg-background p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold">{variant.name || variant.group || `Variant ${vi + 1}`}</span>
                        <span className="text-[10px] text-muted-foreground font-medium tabular-nums">
                          Qty: {variant.quantity ?? (variant.options?.reduce?.((s: number, o: any) => s + (o.quantity || 0), 0) || 0)}
                        </span>
                      </div>
                      {variant.subVariants && variant.subVariants.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {variant.subVariants.map((sv: any, si: number) => (
                            <span key={si} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                              {sv.name} <span className="text-primary/60">×{sv.quantity}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {variant.options && !variant.subVariants && variant.options.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {variant.options.map((opt: any, oi: number) => (
                            <span key={oi} className="inline-flex items-center gap-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                              {opt.name} <span className="text-primary/60">×{opt.quantity}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Validate Product Button - shows when received but product not created */}
            {canValidateProduct && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                onClick={() => validateProductMutation.mutate()}
                disabled={validateProductMutation.isPending}
              >
                {validateProductMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PackageCheck className="h-3.5 w-3.5" />
                )}
                Validate & Create Product
              </Button>
            )}

            {/* Quantity & Unit Price */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={1} step={1} value={quantity} onChange={e => setQuantity(Number(e.target.value))} className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
                {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Unit Price (MAD)</Label>
                <Input type="number" min={0} step={0.01} value={unitPrice} onChange={e => setUnitPrice(Number(e.target.value))} className={`h-9 text-sm ${errors.unitPrice ? "border-destructive" : ""}`} />
                {errors.unitPrice && <p className="text-[11px] text-destructive">{errors.unitPrice}</p>}
              </div>
            </div>

            {/* Shipping Cost */}
            <div className="space-y-1.5">
              <Label className="text-xs">Shipping Cost (MAD)</Label>
              <Input type="number" min={0} step={0.01} value={shippingCost} onChange={e => setShippingCost(Number(e.target.value))} className={`h-9 text-sm ${errors.shippingCost ? "border-destructive" : ""}`} />
              {errors.shippingCost && <p className="text-[11px] text-destructive">{errors.shippingCost}</p>}
            </div>

            {/* Total */}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">Total Cost</span>
              <span className="text-sm font-semibold tabular-nums">{totalPrice.toLocaleString()} MAD</span>
            </div>

            {/* Pricing */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-primary" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pricing</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Landed Price (MAD)</Label>
                  <Input type="number" min={0} step={0.01} value={landedPrice} onChange={e => setLandedPrice(Number(e.target.value))} className={`h-9 text-sm ${errors.landedPrice ? "border-destructive" : ""}`} />
                  {errors.landedPrice && <p className="text-[11px] text-destructive">{errors.landedPrice}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Seller Price (MAD)</Label>
                  <Input type="number" min={0} step={0.01} value={sellerPrice} onChange={e => setSellerPrice(Number(e.target.value))} className={`h-9 text-sm ${errors.sellerPrice ? "border-destructive" : ""}`} />
                  {errors.sellerPrice && <p className="text-[11px] text-destructive">{errors.sellerPrice}</p>}
                </div>
              </div>
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

            {/* Status & Weight */}
            <div className="grid grid-cols-2 gap-4">
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
              <div className="space-y-1.5">
                <Label className="text-xs">Product Weight {canValidateProduct && <span className="text-destructive">*</span>}</Label>
                <Select value={productWeight || ""} onValueChange={v => { setProductWeight(v); setErrors(prev => { const { productWeight: _, ...rest } = prev; return rest; }); }}>
                  <SelectTrigger className={`h-9 text-sm ${errors.productWeight ? "border-destructive" : ""}`}>
                    <SelectValue placeholder="Select weight" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="up_to_1kg">Up to 1kg</SelectItem>
                    <SelectItem value="up_to_2kg">Up to 2kg</SelectItem>
                    <SelectItem value="up_to_3kg">Up to 3kg</SelectItem>
                    <SelectItem value="more_than_3kg">More than 3kg</SelectItem>
                  </SelectContent>
                </Select>
                {errors.productWeight && <p className="text-[11px] text-destructive">{errors.productWeight}</p>}
              </div>
            </div>

            {/* Payment */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-success" />
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Payment</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-xs">Payment Status</Label>
                  <Select value={paymentStatus} onValueChange={v => { setPaymentStatus(v); if (v === 'unpaid') setPaymentMethod(null); }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {paymentStatus === "paid" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Payment Method</Label>
                    <Select value={paymentMethod || ""} onValueChange={setPaymentMethod}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Select method" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cih">CIH</SelectItem>
                        <SelectItem value="binance">Binance</SelectItem>
                        <SelectItem value="wise">Wise</SelectItem>
                        <SelectItem value="from_invoice">From Invoice</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              {paymentStatus === "paid" && paymentMethod === "from_invoice" && (
                <div className="rounded-lg border border-warning/25 bg-warning/10 px-4 py-2.5">
                  <p className="text-xs text-warning font-medium">
                    💡 Total amount ({totalPrice.toLocaleString()} MAD) will be added to the seller's invoice for deduction.
                  </p>
                </div>
              )}
              {request.payment_status === "paid" && request.payment_date && (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">Payment Date</span>
                  <span className="text-xs font-medium tabular-nums">{new Date(request.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes..." className="text-sm min-h-[70px] resize-none" maxLength={500} />
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

      {/* Product Creation Confirmation */}
      <AlertDialog open={showProductConfirm} onOpenChange={setShowProductConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" />
              Create Product?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The sourcing request for <strong>{request.product_name}</strong> has been received. 
              Do you want to automatically create a product for this seller?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => handleProductConfirm(false)} disabled={updateMutation.isPending}>
              No
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => handleProductConfirm(true)} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Yes, Create Product
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
