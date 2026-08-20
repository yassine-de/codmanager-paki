import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, PackageCheck } from "lucide-react";
import { CitySelect } from "@/components/CitySelect";
import { isValidPhoneNumber } from "@/lib/phone-validation";

interface AgentCreateOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = agent has no product restriction (sees every seller's products) */
  assignedProductNames: string[] | null;
  onCreated?: () => void;
}

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  price: number;
  seller_id: string;
  sellerName: string;
  product_url: string | null;
  video_url: string | null;
  weight_kg: number | null;
};

type OrderItemDraft = {
  productId: string;
  productName: string;
  sellerId: string;
  quantity: number;
  price: number;
};

const emptyItem: OrderItemDraft = { productId: "", productName: "", sellerId: "", quantity: 1, price: 0 };

export default function AgentCreateOrderModal({ open, onOpenChange, assignedProductNames, onCreated }: AgentCreateOrderModalProps) {
  const { authUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [products, setProducts] = useState<ProductOption[]>([]);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<OrderItemDraft[]>([{ ...emptyItem }]);

  const lockedSellerId = items[0]?.sellerId || "";

  useEffect(() => {
    if (!authUser || !open) return;

    const fetchProducts = async () => {
      setLoadingProducts(true);
      let query = supabase
        .from("products")
        .select("id, name, sku, price, seller_id, product_url, video_url, weight_kg")
        .eq("active", true)
        .order("name", { ascending: true });
      if (assignedProductNames) query = query.in("name", assignedProductNames);

      const { data, error } = await query;
      if (error) {
        console.error("Error fetching products:", error);
        toast.error("Could not load products");
        setProducts([]);
        setLoadingProducts(false);
        return;
      }

      const sellerIds = [...new Set((data || []).map((p) => p.seller_id).filter(Boolean))];
      const { data: profiles } = sellerIds.length > 0
        ? await supabase.from("profiles").select("user_id, name").in("user_id", sellerIds)
        : { data: [] as any[] };
      const nameMap = new Map((profiles || []).map((p) => [p.user_id, p.name]));

      setProducts((data || []).map((p) => ({
        ...p,
        sellerName: nameMap.get(p.seller_id) || "Unknown seller",
      })));
      setLoadingProducts(false);
    };

    fetchProducts();
  }, [authUser, open, assignedProductNames]);

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleProductChange = (index: number, productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;

    setItems((prev) => {
      const next = prev.map((item, i) =>
        i === index
          ? { ...item, productId, productName: product.name, sellerId: product.seller_id, price: product.price }
          : item
      );
      // Changing the first item can switch the seller — later items belonged to the old
      // seller and no longer apply, since one order can only ever belong to one seller.
      if (index === 0) return [next[0]];
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { ...emptyItem }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setCustomerName("");
    setCustomerPhone("");
    setCustomerCity("");
    setCustomerAddress("");
    setNote("");
    setItems([{ ...emptyItem }]);
  };

  const productsForRow = (index: number) => {
    if (index === 0 || !lockedSellerId) return products;
    return products.filter((p) => p.seller_id === lockedSellerId);
  };

  const handleSubmit = async () => {
    if (!authUser) return;
    if (!customerName.trim() || !customerPhone.trim() || !customerCity) {
      toast.error("Please fill in customer name, phone and city");
      return;
    }
    if (!isValidPhoneNumber(customerPhone)) {
      toast.error("Phone number is wrong — please enter a real phone number");
      return;
    }
    if (items.some((item) => !item.productId || !item.productName)) {
      toast.error("Please select every product");
      return;
    }
    if (!lockedSellerId) {
      toast.error("Please select a product first");
      return;
    }

    setLoading(true);
    try {
      const { data: orderId, error: idError } = await supabase.rpc("generate_order_id", {
        p_seller_id: lockedSellerId,
      });
      if (idError) throw idError;

      const mainItem = items[0];
      const selectedProducts = items
        .map((item) => products.find((product) => product.id === item.productId))
        .filter(Boolean) as ProductOption[];
      const mainProduct = selectedProducts[0];
      const totalQty = items.reduce((s, i) => s + i.quantity, 0);
      const totalWeight = items.reduce((sum, item) => {
        const product = products.find((entry) => entry.id === item.productId);
        return sum + (Number(product?.weight_kg) || 0) * item.quantity;
      }, 0);
      const nowIso = new Date().toISOString();

      const { error } = await (supabase.rpc as any)("create_manual_order_with_items", {
        p_order: {
          order_id: orderId,
          seller_id: lockedSellerId,
          customer_name: customerName.trim(),
          customer_phone: customerPhone.trim(),
          customer_city: customerCity,
          customer_address: customerAddress.trim(),
          product_name: mainItem.productName,
          product_url: mainProduct?.product_url || null,
          video_url: mainProduct?.video_url || null,
          quantity: totalQty,
          price: mainItem.price,
          total_amount: totalAmount,
          weight: totalWeight,
          note: note.trim() || null,
          confirmation_status: "confirmed",
          confirmation_channel: "agent",
          whatsapp_status: null,
          delivery_status: "booked",
          confirmed_at: nowIso,
          agent_id: authUser.id,
        },
        p_items: items.map((item) => {
          const product = products.find((entry) => entry.id === item.productId);
          return {
            product_id: item.productId,
            product_variant_id: null,
            sku: product?.sku || null,
            product_name: item.productName,
            variant_name: null,
            quantity: item.quantity,
            unit_price: item.price,
            weight_kg: product?.weight_kg || 0,
            metadata: {
              source: "agent_manual_order",
              agent_created_by: authUser.id,
            },
          };
        }),
      });

      if (error) throw error;

      toast.success(`Order ${orderId} created & confirmed! 🎉`, {
        description: `${customerName.trim()} — ${mainItem.productName} × ${totalQty} · Ready for shipping`,
        duration: 5000,
        style: {
          background: "hsl(155, 50%, 96%)",
          border: "1px solid hsl(155, 50%, 42%)",
          color: "hsl(155, 50%, 25%)",
          fontWeight: 600,
          fontSize: "14px",
        },
      });
      resetForm();
      onOpenChange(false);
      onCreated?.();
    } catch (err: any) {
      console.error("Error creating order:", err);
      toast.error(err.message || "Failed to create order");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!loading) onOpenChange(next); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
            <PackageCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <span>This order will be saved as <b>Confirmed</b> and ready for shipping right away — no queue, no waiting.</span>
          </div>

          {/* Customer Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name *</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone *</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="03XXXXXXXXX" className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">City *</Label>
                <CitySelect value={customerCity} onValueChange={setCustomerCity} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Address</Label>
                <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Address" className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {/* Products */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Products</h3>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addItem} disabled={!lockedSellerId}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex items-end gap-2 bg-muted/30 rounded-lg p-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Product</Label>
                  <Select value={item.productId} onValueChange={(v) => handleProductChange(i, v)} disabled={loadingProducts}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={loadingProducts ? "Loading products..." : "Select product"} />
                    </SelectTrigger>
                    <SelectContent>
                      {productsForRow(i).map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min={1} value={item.quantity}
                    onChange={(e) => setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, quantity: parseInt(e.target.value) || 1 } : it))}
                    className="h-9 text-sm" />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Price</Label>
                  <Input type="number" min={0} value={item.price}
                    onChange={(e) => setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, price: parseFloat(e.target.value) || 0 } : it))}
                    className="h-9 text-sm" />
                </div>
                {items.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => removeItem(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!loadingProducts && products.length === 0 && (
              <p className="text-xs text-muted-foreground">No products available for you yet — ask an admin to assign products.</p>
            )}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
            <span className="text-lg font-bold tabular-nums">{totalAmount.toLocaleString()} PKR</span>
          </div>

          {/* Note */}
          <div className="space-y-1">
            <Label className="text-xs">Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note..." className="text-sm min-h-[60px]" />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={loading}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Confirm & Create Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
