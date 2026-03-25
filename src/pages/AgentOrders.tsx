import { useState, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { mockOrders, type Order, type ConfirmationStatus } from "@/lib/data";
import { mockProducts } from "@/lib/products-data";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Play, ChevronRight, Phone, PhoneOff, MessageCircle, User, MapPin, Package, DollarSign,
  Video, Store, Tag, StickyNote, CalendarIcon, ExternalLink, AlertCircle, Zap,
  Pencil, Plus, Trash2, X, Check
} from "lucide-react";

const CANCEL_REASONS = [
  { value: "high_price", label: "💰 High Price" },
  { value: "product_issue", label: "⚠️ Product Issue" },
  { value: "not_convinced", label: "🤔 Not Convinced" },
  { value: "quality_issue", label: "❌ Quality Issue" },
  { value: "other", label: "📝 Other" },
];

const NO_ANSWER_MAX_ATTEMPTS = 9;

const statusColors: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  postponed: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  no_answer: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  wrong_number: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  double: "bg-muted text-muted-foreground border-border",
  new: "bg-primary/10 text-primary border-primary/20",
};

const AgentOrders = () => {
  const [started, setStarted] = useState(false);
  const [orderQueue, setOrderQueue] = useState<Order[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Editable customer info
  const [editCustomer, setEditCustomer] = useState({ name: "", phone: "", city: "", address: "" });
  const [editingCustomer, setEditingCustomer] = useState(false);

  // Editable order items
  const [editItems, setEditItems] = useState<{ name: string; qty: number; price: number }[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [addItemName, setAddItemName] = useState("");

  // Status change form
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [cancelReason, setCancelReason] = useState("");
  const [note, setNote] = useState("");
  const [postponeDate, setPostponeDate] = useState<Date | undefined>();
  const [postponeTime, setPostponeTime] = useState("10:00 AM");
  const [shippingStatus, setShippingStatus] = useState("");

  const currentOrder = orderQueue[currentIndex];

  // Effective items (editable copy)
  const activeItems = editItems.length > 0 ? editItems : currentOrder?.products || [];
  const orderTotal = activeItems.reduce((s, p) => s + p.qty * p.price, 0);

  // Get product details for current items
  const orderProductDetails = useMemo(() => {
    return activeItems.map((op) => {
      const found = mockProducts.find((p) => p.name === op.name);
      return { ...op, product: found };
    });
  }, [activeItems]);

  const handleStart = () => {
    // Get all "new" orders
    const newOrders = mockOrders.filter((o) => o.confirmationStatus === "new");
    if (newOrders.length === 0) {
      toast.info("No new orders to process! 🎉");
      return;
    }
    setOrderQueue(newOrders);
    setCurrentIndex(0);
    setStarted(true);
    setEditItems([...newOrders[0].products]);
    setEditCustomer({ name: newOrders[0].customer, phone: newOrders[0].phone, city: newOrders[0].city, address: newOrders[0].address });
    setEditingCustomer(false);
    setEditMode(false);
    setAddItemName("");
    resetForm();
    toast.success(`${newOrders.length} orders loaded — Let's go! 🚀`);
  };

  const resetForm = () => {
    setSelectedStatus("");
    setCancelReason("");
    setNote("");
    setPostponeDate(undefined);
    setPostponeTime("10:00 AM");
    setShippingStatus("");
    setEditMode(false);
    setEditingCustomer(false);
    setAddItemName("");
  };

  const canSubmit = useMemo(() => {
    if (!selectedStatus) return false;
    if (selectedStatus === "confirmed" && !shippingStatus) return false;
    if (selectedStatus === "cancelled") {
      if (!cancelReason) return false;
      if (cancelReason === "other" && !note.trim()) return false;
    }
    if (selectedStatus === "postponed" && (!postponeDate || !postponeTime.split(":")[1]?.replace(/ (AM|PM)/, ""))) return false;
    return true;
  }, [selectedStatus, shippingStatus, cancelReason, note, postponeDate, postponeTime]);

  const handleSubmit = () => {
    if (!canSubmit || !currentOrder) return;
    toast.success(`Order ${currentOrder.id} → ${selectedStatus.toUpperCase()} ✅`);
    resetForm();
    if (currentIndex + 1 < orderQueue.length) {
      const nextIdx = currentIndex + 1;
      const nextOrder = orderQueue[nextIdx];
      setCurrentIndex(nextIdx);
      setEditItems([...nextOrder.products]);
      setEditCustomer({ name: nextOrder.customer, phone: nextOrder.phone, city: nextOrder.city, address: nextOrder.address });
    } else {
      toast.success("All orders processed! 🎉");
      setStarted(false);
    }
  };

  // Edit helpers
  const updateItem = (index: number, field: "qty" | "price", value: number) => {
    setEditItems((items) => items.map((it, i) => i === index ? { ...it, [field]: value } : it));
  };
  const removeItem = (index: number) => {
    setEditItems((items) => items.filter((_, i) => i !== index));
    toast.info("Item removed");
  };
  const addItem = () => {
    if (!addItemName) return;
    const product = mockProducts.find((p) => p.name === addItemName);
    setEditItems((items) => [...items, { name: addItemName, qty: 1, price: product?.price || 0 }]);
    setAddItemName("");
    toast.success("Item added");
  };

  const handleWhatsApp = () => {
    const phone = editCustomer.phone.replace(/\s/g, "");
    window.open(`https://wa.me/${phone}`, "_blank");
  };

  // Not started — show start button
  if (!started) {
    const newCount = mockOrders.filter((o) => o.confirmationStatus === "new").length;
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Ready to start confirming?</h1>
          <p className="text-muted-foreground text-sm max-w-md">
            You have <span className="font-bold text-primary">{newCount}</span> new orders waiting.
            Hit the button below and they'll come to you one by one.
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2 text-base px-8 py-6 rounded-xl shadow-lg hover:shadow-xl transition-all"
          onClick={handleStart}
          disabled={newCount === 0}
        >
          <Play className="h-5 w-5" />
          Start Fast Confirmation
        </Button>
      </div>
    );
  }

  if (!currentOrder) return null;

  return (
    <div className="p-4 md:p-6 max-w-[1100px] mx-auto space-y-4">
      {/* Progress bar */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground">
          Order {currentIndex + 1} / {orderQueue.length}
        </span>
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${((currentIndex + 1) / orderQueue.length) * 100}%` }}
          />
        </div>
        <span className="text-xs">{Math.round(((currentIndex + 1) / orderQueue.length) * 100)}%</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Order Info (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Customer Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Customer Info
                <Badge variant="outline" className="ml-auto text-[10px]">{currentOrder.id}</Badge>
                <Button
                  variant={editingCustomer ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-[10px] gap-1 ml-1"
                  onClick={() => setEditingCustomer(!editingCustomer)}
                >
                  <Pencil className="h-3 w-3" /> {editingCustomer ? "Done" : "Edit"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {editingCustomer ? (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Name</Label>
                    <Input className="h-8 text-xs" value={editCustomer.name} onChange={(e) => setEditCustomer((c) => ({ ...c, name: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Phone</Label>
                    <Input className="h-8 text-xs" value={editCustomer.phone} onChange={(e) => setEditCustomer((c) => ({ ...c, phone: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">City</Label>
                    <Input className="h-8 text-xs" value={editCustomer.city} onChange={(e) => setEditCustomer((c) => ({ ...c, city: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Address</Label>
                    <Input className="h-8 text-xs" value={editCustomer.address} onChange={(e) => setEditCustomer((c) => ({ ...c, address: e.target.value }))} />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Name</p>
                    <p className="text-sm font-medium">{editCustomer.name}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Phone</p>
                    <p className="text-sm font-medium font-mono">{editCustomer.phone}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">City</p>
                    <p className="text-sm font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-muted-foreground" /> {editCustomer.city}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Address</p>
                    <p className="text-sm font-medium">{editCustomer.address}</p>
                  </div>
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={() => navigator.clipboard.writeText(editCustomer.phone).then(() => toast.info("Phone copied!"))}>
                  <Phone className="h-3 w-3" /> Call
                </Button>
                <Button variant="outline" size="sm" className="text-xs gap-1.5 text-emerald-600 hover:text-emerald-700" onClick={handleWhatsApp}>
                  <MessageCircle className="h-3 w-3" /> WhatsApp
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Products Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Package className="h-4 w-4 text-primary" />
                Products
                <Badge variant="secondary" className="ml-auto text-[10px]">
                  {activeItems.length} item(s)
                </Badge>
                <Button
                  variant={editMode ? "default" : "ghost"}
                  size="sm"
                  className="h-7 text-[10px] gap-1 ml-1"
                  onClick={() => setEditMode(!editMode)}
                >
                  <Pencil className="h-3 w-3" /> {editMode ? "Done" : "Edit"}
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {orderProductDetails.map((op, i) => (
                <div key={i} className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
                  <div className="flex items-start gap-3">
                    {op.product?.image && (
                      <img src={op.product.image} alt={op.name} className="w-14 h-14 rounded-lg object-cover border shrink-0" />
                    )}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <p className="text-sm font-semibold truncate">{op.name}</p>

                      {/* Qty & Price — editable or display */}
                      {editMode ? (
                        <div className="flex items-center gap-2">
                          <div className="space-y-0.5">
                            <Label className="text-[9px] text-muted-foreground">Qty</Label>
                            <Input
                              type="number"
                              min={1}
                              value={op.qty}
                              onChange={(e) => updateItem(i, "qty", parseInt(e.target.value) || 1)}
                              className="h-7 w-16 text-xs"
                            />
                          </div>
                          <div className="space-y-0.5">
                            <Label className="text-[9px] text-muted-foreground">Price (MAD)</Label>
                            <Input
                              type="number"
                              min={0}
                              value={op.price}
                              onChange={(e) => updateItem(i, "price", parseInt(e.target.value) || 0)}
                              className="h-7 w-20 text-xs"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 text-destructive hover:text-destructive mt-3"
                            onClick={() => removeItem(i)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Tag className="h-3 w-3" /> Qty: {op.qty}
                          </span>
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <DollarSign className="h-3 w-3" /> {op.price} MAD
                          </span>
                        </div>
                      )}

                      {/* Offers — prominent display */}
                      {op.product?.offers && op.product.offers.length > 0 && (
                        <div className="rounded-md border border-amber-400/40 bg-amber-50/60 dark:bg-amber-500/5 p-2 space-y-1">
                          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1">💎 Quantity Offers</p>
                          <div className="flex flex-wrap gap-2">
                            {op.product.offers.map((offer) => (
                              <div key={offer.id} className="flex items-center gap-1.5 bg-background rounded-md px-2.5 py-1.5 border border-amber-300/50 shadow-sm">
                                <span className="text-xs font-bold text-amber-700 dark:text-amber-400">{offer.quantity}×</span>
                                <span className="text-[10px] text-muted-foreground">→</span>
                                <span className="text-xs font-bold text-foreground">{offer.price} MAD</span>
                                <span className="text-[9px] text-muted-foreground">/unit</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Last Selling Price — subtle info for negotiation */}
                      {op.product?.lastSellingPrice != null && (
                        <div className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5 flex items-center gap-2">
                          <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-[10px] text-muted-foreground">Last sold at</span>
                          <span className="text-xs font-bold text-foreground">{op.product.lastSellingPrice} MAD</span>
                          <span className="text-[9px] text-muted-foreground italic ml-auto">min negotiation price</span>
                        </div>
                      )}

                      {/* Links */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {op.product?.storeLink ? (
                          <a href={op.product.storeLink} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                            <Store className="h-3 w-3" /> Store Link
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
                            <Store className="h-3 w-3" /> No Store Link
                          </span>
                        )}
                        {op.product?.videoLink ? (
                          <a href={op.product.videoLink} target="_blank" rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                            <Video className="h-3 w-3" /> Video
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
                            <Video className="h-3 w-3" /> No Video
                          </span>
                        )}
                      </div>
                    </div>
                    {!editMode && (
                      <p className="text-sm font-bold text-foreground whitespace-nowrap">{op.qty * op.price} MAD</p>
                    )}
                  </div>
                </div>
              ))}

              {/* Add Item */}
              {editMode && (
                <div className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-primary/30 bg-primary/5">
                  <Select value={addItemName} onValueChange={setAddItemName}>
                    <SelectTrigger className="h-8 text-xs flex-1">
                      <SelectValue placeholder="Add a product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {[...new Set(mockProducts.map((p) => p.name))].sort().map((name) => (
                        <SelectItem key={name} value={name} className="text-xs">{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button size="sm" className="h-8 text-xs gap-1" onClick={addItem} disabled={!addItemName}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-lg font-bold text-primary">{orderTotal} MAD</span>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Right: Action Panel (2 cols) */}
        <div className="lg:col-span-2 space-y-4">

          {/* Status Change */}
          <Card className="border-primary/30">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Update Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select value={selectedStatus} onValueChange={setSelectedStatus}>
                <SelectTrigger className="h-10 text-sm">
                  <SelectValue placeholder="Choose confirmation status..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmed" className="text-sm">✅ Confirmed</SelectItem>
                  <SelectItem value="postponed" className="text-sm">⏰ Postponed</SelectItem>
                  <SelectItem value="no_answer" className="text-sm">📞 No Answer</SelectItem>
                  <SelectItem value="cancelled" className="text-sm">❌ Cancelled</SelectItem>
                  <SelectItem value="wrong_number" className="text-sm">📵 Wrong Number</SelectItem>
                  <SelectItem value="double" className="text-sm">🔁 Double Order</SelectItem>
                </SelectContent>
              </Select>

              {/* Confirmed → Shipping status */}
              {selectedStatus === "confirmed" && (
                <div className="space-y-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    📦 Shipping Status *
                  </Label>
                  <Select value={shippingStatus} onValueChange={setShippingStatus}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select shipping status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shipped" className="text-xs">🚚 Shipped — Sent to shipping company</SelectItem>
                      <SelectItem value="not_yet" className="text-xs">⏳ Not Yet — Pending shipment</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Add a note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="text-xs min-h-[50px]"
                  />
                </div>
              )}

              {selectedStatus === "cancelled" && (
                <div className="space-y-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <Label className="text-xs font-semibold flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Cancellation Reason *
                  </Label>
                  <Select value={cancelReason} onValueChange={setCancelReason}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select reason..." />
                    </SelectTrigger>
                    <SelectContent>
                      {CANCEL_REASONS.map((r) => (
                        <SelectItem key={r.value} value={r.value} className="text-xs">{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {cancelReason === "other" && (
                    <Textarea
                      placeholder="Please describe the reason... (required)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="text-xs min-h-[60px]"
                    />
                  )}
                  {cancelReason && cancelReason !== "other" && (
                    <Textarea
                      placeholder="Additional note (optional)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      className="text-xs min-h-[50px]"
                    />
                  )}
                </div>
              )}

              {/* Postponed → Date/Time */}
              {selectedStatus === "postponed" && (
                <div className="space-y-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
                  <Label className="text-xs font-semibold">📅 Postpone to *</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full h-9 text-xs justify-start", !postponeDate && "text-muted-foreground")}>
                        <CalendarIcon className="h-3 w-3 mr-2" />
                        {postponeDate ? format(postponeDate, "dd/MM/yyyy") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={postponeDate}
                        onSelect={setPostponeDate}
                        disabled={(d) => d < new Date()}
                        className="p-3 pointer-events-auto"
                      />
                    </PopoverContent>
                  </Popover>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Time</Label>
                    <div className="flex gap-2">
                      <Select value={postponeTime.split(":")[0] || "10"} onValueChange={(h) => setPostponeTime(`${h}:${postponeTime.split(":")[1]?.replace(/ (AM|PM)/, "") || "00"} ${postponeTime.includes("PM") ? "PM" : "AM"}`)}>
                        <SelectTrigger className="h-9 text-xs w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground self-center">:</span>
                      <Input
                        type="number"
                        min={0}
                        max={59}
                        placeholder="00"
                        value={postponeTime.split(":")[1]?.replace(/ (AM|PM)/, "") || ""}
                        onChange={(e) => {
                          let v = e.target.value.replace(/\D/g, "").slice(0, 2);
                          if (parseInt(v) > 59) v = "59";
                          setPostponeTime(`${postponeTime.split(":")[0] || "10"}:${v} ${postponeTime.includes("PM") ? "PM" : "AM"}`);
                        }}
                        className="h-9 text-xs w-16 text-center"
                      />
                      <Select value={postponeTime.includes("PM") ? "PM" : "AM"} onValueChange={(ampm) => setPostponeTime(postponeTime.replace(/ (AM|PM)/, "") + ` ${ampm}`)}>
                        <SelectTrigger className="h-9 text-xs w-20">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM" className="text-xs">AM</SelectItem>
                          <SelectItem value="PM" className="text-xs">PM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Textarea
                    placeholder="Note (optional)"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="text-xs min-h-[50px]"
                  />
                </div>
              )}

              {/* Confirmed/Other → Optional note */}
              {selectedStatus && !["cancelled", "postponed", "confirmed"].includes(selectedStatus) && (
                <Textarea
                  placeholder="Add a note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="text-xs min-h-[50px]"
                />
              )}

              <Button
                className="w-full gap-2"
                onClick={handleSubmit}
                disabled={!canSubmit}
              >
                <ChevronRight className="h-4 w-4" />
                Confirm & Next Order
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AgentOrders;
