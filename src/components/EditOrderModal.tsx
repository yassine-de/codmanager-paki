import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Order, ConfirmationStatus, DeliveryStatus } from "@/lib/data";
import { sellerNames, productNames } from "@/lib/data";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";

const confirmationOptions: { value: ConfirmationStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'wrong_number', label: 'Wrong Number' },
  { value: 'double', label: 'Double' },
];

const deliveryOptions: { value: DeliveryStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'in_transit', label: 'In Transit' },
  { value: 'with_courier', label: 'With Courier' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'returned', label: 'Returned' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'no_answer', label: 'No Answer' },
  { value: 'postponed', label: 'Postponed' },
];

const cities = ['Casablanca', 'Rabat', 'Marrakech', 'Fes', 'Tangier', 'Agadir', 'Oujda', 'Kenitra', 'Tetouan', 'Meknes'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
  onSave: (updated: Order) => void;
}

export default function EditOrderModal({ open, onOpenChange, order, onSave }: Props) {
  const { authUser } = useAuth();
  const isSeller = authUser?.role === 'seller';

  // Fetch seller's own products for the dropdown
  const { data: sellerProducts } = useQuery({
    queryKey: ['seller-products', authUser?.id],
    queryFn: async () => {
      const { data } = await supabase.from('products').select('name').eq('seller_id', authUser!.id);
      return data?.map(p => p.name) || [];
    },
    enabled: isSeller && !!authUser?.id,
  });

  const availableProductNames = isSeller ? (sellerProducts || []) : productNames;

  const [customer, setCustomer] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [seller, setSeller] = useState('');
  const [confirmationStatus, setConfirmationStatus] = useState<ConfirmationStatus>('new');
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('pending');
  const [notes, setNotes] = useState('');
  const [products, setProducts] = useState<{ name: string; qty: number; price: number }[]>([]);
  const [upsell, setUpsell] = useState(false);
  const [warehouseState, setWarehouseState] = useState<'in_stock' | 'out_of_stock' | 'reserved'>('in_stock');

  useEffect(() => {
    if (open && order) {
      setCustomer(order.customer);
      setPhone(order.phone);
      setCity(order.city);
      setAddress(order.address);
      setSeller(order.seller);
      setConfirmationStatus(order.confirmationStatus);
      setDeliveryStatus(order.deliveryStatus);
      setNotes(order.notes || '');
      setProducts(order.products.map(p => ({ ...p })));
      setUpsell(order.upsell);
      setWarehouseState(order.warehouseState);
    }
  }, [open, order]);

  const updateProduct = (idx: number, field: string, value: string | number) => {
    setProducts(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const removeProduct = (idx: number) => {
    if (products.length <= 1) return;
    setProducts(prev => prev.filter((_, i) => i !== idx));
  };

  const addProduct = () => {
    setProducts(prev => [...prev, { name: availableProductNames[0] || '', qty: 1, price: 100 }]);
  };

  const total = products.reduce((s, p) => s + p.qty * p.price, 0);

  const handleSave = () => {
    if (!customer.trim() || !phone.trim()) {
      toast.error('Name and phone are required');
      return;
    }
    if (products.some(p => p.qty < 1 || p.price < 0)) {
      toast.error('Invalid product quantity or price');
      return;
    }

    const historyEvents = [...order.history];
    const now = new Date().toISOString();
    const agent = 'Current User';
    let eid = historyEvents.length;

    // Track changes
    if (customer !== order.customer) {
      historyEvents.push({ id: `${order.id}-h${eid++}`, timestamp: now, type: 'note', description: `Customer name changed`, agent, oldValue: order.customer, newValue: customer });
    }
    if (phone !== order.phone) {
      historyEvents.push({ id: `${order.id}-h${eid++}`, timestamp: now, type: 'note', description: `Phone number changed`, agent, oldValue: order.phone, newValue: phone });
    }
    if (confirmationStatus !== order.confirmationStatus) {
      historyEvents.push({ id: `${order.id}-h${eid++}`, timestamp: now, type: 'confirmation', description: `Confirmation status updated`, agent, oldValue: order.confirmationStatus, newValue: confirmationStatus });
    }
    if (deliveryStatus !== order.deliveryStatus) {
      historyEvents.push({ id: `${order.id}-h${eid++}`, timestamp: now, type: 'delivery_update', description: `Delivery status updated`, agent, oldValue: order.deliveryStatus, newValue: deliveryStatus });
    }
    if (total !== order.total) {
      historyEvents.push({ id: `${order.id}-h${eid++}`, timestamp: now, type: 'price_change', description: `Order total changed`, agent, oldValue: `${order.total} PKR`, newValue: `${total} PKR` });
    }

    const updated: Order = {
      ...order,
      customer: customer.trim(),
      phone: phone.trim(),
      city,
      address: address.trim(),
      seller,
      confirmationStatus,
      deliveryStatus,
      notes: notes.trim() || undefined,
      products,
      total,
      upsell,
      warehouseState,
      updatedAt: now,
      history: historyEvents,
    };

    onSave(updated);
    toast.success('Order updated successfully');
    onOpenChange(false);
  };

  const fieldLabel = "text-xs font-medium text-muted-foreground mb-1.5";
  const sectionTitle = "text-sm font-semibold mb-3 text-foreground";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold">
            Edit Order
            <span className="ml-2 text-xs font-normal text-muted-foreground">{order.id}</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh]">
          <div className="px-5 py-4 space-y-5">
            {/* Customer Info */}
            <div>
              <h3 className={sectionTitle}>Customer Information</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={fieldLabel}>Full Name</Label>
                  <Input value={customer} onChange={e => setCustomer(e.target.value)} className="h-9 text-sm" maxLength={100} />
                </div>
                <div>
                  <Label className={fieldLabel}>Phone</Label>
                  <Input value={phone} onChange={e => setPhone(e.target.value)} className="h-9 text-sm" maxLength={20} />
                </div>
                <div>
                  <Label className={fieldLabel}>City</Label>
                  <Select value={city} onValueChange={setCity}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {cities.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={fieldLabel}>Address</Label>
                  <Input value={address} onChange={e => setAddress(e.target.value)} className="h-9 text-sm" maxLength={200} />
                </div>
              </div>
            </div>

            {/* Products */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">Products</h3>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addProduct}>
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
              <div className="space-y-2">
                {products.map((p, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-muted/30 rounded-lg p-2.5">
                    <div className="flex-1">
                      <Select value={p.name} onValueChange={v => updateProduct(idx, 'name', v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {availableProductNames.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-20">
                      <Input
                        type="number"
                        min={1}
                        max={999}
                        value={p.qty}
                        onChange={e => updateProduct(idx, 'qty', Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 text-xs text-center"
                        placeholder="Qty"
                      />
                    </div>
                    <div className="w-28">
                      <Input
                        type="number"
                        min={0}
                        value={p.price}
                        onChange={e => updateProduct(idx, 'price', Math.max(0, parseInt(e.target.value) || 0))}
                        className="h-8 text-xs text-right"
                        placeholder="Price"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-20 text-right tabular-nums">{p.qty * p.price} PKR</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeProduct(idx)}
                      disabled={products.length <= 1}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="text-right mt-2">
                <span className="text-sm font-semibold tabular-nums">Total: {total} PKR</span>
              </div>
            </div>

            {/* Order Status - hidden for sellers */}
            {!isSeller && (
            <div>
              <h3 className={sectionTitle}>Order Status</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={fieldLabel}>Seller</Label>
                  <Select value={seller} onValueChange={setSeller}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sellerNames.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={fieldLabel}>Warehouse</Label>
                  <Select value={warehouseState} onValueChange={v => setWarehouseState(v as any)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_stock">In Stock</SelectItem>
                      <SelectItem value="out_of_stock">Out of Stock</SelectItem>
                      <SelectItem value="reserved">Reserved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={fieldLabel}>Confirmation</Label>
                  <Select value={confirmationStatus} onValueChange={v => setConfirmationStatus(v as ConfirmationStatus)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {confirmationOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className={fieldLabel}>Delivery</Label>
                  <Select value={deliveryStatus} onValueChange={v => setDeliveryStatus(v as DeliveryStatus)}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {deliveryOptions.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            )}

            {/* Upsell + Notes */}
            <div>
              <h3 className={sectionTitle}>Additional</h3>
              {!isSeller && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className={fieldLabel}>Upsell</Label>
                  <Select value={upsell ? 'yes' : 'no'} onValueChange={v => setUpsell(v === 'yes')}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="yes">Yes</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              )}
              <div className="mt-3">
                <Label className={fieldLabel}>Notes</Label>
                <Textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  className="text-sm min-h-[60px] resize-none"
                  placeholder="Add notes..."
                  maxLength={500}
                />
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
