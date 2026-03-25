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

interface CreateOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}

const MOROCCAN_CITIES = [
  "Casablanca", "Rabat", "Marrakech", "Fès", "Tanger", "Agadir", "Meknès",
  "Oujda", "Kénitra", "Tétouan", "Salé", "Nador", "Mohammedia", "Béni Mellal",
  "Khouribga", "El Jadida", "Safi", "Taza", "Settat", "Berrechid",
  "Khémisset", "Larache", "Guelmim", "Errachidia", "Inezgane", "Other",
];

export default function CreateOrderModal({ open, onOpenChange, onCreated }: CreateOrderModalProps) {
  const { authUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [products, setProducts] = useState<{ id: string; name: string; price: number }[]>([]);

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerCity, setCustomerCity] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<{ productName: string; quantity: number; price: number }[]>([
    { productName: "", quantity: 1, price: 0 },
  ]);

  // Fetch seller's products
  useEffect(() => {
    if (!authUser || !open) return;
    const fetchProducts = async () => {
      const { data } = await supabase
        .from("products")
        .select("id, name, price")
        .eq("seller_id", authUser.id);
      setProducts(data || []);
    };
    fetchProducts();
  }, [authUser, open]);

  const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0);

  const handleProductChange = (index: number, productName: string) => {
    const product = products.find(p => p.name === productName);
    setItems(prev => prev.map((item, i) =>
      i === index ? { ...item, productName, price: product ? Number(product.price) : item.price } : item
    ));
  };

  const addItem = () => {
    setItems(prev => [...prev, { productName: "", quantity: 1, price: 0 }]);
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
    setItems([{ productName: "", quantity: 1, price: 0 }]);
  };

  const handleSubmit = async () => {
    if (!authUser) return;
    if (!customerName.trim() || !customerPhone.trim() || !customerCity) {
      toast.error("Please fill in customer name, phone and city");
      return;
    }
    if (!items[0]?.productName) {
      toast.error("Please select at least one product");
      return;
    }

    setLoading(true);
    try {
      // Generate order ID
      const { data: orderId, error: idError } = await supabase.rpc("generate_order_id", {
        p_seller_id: authUser.id,
      });
      if (idError) throw idError;

      // For now, create one order row per item (first item as main)
      const mainItem = items[0];
      const totalQty = items.reduce((s, i) => s + i.quantity, 0);

      const { error } = await supabase.from("orders").insert({
        order_id: orderId,
        seller_id: authUser.id,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customer_city: customerCity,
        customer_address: customerAddress.trim(),
        product_name: mainItem.productName,
        quantity: totalQty,
        price: mainItem.price,
        total_amount: totalAmount,
        note: note.trim() || null,
        confirmation_status: "new",
      });

      if (error) throw error;

      toast.success(`Order ${orderId} created successfully`);
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
                <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} placeholder="06XXXXXXXX" className="h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">City *</Label>
                <Select value={customerCity} onValueChange={setCustomerCity}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Select city" />
                  </SelectTrigger>
                  <SelectContent>
                    {MOROCCAN_CITIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={addItem}>
                <Plus className="w-3 h-3" /> Add
              </Button>
            </div>
            {items.map((item, i) => (
              <div key={i} className="flex items-end gap-2 bg-muted/30 rounded-lg p-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Product</Label>
                  <Select value={item.productName} onValueChange={v => handleProductChange(i, v)}>
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue placeholder="Select product" />
                    </SelectTrigger>
                    <SelectContent>
                      {products.map(p => (
                        <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
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
            <span className="text-lg font-bold tabular-nums">{totalAmount.toLocaleString()} MAD</span>
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
