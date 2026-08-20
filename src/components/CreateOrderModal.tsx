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
import { Loader2, Plus, Trash2 } from "lucide-react";
import { CitySelect } from "@/components/CitySelect";
import { isValidPhoneNumber } from "@/lib/phone-validation";

interface CreateOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

type SellerOption = {
  id: string;
  name: string;
  email: string;
};

type ProductOption = {
  id: string;
  name: string;
  sku: string;
  price: number;
  product_url: string | null;
  video_url: string | null;
  weight: string | null;
  weight_kg: number | null;
  whatsapp_confirmation_enabled?: boolean;
};

type OrderItemDraft = {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
};


export default function CreateOrderModal({ open, onOpenChange, onCreated }: CreateOrderModalProps) {
  const { authUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [sellers, setSellers] = useState<SellerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [selectedSellerId, setSelectedSellerId] = useState("");
  const isAdmin = authUser?.role === "admin";
  const effectiveSellerId = isAdmin ? selectedSellerId : authUser?.id;

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<OrderItemDraft[]>([
    { productId: "", productName: "", quantity: 1, price: 0 },
  ]);

  // Fetch seller list for admins.
  useEffect(() => {
    if (!authUser || !open || !isAdmin) return;

    const fetchSellers = async () => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "seller");

      if (rolesError) {
        console.error("Error fetching sellers:", rolesError);
        toast.error("Could not load sellers");
        return;
      }

      const sellerIds = (roles || []).map((role) => role.user_id).filter(Boolean);
      if (sellerIds.length === 0) {
        setSellers([]);
        return;
      }

      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("user_id, name, email")
        .in("user_id", sellerIds)
        .order("name", { ascending: true });

      if (profilesError) {
        console.error("Error fetching seller profiles:", profilesError);
        toast.error("Could not load seller profiles");
        return;
      }

      setSellers((profiles || []).map((profile) => ({
        id: profile.user_id,
        name: profile.name || profile.email || "Seller",
        email: profile.email || "",
      })));
    };

    fetchSellers();
  }, [authUser, isAdmin, open]);

  // Fetch products for the current seller.
  useEffect(() => {
    if (!authUser || !open) return;
    if (!effectiveSellerId) {
      setProducts([]);
      return;
    }

    const fetchProducts = async () => {
      setLoadingProducts(true);
      const { data, error } = await supabase
        .from("products")
        .select("id, name, sku, price, product_url, video_url, weight, weight_kg, whatsapp_confirmation_enabled")
        .eq("seller_id", effectiveSellerId)
        .eq("active", true)
        .order("name", { ascending: true });

      if (error) {
        console.error("Error fetching products:", error);
        toast.error("Could not load products");
        setProducts([]);
      } else {
        setProducts(data || []);
      }
      setLoadingProducts(false);
    };

    fetchProducts();
  }, [authUser, effectiveSellerId, open]);

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleSellerChange = (sellerId: string) => {
    setSelectedSellerId(sellerId);
    setProducts([]);
    setItems([{ productId: "", productName: "", quantity: 1, price: 0 }]);
  };

  const handleProductChange = (index: number, productId: string) => {
    const product = products.find(p => p.id === productId);
    setItems(prev => prev.map((item, i) =>
      i === index ? {
        ...item,
        productId,
        productName: product?.name || "",
        price: product ? Number(product.price) : item.price,
      } : item
    ));
  };

  const addItem = () => {
    setItems(prev => [...prev, { productId: "", productName: "", quantity: 1, price: 0 }]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const resetForm = () => {
    setCustomerName("");
    setCustomerPhone("");
    setCustomerCity("");
    setCustomerAddress("");
    setNote("");
    setItems([{ productId: "", productName: "", quantity: 1, price: 0 }]);
    if (isAdmin) setSelectedSellerId("");
  };

  const handleSubmit = async () => {
    if (!authUser) return;
    if (!effectiveSellerId) {
      toast.error("Please select a seller");
      return;
    }
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

    setLoading(true);
    try {
      // Generate order ID
      const { data: orderId, error: idError } = await supabase.rpc("generate_order_id", {
        p_seller_id: effectiveSellerId,
      });
      if (idError) throw idError;

      const mainItem = items[0];
      const selectedProducts = items.map((item) => products.find((product) => product.id === item.productId)).filter(Boolean) as ProductOption[];
      const mainProduct = selectedProducts[0];
      const routeToWhatsapp = selectedProducts.some((product) => !!product.whatsapp_confirmation_enabled);
      const totalQty = items.reduce((s, i) => s + i.quantity, 0);
      const totalWeight = items.reduce((sum, item) => {
        const product = products.find((entry) => entry.id === item.productId);
        return sum + (Number(product?.weight_kg) || 0) * item.quantity;
      }, 0);

      const { error } = await (supabase.rpc as any)("create_manual_order_with_items", {
        p_order: {
          order_id: orderId,
          seller_id: effectiveSellerId,
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
          confirmation_status: routeToWhatsapp ? "new_wts" : "new",
          confirmation_channel: routeToWhatsapp ? "whatsapp" : "agent",
          whatsapp_status: routeToWhatsapp ? "pending" : null,
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
              source: "manual_order_ui",
              seller_created_by: authUser.id,
            },
          };
        }),
      });

      if (error) throw error;

      if (routeToWhatsapp) {
        const { error: automationError } = await supabase.functions.invoke("whatsapp-automation-runner", {
          body: { trigger_type: "new_order", order_id: orderId },
        });
        if (automationError) {
          toast.warning("Order created, but WhatsApp automation did not start");
          console.error("WhatsApp automation start failed:", automationError);
        }
      }

      toast.success(`Order ${orderId} created successfully! 🎉`, {
        description: `${customerName.trim()} — ${mainItem.productName} × ${totalQty}`,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {isAdmin && (
            <div className="space-y-1">
              <Label className="text-xs">Seller *</Label>
              <Select value={selectedSellerId} onValueChange={handleSellerChange}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Select seller" />
                </SelectTrigger>
                <SelectContent>
                  {sellers.map((seller) => (
                    <SelectItem key={seller.id} value={seller.id}>
                      {seller.name}{seller.email ? ` - ${seller.email}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Customer Info */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Customer Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Name *</Label>
                <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" className="h-9 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone *</Label>
                <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="03XXXXXXXXX" className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">City *</Label>
                <CitySelect value={customerCity} onValueChange={setCustomerCity} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Address</Label>
                <Input value={customerAddress} onChange={e => setCustomerAddress(e.target.value)} placeholder="Address" className="h-9 text-sm" />
              </div>
            </div>
          </div>

          {/* Products */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Products</h3>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addItem} disabled={!effectiveSellerId}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex items-end gap-2 bg-muted/30 rounded-lg p-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Product</Label>
                  <Select value={item.productId} onValueChange={v => handleProductChange(i, v)} disabled={!effectiveSellerId || loadingProducts}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder={!effectiveSellerId ? "Choose seller first" : loadingProducts ? "Loading products..." : "Select product"} />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-16 space-y-1">
                  <Label className="text-xs">Qty</Label>
                  <Input type="number" min={1} value={item.quantity}
                    onChange={e => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, quantity: parseInt(e.target.value) || 1 } : it))}
                    className="h-9 text-sm" />
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">Price</Label>
                  <Input type="number" min={0} value={item.price}
                    onChange={e => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, price: parseFloat(e.target.value) || 0 } : it))}
                    className="h-9 text-sm" />
                </div>
                {items.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive shrink-0" onClick={() => removeItem(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>

          {/* Total */}
          <div className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
            <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
            <span className="text-lg font-bold tabular-nums">{totalAmount.toLocaleString()} PKR</span>
          </div>

          {/* Note */}
          <div className="space-y-1">
            <Label className="text-xs">Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note..." className="text-sm min-h-[60px]" />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
              Create Order
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
