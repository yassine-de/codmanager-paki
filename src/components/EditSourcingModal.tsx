import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Loader2, MapPin, Ship, ImageIcon, Layers, Package, Info, Truck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { DbSourcingRequest } from "@/pages/Sourcing";

const statusOptions: { value: string; label: string }[] = [
  { value: "waiting_quote", label: "Waiting Quote" },
  { value: "working_on_it", label: "Working On It" },
  { value: "quoted", label: "Quoted" },
  { value: "ordered", label: "Ordered" },
  { value: "shipped", label: "Shipped" },
  { value: "cancelled", label: "Cancelled" },
];

interface EditSourcingModalProps {
  request: DbSourcingRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSourcingModal({ request, open, onOpenChange }: EditSourcingModalProps) {
  const queryClient = useQueryClient();
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";

  // Fetch source product info if this sourcing came from an existing product
  const sourceProductId = (request as any)?.source_product_id;
  const { data: sourceProduct } = useQuery({
    queryKey: ["source-product", sourceProductId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, price, landed_price, image_url, quantity")
        .eq("id", sourceProductId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!sourceProductId,
  });

  // Fetch previous pricing from older sourcing requests for same product
  const { data: prevPricing } = useQuery({
    queryKey: ["prev-sourcing-pricing", sourceProductId, request?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sourcing_requests")
        .select("landed_price, seller_price")
        .eq("source_product_id", sourceProductId)
        .neq("id", request!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return { landed_price: data?.landed_price ?? null, seller_price: data?.seller_price ?? null };
    },
    enabled: !!sourceProductId && !!request,
  });
  const prevLandedPrice = prevPricing?.landed_price;
  const prevSellerPrice = prevPricing?.seller_price;
  const [shippingCost, setShippingCost] = useState<number | "">(0);
  const [landedPrice, setLandedPrice] = useState<number | "">(0);
  const [sellerPrice, setSellerPrice] = useState<number | "">(0);
  const [quantity, setQuantity] = useState<number | "">(0);
  const [status, setStatus] = useState("waiting_quote");
  const [notes, setNotes] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("unpaid");
  const [paymentMethod, setPaymentMethod] = useState<string | null>(null);
  const [productWeight, setProductWeight] = useState<string | null>(null);
  const [freightForwarder, setFreightForwarder] = useState<string>("");
  const [trackingId, setTrackingId] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [prevId, setPrevId] = useState<string | null>(null);
  if (request && request.id !== prevId) {
    setPrevId(request.id);
    setShippingCost(request.shipping_cost ?? 0);
    setShippingCost(request.shipping_cost ?? 0);
    setLandedPrice(request.landed_price || prevLandedPrice || 0);
    setSellerPrice(request.seller_price || prevSellerPrice || 0);
    setQuantity(request.quantity);
    setStatus(request.status);
    setNotes(request.notes ?? "");
    setPaymentStatus(request.payment_status ?? "unpaid");
    setPaymentMethod(request.payment_method ?? null);
    setProductWeight((request as any).product_weight ?? null);
    setFreightForwarder(request.freight_forwarder ?? "");
    setTrackingId(request.tracking_id ?? "");
    setErrors({});
  }

  const n = (v: number | "") => typeof v === "number" ? v : 0;
  const totalPrice = n(quantity) * n(landedPrice);
  const sellerInvoiceAmount = n(quantity) * n(sellerPrice);
  const sourcingProfit = n(sellerPrice) > 0 && n(landedPrice) > 0 ? n(sellerPrice) - n(landedPrice) : 0;
  const profitMargin = n(sellerPrice) > 0 ? ((sourcingProfit / n(sellerPrice)) * 100) : 0;

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (n(quantity) <= 0) errs.quantity = "Quantity must be greater than 0";
    
    
    if (n(landedPrice) < 0) errs.landedPrice = "Landed price cannot be negative";
    if (n(sellerPrice) < 0) errs.sellerPrice = "Seller price cannot be negative";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const logHistory = async (fieldChanged: string, oldVal: string | null, newVal: string | null) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !request) return;
    await supabase.from("sourcing_history").insert({
      sourcing_request_id: request.id,
      field_changed: fieldChanged,
      old_value: oldVal,
      new_value: newVal,
      changed_by: user.id,
    } as any);
  };

  const doUpdate = async () => {
    if (!request) return;

    // Track changes for history
    const changes: { field: string; oldV: string | null; newV: string | null }[] = [];
    if (status !== request.status) changes.push({ field: "status", oldV: request.status, newV: status });
    if (paymentStatus !== request.payment_status) changes.push({ field: "payment_status", oldV: request.payment_status, newV: paymentStatus });
    if (Number(quantity) !== request.quantity) changes.push({ field: "quantity", oldV: String(request.quantity), newV: String(quantity) });
    if (Number(landedPrice) !== (request.landed_price ?? 0)) changes.push({ field: "landed_price", oldV: String(request.landed_price ?? 0), newV: String(landedPrice) });
    if (Number(sellerPrice) !== (request.seller_price ?? 0)) changes.push({ field: "seller_price", oldV: String(request.seller_price ?? 0), newV: String(sellerPrice) });
    if ((productWeight || null) !== (request.product_weight || null)) changes.push({ field: "product_weight", oldV: request.product_weight || null, newV: productWeight || null });
    const newPayMethod = paymentStatus === "paid" ? paymentMethod : null;
    if (newPayMethod !== (request.payment_method || null)) changes.push({ field: "payment_method", oldV: request.payment_method || null, newV: newPayMethod });

    const updateData: Record<string, unknown> = {
      unit_price: 0,
      shipping_cost: shippingCost as number,
      landed_price: landedPrice as number,
      seller_price: sellerPrice as number,
      quantity: quantity as number,
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
    // Admin-only fields
    if (isAdmin) {
      updateData.freight_forwarder = freightForwarder.trim() || null;
      updateData.tracking_id = trackingId.trim() || null;
    }
    const { error } = await supabase
      .from("sourcing_requests")
      .update(updateData as any)
      .eq("id", request.id);
    if (error) throw error;

    // Log history entries
    await Promise.all(changes.map(c => logHistory(c.field, c.oldV, c.newV)));

    // Auto-add deduction to draft invoice when paid via "from_invoice"
    if (
      paymentStatus === "paid" &&
      paymentMethod === "from_invoice" &&
      request.payment_status !== "paid" &&
      sellerInvoiceAmount > 0
    ) {
      // Find or create open invoice for this seller
      let openInvoiceId: string | null = null;
      const { data: openInvoice } = await supabase
        .from("invoices")
        .select("id")
        .eq("seller_id", request.seller_id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (openInvoice) {
        openInvoiceId = openInvoice.id;
      } else {
        const { data: newInvoice, error: invErr } = await supabase
          .from("invoices")
          .insert({ seller_id: request.seller_id, status: "open" })
          .select("id")
          .single();
        if (invErr) throw invErr;
        openInvoiceId = newInvoice.id;
      }

      // Add deduction addon
      const { error: addonErr } = await supabase
        .from("invoice_addons")
        .insert({
          invoice_id: openInvoiceId,
          type: "out",
          amount: sellerInvoiceAmount,
          reason: `Sourcing: ${request.product_name}`,
        });
      if (addonErr) throw addonErr;
    }
  };

  const updateMutation = useMutation({
    mutationFn: async () => {
      await doUpdate();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-sourcing"] });
      queryClient.invalidateQueries({ queryKey: ["source-product"] });
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

            {/* Existing Product Info */}
            {sourceProduct && (
              <div className="rounded-xl border border-info/25 bg-info/5 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-info" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-info">Existing Product</span>
                </div>
                <div className="flex items-center gap-3">
                  {sourceProduct.image_url ? (
                    <img src={sourceProduct.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg border bg-muted flex items-center justify-center">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{sourceProduct.name}</p>
                    <p className="text-[10px] text-muted-foreground">SKU: {sourceProduct.sku} · Stock: {sourceProduct.quantity}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">Landed Price</p>
                    <p className="text-sm font-bold tabular-nums">{(landedPrice ?? 0).toLocaleString()} $</p>
                  </div>
                  <div className="rounded-lg border bg-background px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">Buying Price</p>
                    <p className="text-sm font-bold tabular-nums">{(sellerPrice ?? 0).toLocaleString()} $</p>
                  </div>
                </div>
                <div className="flex items-start gap-1.5 mt-1">
                  <Info className="h-3 w-3 text-info mt-0.5 shrink-0" />
                  <p className="text-[10px] text-info/80">This sourcing request was created from an existing product in the seller's catalog.</p>
                </div>
              </div>
            )}


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

            {/* Quantity, Landed Price & Seller Price */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Quantity</Label>
                <Input type="number" min={1} step={1} value={quantity} onChange={e => setQuantity(e.target.value === "" ? "" : Number(e.target.value))} className={`h-9 text-sm ${errors.quantity ? "border-destructive" : ""}`} />
                {errors.quantity && <p className="text-[11px] text-destructive">{errors.quantity}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Landed Price ($)</Label>
                <Input type="number" min={0} step={0.01} value={landedPrice} onChange={e => setLandedPrice(e.target.value === "" ? "" : Number(e.target.value))} className={`h-9 text-sm ${errors.landedPrice ? "border-destructive" : ""}`} />
                {errors.landedPrice && <p className="text-[11px] text-destructive">{errors.landedPrice}</p>}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Seller Price ($)</Label>
                <Input type="number" min={0} step={0.01} value={sellerPrice} onChange={e => setSellerPrice(e.target.value === "" ? "" : Number(e.target.value))} className={`h-9 text-sm ${errors.sellerPrice ? "border-destructive" : ""}`} />
                {errors.sellerPrice && <p className="text-[11px] text-destructive">{errors.sellerPrice}</p>}
              </div>
            </div>


            {/* Totals */}
            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Our Cost</span>
                <span className="text-sm font-semibold tabular-nums">{totalPrice.toLocaleString()} $</span>
              </div>
              <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                <span className="text-xs text-muted-foreground">Seller Cost</span>
                <span className="text-sm font-semibold tabular-nums">{(n(sellerPrice) * n(quantity)).toLocaleString()} $</span>
              </div>
              <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 ${sourcingProfit > 0 ? "bg-success/10 border-success/25" : sourcingProfit < 0 ? "bg-destructive/10 border-destructive/25" : "bg-muted/30"}`}>
                <span className="text-xs text-muted-foreground">Sourcing Profit</span>
                <div className="flex flex-col items-end gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-semibold tabular-nums ${sourcingProfit > 0 ? "text-success" : sourcingProfit < 0 ? "text-destructive" : ""}`}>
                      {sourcingProfit > 0 ? "+" : ""}{sourcingProfit.toLocaleString()} $/unit
                    </span>
                    {n(sellerPrice) > 0 && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${sourcingProfit > 0 ? "bg-success/15 text-success" : sourcingProfit < 0 ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>
                        {profitMargin.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  {n(quantity) > 1 && sourcingProfit !== 0 && (
                    <span className={`text-xs tabular-nums ${sourcingProfit > 0 ? "text-success" : "text-destructive"}`}>
                      Total: {sourcingProfit > 0 ? "+" : ""}{(sourcingProfit * n(quantity)).toLocaleString()} $
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Status & Weight */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Status</Label>
                {(() => {
                  const shippingStatuses = ["ordered", "shipped"];
                  const isSellerValidated = request?.seller_validated === true;
                  const hasSellerPrice = n(sellerPrice) > 0;
                  const canSelectShipping = isSellerValidated && hasSellerPrice;
                  return (
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {request.status === "received" && (
                          <SelectItem value="received" disabled>
                            Received (Warehouse only)
                          </SelectItem>
                        )}
                        {statusOptions.map(s => (
                          <SelectItem
                            key={s.value}
                            value={s.value}
                            disabled={shippingStatuses.includes(s.value) && !canSelectShipping}
                          >
                            {s.label}
                            {shippingStatuses.includes(s.value) && !canSelectShipping && (
                              <span className="text-[10px] text-muted-foreground ml-1">
                                ({!isSellerValidated ? "needs validation" : "needs price"})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Product Weight (kg)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.001}
                  value={productWeight || ""}
                  onChange={e => { setProductWeight(e.target.value || null); setErrors(prev => { const { productWeight: _, ...rest } = prev; return rest; }); }}
                  placeholder="e.g. 0.250"
                  className={`h-9 text-sm ${errors.productWeight ? "border-destructive" : ""}`}
                />
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
                    💡 Seller cost ({sellerInvoiceAmount.toLocaleString()} $) will be added to the seller's invoice for deduction.
                  </p>
                </div>
              )}
              {request.payment_status === "paid" && request.payment_date && (
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-2.5">
                  <span className="text-xs text-muted-foreground">Payment Date</span>
                  <span className="text-xs font-medium tabular-nums">{new Date(request.payment_date).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" })}</span>
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add any notes..." className="text-sm min-h-[70px] resize-none" maxLength={500} />
            </div>

            {/* Shipping — Admin only */}
            {isAdmin && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-1 h-4 rounded-full bg-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shipping (Admin only)</span>
                  <Truck className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Freight Forwarder</Label>
                    <Input
                      value={freightForwarder}
                      onChange={e => setFreightForwarder(e.target.value)}
                      placeholder="e.g. DHL, FedEx..."
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Tracking ID</Label>
                    <Input
                      value={trackingId}
                      onChange={e => setTrackingId(e.target.value)}
                      placeholder="Tracking number"
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
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
