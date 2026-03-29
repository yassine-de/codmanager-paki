import { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  Play, ChevronRight, Phone, PhoneOff, MessageCircle, User, MapPin, Package, DollarSign,
  Video, Store, Tag, StickyNote, CalendarIcon, ExternalLink, AlertCircle, Zap,
  Pencil, Plus, Trash2, X, Check, Loader2, Clock, RotateCcw, Copy, AlertTriangle
} from "lucide-react";

const CANCEL_REASONS = [
  { value: "high_price", label: "💰 High Price" },
  { value: "product_issue", label: "⚠️ Product Issue" },
  { value: "not_convinced", label: "🤔 Not Convinced" },
  { value: "quality_issue", label: "❌ Quality Issue" },
  { value: "other", label: "📝 Other" },
];

const NO_ANSWER_MAX_ATTEMPTS = 9;
const RETRY_COOLDOWN_MS = 30 * 60 * 1000; // 30 min
const RETRY_AGING_MS = 2 * 60 * 60 * 1000; // 2 hours → urgent
const NEW_TO_RETRY_RATIO = 3; // 3 new then 1 retry

const statusColors: Record<string, string> = {
  confirmed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  postponed: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  no_answer: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  wrong_number: "bg-purple-500/10 text-purple-600 border-purple-500/20",
  double: "bg-muted text-muted-foreground border-border",
  new: "bg-primary/10 text-primary border-primary/20",
};

interface DbOrder {
  id: string;
  order_id: string;
  customer_name: string;
  customer_phone: string;
  customer_city: string;
  customer_address: string | null;
  product_name: string;
  quantity: number;
  price: number;
  total_amount: number;
  confirmation_status: string;
  delivery_status: string | null;
  agent_id: string | null;
  seller_id: string;
  note: string | null;
  attempt_count: number;
  cancel_reason: string | null;
  postpone_date: string | null;
  postpone_note: string | null;
  original_agent_id: string | null;
  shipping_status: string | null;
  store_url: string | null;
  video_url: string | null;
  product_url: string | null;
  offers: string | null;
  last_price: number | null;
  created_at: string;
  updated_at: string;
  // local flags
  _isFollowUp?: boolean;
  _isPostponedReassign?: boolean;
  _isDuplicate?: boolean;
  _duplicateGroup?: DbOrder[];
}

const AgentOrders = () => {
  const { authUser } = useAuth();
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderQueue, setOrderQueue] = useState<DbOrder[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [retryCount, setRetryCount] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [assignedProducts, setAssignedProducts] = useState<string[] | null>(null);

  // Editable customer info
  const [editCustomer, setEditCustomer] = useState({ name: "", phone: "", city: "", address: "" });
  const [editingCustomer, setEditingCustomer] = useState(false);

  // Editable order items
  const [editItems, setEditItems] = useState<{ name: string; qty: number; price: number }[]>([]);
  const [editMode, setEditMode] = useState(false);
  const [sellerProducts, setSellerProducts] = useState<{ id: string; name: string; price: number; product_url: string | null; video_url: string | null }[]>([]);
  const [historicalOffers, setHistoricalOffers] = useState<string | null>(null);
  const [historicalLastPrice, setHistoricalLastPrice] = useState<number | null>(null);

  // Status change form
  const [selectedStatus, setSelectedStatus] = useState<string>("");
  const [cancelReason, setCancelReason] = useState("");
  const [note, setNote] = useState("");
  const [postponeDate, setPostponeDate] = useState<Date | undefined>();
  const [postponeTime, setPostponeTime] = useState("10:00 AM");
  const [postponeNote, setPostponeNote] = useState("");
  const [shippingStatus, setShippingStatus] = useState("");

  // Track new/retry assignment count for balanced distribution
  const [newAssignedCount, setNewAssignedCount] = useState(0);

  // ─── LEASE HEARTBEAT & AUTO-RELEASE ───
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentOrderRef = useRef<DbOrder | null>(null);

  const currentOrder = orderQueue[currentIndex];

  // Keep ref in sync for use in event handlers
  useEffect(() => {
    currentOrderRef.current = currentOrder || null;
  }, [currentOrder]);

  // Touch order lock heartbeat (every 30s) + page leave detection
  useEffect(() => {
    if (!started || !authUser) return;

    const touchLock = () => {
      const order = currentOrderRef.current;
      if (order && order.confirmation_status === "new") {
        supabase.rpc("touch_order_lock", { p_order_id: order.id, p_agent_id: authUser.id });
      }
    };

    const releaseLock = () => {
      const order = currentOrderRef.current;
      if (order && order.confirmation_status === "new") {
        // Best effort: use supabase RPC (works for navigation away / unmount)
        supabase.rpc("release_order_lock" as any, { p_order_id: order.id, p_agent_id: authUser.id }).then();
      }
    };

    // Heartbeat every 30s
    heartbeatRef.current = setInterval(touchLock, 30_000);

    // On visibility change: just pause/resume heartbeat, DON'T release
    // The 2-min backend timeout is the safety net for truly abandoned orders
    const handleVisibility = () => {
      if (!document.hidden) {
        touchLock(); // Resume heartbeat when tab regains focus
      }
    };

    // Page unload — best effort release
    const handleBeforeUnload = () => {
      releaseLock();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Release on unmount (navigating away within the app)
      releaseLock();
    };
  }, [started, authUser?.id]);

  const activeItems = editItems.length > 0 ? editItems : currentOrder
    ? [{ name: currentOrder.product_name, qty: currentOrder.quantity, price: Number(currentOrder.price) }]
    : [];
  const orderTotal = activeItems.reduce((s, p) => s + p.qty * p.price, 0);

  // Fetch agent's assigned products + counts
  useEffect(() => {
    if (!authUser) return;
    const init = async () => {
      const { data: agentProds } = await supabase
        .from("agent_products")
        .select("product_name")
        .eq("agent_id", authUser.id);

      const prodNames = agentProds && agentProds.length > 0
        ? agentProds.map(p => p.product_name)
        : null;
      setAssignedProducts(prodNames);

      // Count new orders
      let newQuery = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("confirmation_status", "new")
        .is("agent_id", null);
      if (prodNames) newQuery = newQuery.in("product_name", prodNames);
      const { count: newCount } = await newQuery;
      setNewOrderCount(newCount || 0);

      // Count retries (no_answer + postponed ready)
      const now = new Date().toISOString();
      let naQuery = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("confirmation_status", "no_answer")
        .eq("agent_id", authUser.id)
        .lt("attempt_count", NO_ANSWER_MAX_ATTEMPTS);
      if (prodNames) naQuery = naQuery.in("product_name", prodNames);
      const { count: naCount } = await naQuery;

      let ppQuery = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("confirmation_status", "postponed")
        .lte("postpone_date", now);
      // Postponed orders either assigned to this agent or unassigned (from inactive agents)
      if (prodNames) ppQuery = ppQuery.in("product_name", prodNames);
      const { count: ppCount } = await ppQuery;

      setRetryCount((naCount || 0) + (ppCount || 0));

      // Count duplicates (orders with same phone+product, status=new)
      // We'll just show a rough count
      setDuplicateCount(0); // Will be calculated on fetch
    };
    init();
  }, [authUser]);

  // ─── SMART QUEUE: Fetch prioritized orders ───
  const fetchPrioritizedOrders = async (): Promise<DbOrder[]> => {
    const userId = authUser!.id;
    const now = new Date();
    const cooldownCutoff = new Date(now.getTime() - RETRY_COOLDOWN_MS).toISOString();
    const agingCutoff = new Date(now.getTime() - RETRY_AGING_MS).toISOString();

    // ── 1. DUPLICATES (highest priority) ──
    // Find orders with same phone+product that are "new" and unassigned
    let dupQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "new")
      .is("agent_id", null)
      .order("created_at", { ascending: true });
    if (assignedProducts) dupQuery = dupQuery.in("product_name", assignedProducts);
    const { data: allNewOrders } = await dupQuery;

    const newOrders = (allNewOrders || []) as DbOrder[];

    // Detect duplicates: group by phone+product
    const phoneProductMap: Record<string, DbOrder[]> = {};
    for (const o of newOrders) {
      const key = `${o.customer_phone.replace(/\s/g, "")}::${o.product_name}`;
      if (!phoneProductMap[key]) phoneProductMap[key] = [];
      phoneProductMap[key].push(o);
    }

    const duplicateGroups: DbOrder[][] = [];
    const nonDuplicateNew: DbOrder[] = [];
    for (const [, group] of Object.entries(phoneProductMap)) {
      if (group.length > 1) {
        duplicateGroups.push(group);
      } else {
        nonDuplicateNew.push(group[0]);
      }
    }

    // Also get new orders already assigned to this agent
    let myNewQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "new")
      .eq("agent_id", userId)
      .order("created_at", { ascending: true });
    if (assignedProducts) myNewQuery = myNewQuery.in("product_name", assignedProducts);
    const { data: myNewData } = await myNewQuery;
    const myNewOrders = (myNewData || []) as DbOrder[];

    // ── 2. RETRIES: No Answer (cooled down) ──
    let noAnswerQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "no_answer")
      .eq("agent_id", userId)
      .lt("attempt_count", NO_ANSWER_MAX_ATTEMPTS)
      .lt("updated_at", cooldownCutoff)
      .order("attempt_count", { ascending: true })
      .order("updated_at", { ascending: true });
    if (assignedProducts) noAnswerQuery = noAnswerQuery.in("product_name", assignedProducts);
    const { data: noAnswerData } = await noAnswerQuery;

    // Also get urgent no-answer retries (aged >2h) — these get boosted priority
    let urgentNaQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "no_answer")
      .eq("agent_id", userId)
      .lt("attempt_count", NO_ANSWER_MAX_ATTEMPTS)
      .lt("updated_at", agingCutoff)
      .order("updated_at", { ascending: true });
    if (assignedProducts) urgentNaQuery = urgentNaQuery.in("product_name", assignedProducts);
    const { data: urgentNaData } = await urgentNaQuery;

    const urgentRetries = ((urgentNaData || []) as DbOrder[]).map(o => ({ ...o, _isFollowUp: true }));
    const normalRetries = ((noAnswerData || []) as DbOrder[])
      .filter(o => !urgentRetries.find(u => u.id === o.id))
      .map(o => ({ ...o, _isFollowUp: true }));

    // ── 3. POSTPONED (due now) ──
    const nowIso = now.toISOString();

    // Postponed assigned to THIS agent
    let myPostQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "postponed")
      .eq("agent_id", userId)
      .lte("postpone_date", nowIso)
      .order("postpone_date", { ascending: true });
    if (assignedProducts) myPostQuery = myPostQuery.in("product_name", assignedProducts);
    const { data: myPostData } = await myPostQuery;
    const myPostponed = ((myPostData || []) as DbOrder[]).map(o => ({ ...o, _isFollowUp: true }));

    // Postponed from OTHER agents (unassigned / reassigned to queue)
    let otherPostQuery = supabase
      .from("orders")
      .select("*")
      .eq("confirmation_status", "postponed")
      .is("agent_id", null)
      .lte("postpone_date", nowIso)
      .order("postpone_date", { ascending: true });
    if (assignedProducts) otherPostQuery = otherPostQuery.in("product_name", assignedProducts);
    const { data: otherPostData } = await otherPostQuery;
    const otherPostponed = ((otherPostData || []) as DbOrder[]).map(o => ({
      ...o,
      _isFollowUp: true,
      _isPostponedReassign: true,
    }));

    // ── 4. BUILD BALANCED QUEUE ──
    const allRetries = [...urgentRetries, ...myPostponed, ...otherPostponed, ...normalRetries];

    // Flatten duplicate groups — mark first of each group, attach group
    const duplicateOrders: DbOrder[] = [];
    for (const group of duplicateGroups) {
      const first = { ...group[0], _isDuplicate: true, _duplicateGroup: group };
      duplicateOrders.push(first);
      // The rest will be assigned together when the first is processed
    }

    // Build balanced queue: duplicates first, then 3:1 new:retry ratio
    const queue: DbOrder[] = [];

    // Already-assigned orders first (agent's own pending work)
    queue.push(...myNewOrders);

    // Duplicates always highest priority
    queue.push(...duplicateOrders);

    // Interleave new and retries with 3:1 ratio
    let newIdx = 0;
    let retryIdx = 0;
    const allNew = nonDuplicateNew;

    while (newIdx < allNew.length || retryIdx < allRetries.length) {
      // Every 4th order should be a retry (3 new : 1 retry)
      const shouldDoRetry = (newIdx > 0 && newIdx % NEW_TO_RETRY_RATIO === 0 && retryIdx < allRetries.length)
        || newIdx >= allNew.length;

      if (shouldDoRetry && retryIdx < allRetries.length) {
        queue.push(allRetries[retryIdx]);
        retryIdx++;
      } else if (newIdx < allNew.length) {
        queue.push(allNew[newIdx]);
        newIdx++;
      } else {
        break;
      }
    }

    // Append any remaining retries
    while (retryIdx < allRetries.length) {
      queue.push(allRetries[retryIdx]);
      retryIdx++;
    }

    return queue;
  };

  const handleStart = async () => {
    setLoading(true);
    try {
      const data = await fetchPrioritizedOrders();

      if (!data || data.length === 0) {
        toast.info("No orders to process right now! 🎉");
        setLoading(false);
        return;
      }

      setOrderQueue(data);
      setCurrentIndex(0);
      setStarted(true);
      setNewAssignedCount(0);

      const firstOrder = data[0];
      if (!firstOrder.agent_id || firstOrder.agent_id !== authUser!.id) {
        await claimOrder(firstOrder);
      } else {
        initOrderState(firstOrder);
      }

      toast.success(`Order claimed successfully — Let's go! 🚀`);
    } catch (err: any) {
      toast.error(err.message || "Failed to load orders");
    } finally {
      setLoading(false);
    }
  };

  // Atomic claim via DB function — prevents race conditions
  const claimOrderAtomic = async (orderType: string): Promise<DbOrder | null> => {
    if (!authUser) return null;
    const { data, error } = await supabase.rpc("claim_next_order", {
      p_agent_id: authUser.id,
      p_product_names: assignedProducts || null,
      p_order_type: orderType,
    });
    if (error) {
      console.error("claim_next_order error:", error);
      return null;
    }
    const rows = data as DbOrder[] | null;
    if (!rows || rows.length === 0) return null;
    return rows[0];
  };

  const claimOrder = async (order: DbOrder) => {
    if (!authUser) return false;
    setClaiming(true);
    try {
      // If already assigned to us, just init
      if (order.agent_id === authUser.id) {
        initOrderState(order);
        return true;
      }

      // If it's a duplicate group, use atomic duplicate claim
      if (order._isDuplicate && order._duplicateGroup) {
        const claimed = await claimOrderAtomic("duplicate");
        if (!claimed) {
          toast.warning(`Duplicate orders were already taken`);
          return false;
        }
        initOrderState(claimed);
        toast.info(`📋 Duplicate orders assigned atomically`, { duration: 4000 });
        return true;
      }

      // Determine order type for atomic claim
      let orderType = "new";
      if (order.confirmation_status === "postponed") orderType = "postponed";
      else if (order.confirmation_status === "no_answer") orderType = "no_answer";

      // Try to claim this specific order first (optimistic)
      const updatePayload: Record<string, any> = {
        agent_id: authUser.id,
        assigned_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from("orders")
        .update(updatePayload as any)
        .eq("id", order.id)
        .is("agent_id", null)
        .select()
        .maybeSingle();

      if (error) throw error;
      if (data) {
        initOrderState(data as DbOrder);
        return true;
      }

      // Order was taken — use atomic function to get next available
      const fallback = await claimOrderAtomic(orderType);
      if (fallback) {
        initOrderState(fallback);
        toast.info(`Order was taken, got next available ✅`);
        return true;
      }

      toast.warning(`Order ${order.order_id} was already taken, no more available`);
      return false;
    } catch (err: any) {
      toast.error("Failed to claim order");
      return false;
    } finally {
      setClaiming(false);
    }
  };

  const initOrderState = (order: DbOrder) => {
    // Touch the lease heartbeat on init
    if (authUser && order.confirmation_status === "new") {
      supabase.rpc("touch_order_lock" as any, { p_order_id: order.id, p_agent_id: authUser.id });
    }
    setEditItems([{ name: order.product_name, qty: order.quantity, price: Number(order.price) }]);
    setEditCustomer({
      name: order.customer_name,
      phone: order.customer_phone,
      city: order.customer_city,
      address: order.customer_address || "",
    });
    setEditingCustomer(false);
    setEditMode(false);
    resetForm();
    setHistoricalOffers(null);
    setHistoricalLastPrice(null);

    // Fetch seller's products for add-item and product_url lookup
    supabase
      .from("products")
      .select("id, name, price, product_url, video_url")
      .eq("seller_id", order.seller_id)
      .then(({ data }) => {
        setSellerProducts((data || []).map(p => ({ ...p, price: Number(p.price) })));
      });

    // Fetch historical offers & last_price from previous confirmed orders of same product
    supabase
      .from("orders")
      .select("offers, last_price, price")
      .eq("seller_id", order.seller_id)
      .eq("product_name", order.product_name)
      .eq("confirmation_status", "confirmed")
      .neq("id", order.id)
      .order("confirmed_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: histOrder }) => {
        if (histOrder) {
          if (histOrder.offers && String(histOrder.offers).trim()) {
            setHistoricalOffers(String(histOrder.offers));
          }
          const lp = histOrder.last_price ?? histOrder.price;
          if (lp != null && Number(lp) > 0) {
            setHistoricalLastPrice(Number(lp));
          }
        }
      });
  };

  const resetForm = () => {
    setSelectedStatus("");
    setCancelReason("");
    setNote("");
    setPostponeDate(undefined);
    setPostponeTime("10:00 AM");
    setPostponeNote("");
    setShippingStatus("");
    setEditMode(false);
    setEditingCustomer(false);
  };

  const canSubmit = useMemo(() => {
    if (!selectedStatus) return false;
    if (selectedStatus === "confirmed" && !shippingStatus) return false;
    if (selectedStatus === "cancelled") {
      if (!cancelReason) return false;
      if (cancelReason === "other" && !note.trim()) return false;
    }
    if (selectedStatus === "postponed") {
      if (!postponeDate || !postponeTime.split(":")[1]?.replace(/ (AM|PM)/, "")) return false;
      if (!postponeNote.trim()) return false; // REQUIRED note for postponed
    }
    return true;
  }, [selectedStatus, shippingStatus, cancelReason, note, postponeDate, postponeTime, postponeNote]);

  const handleSubmit = async () => {
    if (!canSubmit || !currentOrder || !authUser) return;
    setSubmitting(true);

    try {
      const updateData: Record<string, any> = {
        confirmation_status: selectedStatus,
        customer_name: editCustomer.name,
        customer_phone: editCustomer.phone,
        customer_city: editCustomer.city,
        customer_address: editCustomer.address,
        product_name: activeItems[0]?.name || currentOrder.product_name,
        quantity: activeItems.reduce((s, i) => s + i.qty, 0),
        price: activeItems[0]?.price || currentOrder.price,
        total_amount: orderTotal,
        note: note.trim() || currentOrder.note,
        attempt_count: currentOrder.attempt_count + (selectedStatus === "no_answer" ? 1 : 0),
      };

      if (selectedStatus === "confirmed") {
        updateData.confirmed_at = new Date().toISOString();
        updateData.delivery_status = shippingStatus === "shipped" ? "shipped" : "pending";
      }
      if (selectedStatus === "cancelled") {
        updateData.cancel_reason = cancelReason === "other" ? note.trim() : cancelReason;
      }
      if (selectedStatus === "postponed" && postponeDate) {
        // Combine date + time
        const [hourStr, rest] = postponeTime.split(":");
        const minuteStr = rest?.replace(/ (AM|PM)/, "") || "0";
        const ampm = postponeTime.includes("PM") ? "PM" : "AM";
        let hour = parseInt(hourStr) || 10;
        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;
        const combined = new Date(postponeDate);
        combined.setHours(hour, parseInt(minuteStr) || 0, 0, 0);
        updateData.postpone_date = combined.toISOString();
        updateData.postpone_note = postponeNote.trim();
        updateData.original_agent_id = authUser.id; // Track who postponed it
      }
      if (selectedStatus === "no_answer") {
        // Keep agent_id so it comes back to same agent as retry
      }

      // Update order in DB
      const { error: updateError } = await supabase
        .from("orders")
        .update(updateData as any)
        .eq("id", currentOrder.id);

      if (updateError) throw updateError;

      // Log history
      const historyEntries: { order_id: string; changed_by: string; changed_by_role: string; field_changed: string; old_value: string | null; new_value: string | null }[] = [];
      const trackChange = (field: string, oldVal: any, newVal: any) => {
        const oldStr = oldVal != null ? String(oldVal) : null;
        const newStr = newVal != null ? String(newVal) : null;
        if (oldStr !== newStr) {
          historyEntries.push({ order_id: currentOrder.order_id, changed_by: authUser.id, changed_by_role: "agent", field_changed: field, old_value: oldStr, new_value: newStr });
        }
      };

      trackChange("confirmation_status", currentOrder.confirmation_status, selectedStatus);
      trackChange("customer_name", currentOrder.customer_name, editCustomer.name);
      trackChange("customer_phone", currentOrder.customer_phone, editCustomer.phone);
      trackChange("customer_city", currentOrder.customer_city, editCustomer.city);
      trackChange("customer_address", currentOrder.customer_address, editCustomer.address);
      trackChange("product_name", currentOrder.product_name, activeItems[0]?.name);
      trackChange("quantity", currentOrder.quantity, activeItems.reduce((s, i) => s + i.qty, 0));
      trackChange("price", currentOrder.price, activeItems[0]?.price);
      trackChange("total_amount", currentOrder.total_amount, orderTotal);
      if (selectedStatus === "confirmed") trackChange("delivery_status", currentOrder.delivery_status, shippingStatus === "shipped" ? "shipped" : "pending");
      if (selectedStatus === "cancelled") trackChange("cancel_reason", currentOrder.cancel_reason, cancelReason === "other" ? note.trim() : cancelReason);
      if (note.trim() && note.trim() !== (currentOrder.note || "")) trackChange("note", currentOrder.note, note.trim());
      if (selectedStatus === "postponed" && postponeNote.trim()) trackChange("postpone_note", currentOrder.postpone_note, postponeNote.trim());

      if (historyEntries.length > 0) {
        await supabase.from("order_history").insert(historyEntries);
      }

      toast.success(`Order ${currentOrder.order_id} → ${selectedStatus.toUpperCase()} ✅`, {
        duration: 3000,
        style: { background: "hsl(155, 50%, 96%)", border: "1px solid hsl(155, 50%, 42%)", color: "hsl(155, 50%, 25%)", fontWeight: 600 },
      });

      await moveToNext();
    } catch (err: any) {
      console.error("Submit error:", err);
      toast.error(err.message || "Failed to update order");
    } finally {
      setSubmitting(false);
    }
  };

  const moveToNext = async () => {
    let nextIdx = currentIndex + 1;

    while (nextIdx < orderQueue.length) {
      const nextOrder = orderQueue[nextIdx];
      if (nextOrder.agent_id === authUser?.id) {
        const claimed = await claimOrder(nextOrder);
        if (claimed) { setCurrentIndex(nextIdx); return; }
      } else {
        const claimed = await claimOrder(nextOrder);
        if (claimed) { setCurrentIndex(nextIdx); return; }
      }
      nextIdx++;
    }

    // Queue exhausted — try atomic claim directly before refetching
    const types = ["duplicate", "new", "postponed", "no_answer"];
    for (const t of types) {
      const order = await claimOrderAtomic(t);
      if (order) {
        setOrderQueue([order]);
        setCurrentIndex(0);
        initOrderState(order);
        toast.info(`Got next ${t} order atomically ✅`);
        // Then refetch full queue in background
        fetchPrioritizedOrders().then(fresh => {
          if (fresh.length > 0) {
            setOrderQueue(fresh);
            setCurrentIndex(0);
          }
        });
        return;
      }
    }

    toast.success("All orders processed! 🎉");
    setStarted(false);
    setOrderQueue([]);
  };

  const handleWhatsApp = () => {
    const phone = editCustomer.phone.replace(/\s/g, "");
    window.open(`https://wa.me/${phone}`, "_blank");
  };

  const updateItem = (index: number, field: "qty" | "price", value: number) => {
    setEditItems((items) => items.map((it, i) => i === index ? { ...it, [field]: value } : it));
  };
  const removeItem = (index: number) => {
    setEditItems((items) => items.filter((_, i) => i !== index));
    toast.info("Item removed");
  };

  // ─── NOT STARTED SCREEN ───
  if (!started) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 p-6">
        <div className="text-center space-y-3">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Ready to start confirming?</h1>
          <p className="text-muted-foreground text-sm max-w-md">
            You have <span className="font-bold text-primary">{newOrderCount}</span> new orders
            {retryCount > 0 && (
              <>, <span className="font-bold text-blue-500">{retryCount}</span> retries</>
            )}
            {duplicateCount > 0 && (
              <>, <span className="font-bold text-amber-500">{duplicateCount}</span> duplicates</>
            )}
            {" "}waiting. Orders come one by one with smart prioritization.
          </p>
        </div>
        <Button
          size="lg"
          className="gap-2 text-base px-8 py-6 rounded-xl shadow-lg hover:shadow-xl transition-all"
          onClick={handleStart}
          disabled={(newOrderCount === 0 && retryCount === 0) || loading}
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
          Start Smart Confirmation
        </Button>
      </div>
    );
  }

  if (!currentOrder || claiming) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

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

      {/* Context badges */}
      <div className="flex flex-wrap gap-2">
        {currentOrder._isFollowUp && (
          <Badge variant="outline" className="text-[10px] gap-1 bg-blue-500/10 text-blue-600 border-blue-500/20">
            <RotateCcw className="h-3 w-3" /> Follow-up · Attempt #{currentOrder.attempt_count + 1}
          </Badge>
        )}
        {currentOrder._isDuplicate && (
          <Badge variant="outline" className="text-[10px] gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
            <Copy className="h-3 w-3" /> Duplicate Group · {currentOrder._duplicateGroup?.length} orders
          </Badge>
        )}
        {currentOrder._isPostponedReassign && (
          <Badge variant="outline" className="text-[10px] gap-1 bg-purple-500/10 text-purple-600 border-purple-500/20">
            <AlertTriangle className="h-3 w-3" /> Postponed (from another agent)
          </Badge>
        )}
      </div>

      {/* Postponed context from previous agent */}
      {currentOrder._isPostponedReassign && currentOrder.postpone_note && (
        <Card className="border-purple-500/30 bg-purple-500/5">
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-purple-600 font-semibold flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Original Agent Note
            </p>
            <p className="text-sm text-foreground">{currentOrder.postpone_note}</p>
            {currentOrder.postpone_date && (
              <p className="text-[10px] text-muted-foreground">
                Scheduled for: {format(new Date(currentOrder.postpone_date), "dd/MM/yyyy hh:mm a")}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Also show postpone note for own follow-ups */}
      {currentOrder._isFollowUp && !currentOrder._isPostponedReassign && currentOrder.postpone_note && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="py-3 px-4 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Your Previous Note
            </p>
            <p className="text-sm text-foreground">{currentOrder.postpone_note}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Order Info (3 cols) */}
        <div className="lg:col-span-3 space-y-4">
          {/* Customer Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <User className="h-4 w-4 text-primary" />
                Customer Info
                <Badge variant="outline" className="ml-auto text-[10px]">{currentOrder.order_id}</Badge>
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
              {activeItems.map((op, i) => {
                // Look up product_url from seller's products table
                const matchedProduct = sellerProducts.find(p => p.name === op.name);
                const productStoreUrl = currentOrder.product_url || matchedProduct?.product_url || currentOrder.store_url;
                const productVideoUrl = currentOrder.video_url || matchedProduct?.video_url;

                return (
                  <div key={i} className="p-3 rounded-lg bg-muted/40 border border-border/50 space-y-2">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <p className="text-sm font-semibold truncate">{op.name}</p>

                        {editMode ? (
                          <div className="flex items-center gap-2">
                            <div className="space-y-0.5">
                              <Label className="text-[9px] text-muted-foreground">Qty</Label>
                              <Input
                                type="number" min={1} value={op.qty}
                                onChange={(e) => updateItem(i, "qty", parseInt(e.target.value) || 1)}
                                className="h-7 w-16 text-xs"
                              />
                            </div>
                            <div className="space-y-0.5">
                              <Label className="text-[9px] text-muted-foreground">Price (MAD)</Label>
                              <Input
                                type="number" min={0} value={op.price}
                                onChange={(e) => updateItem(i, "price", parseInt(e.target.value) || 0)}
                                className="h-7 w-20 text-xs"
                              />
                            </div>
                            {activeItems.length > 1 && (
                              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive hover:text-destructive mt-3" onClick={() => removeItem(i)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
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

                        {/* Last Selling Price — order-level or historical fallback */}
                        {(() => {
                          const effectiveLastPrice = (currentOrder.last_price != null && Number(currentOrder.last_price) > 0)
                            ? Number(currentOrder.last_price)
                            : historicalLastPrice;
                          if (!effectiveLastPrice || effectiveLastPrice <= 0) return null;
                          return (
                            <div className="rounded-md bg-accent/60 border border-accent px-2.5 py-1.5 flex items-center gap-2">
                              <DollarSign className="h-3 w-3 text-primary shrink-0" />
                              <span className="text-[10px] text-muted-foreground">Last sold at</span>
                              <span className="text-xs font-bold text-primary tabular-nums">{effectiveLastPrice} MAD</span>
                              {effectiveLastPrice !== op.price && (
                                <span className={cn(
                                  "text-[9px] font-semibold px-1.5 py-0.5 rounded-full",
                                  effectiveLastPrice < op.price
                                    ? "bg-emerald-500/10 text-emerald-600"
                                    : "bg-amber-500/10 text-amber-600"
                                )}>
                                  {effectiveLastPrice < op.price ? "↓" : "↑"} {Math.abs(op.price - effectiveLastPrice)} MAD
                                </span>
                              )}
                            </div>
                          );
                        })()}

                        {/* Store & Video Links */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {productStoreUrl ? (
                            <a href={productStoreUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                              <Store className="h-3 w-3" /> Store Link <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded-md">
                              <Store className="h-3 w-3" /> No Store Link
                            </span>
                          )}
                          {productVideoUrl ? (
                            <a href={productVideoUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline bg-primary/5 px-2 py-1 rounded-md border border-primary/10">
                              <Video className="h-3 w-3" /> Video <ExternalLink className="h-2.5 w-2.5" />
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
                );
              })}

              {/* Offers Section — order-level or historical fallback */}
              {(() => {
                const effectiveOffers = (currentOrder.offers && currentOrder.offers.trim())
                  ? currentOrder.offers.trim()
                  : historicalOffers;
                if (!effectiveOffers) return null;
                return (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
                    <p className="text-[10px] uppercase tracking-wider font-semibold text-amber-600 flex items-center gap-1">
                      <Tag className="h-3 w-3" /> Offers / Promotions
                      {!(currentOrder.offers && currentOrder.offers.trim()) && (
                        <span className="text-[9px] font-normal text-muted-foreground ml-1">(from previous order)</span>
                      )}
                    </p>
                    <p className="text-sm text-foreground font-medium">{effectiveOffers}</p>
                  </div>
                );
              })()}

              {/* Add Item Button */}
              {editMode && sellerProducts.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="w-full h-8 text-xs gap-1.5 border-dashed">
                      <Plus className="h-3 w-3" /> Add Product from Seller's Catalog
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-2" align="start">
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {sellerProducts
                        .filter(sp => !activeItems.some(ai => ai.name === sp.name))
                        .map(sp => (
                          <button
                            key={sp.id}
                            className="w-full text-left px-3 py-2 rounded-md hover:bg-accent text-xs flex items-center justify-between gap-2 transition-colors"
                            onClick={() => {
                              setEditItems(prev => [...prev, { name: sp.name, qty: 1, price: sp.price }]);
                            }}
                          >
                            <span className="truncate font-medium">{sp.name}</span>
                            <span className="text-muted-foreground shrink-0">{sp.price} MAD</span>
                          </button>
                        ))}
                      {sellerProducts.filter(sp => !activeItems.some(ai => ai.name === sp.name)).length === 0 && (
                        <p className="text-[10px] text-muted-foreground text-center py-2">All products already added</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              )}

              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm font-semibold">Total</span>
                <span className="text-lg font-bold text-primary tabular-nums">{orderTotal} MAD</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Action Panel (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
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
                  <Label className="text-xs font-semibold flex items-center gap-1">📦 Shipping Status *</Label>
                  <Select value={shippingStatus} onValueChange={setShippingStatus}>
                    <SelectTrigger className="h-9 text-xs">
                      <SelectValue placeholder="Select shipping status..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="shipped" className="text-xs">🚚 Shipped — Sent to shipping company</SelectItem>
                      <SelectItem value="not_yet" className="text-xs">⏳ Not Yet — Pending shipment</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[50px]" />
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
                    <Textarea placeholder="Please describe the reason... (required)" value={note} onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[60px]" />
                  )}
                  {cancelReason && cancelReason !== "other" && (
                    <Textarea placeholder="Additional note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[50px]" />
                  )}
                </div>
              )}

              {/* Postponed → Date/Time + REQUIRED note */}
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
                      <Calendar mode="single" selected={postponeDate} onSelect={setPostponeDate} disabled={(d) => d < new Date()} className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Time</Label>
                    <div className="flex gap-2">
                      <Select value={postponeTime.split(":")[0] || "10"} onValueChange={(h) => setPostponeTime(`${h}:${postponeTime.split(":")[1]?.replace(/ (AM|PM)/, "") || "00"} ${postponeTime.includes("PM") ? "PM" : "AM"}`)}>
                        <SelectTrigger className="h-9 text-xs w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((h) => (
                            <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground self-center">:</span>
                      <Input type="number" min={0} max={59} placeholder="00"
                        value={postponeTime.split(":")[1]?.replace(/ (AM|PM)/, "") || ""}
                        onChange={(e) => {
                          let v = e.target.value.replace(/\D/g, "").slice(0, 2);
                          if (parseInt(v) > 59) v = "59";
                          setPostponeTime(`${postponeTime.split(":")[0] || "10"}:${v} ${postponeTime.includes("PM") ? "PM" : "AM"}`);
                        }}
                        className="h-9 text-xs w-16 text-center"
                      />
                      <Select value={postponeTime.includes("PM") ? "PM" : "AM"} onValueChange={(ampm) => setPostponeTime(postponeTime.replace(/ (AM|PM)/, "") + ` ${ampm}`)}>
                        <SelectTrigger className="h-9 text-xs w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="AM" className="text-xs">AM</SelectItem>
                          <SelectItem value="PM" className="text-xs">PM</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs font-semibold flex items-center gap-1 text-amber-700">
                      <StickyNote className="h-3 w-3" /> Postpone Note * (required)
                    </Label>
                    <Textarea
                      placeholder='e.g. "Call tomorrow at 5pm — client busy at work"'
                      value={postponeNote}
                      onChange={(e) => setPostponeNote(e.target.value)}
                      className="text-xs min-h-[60px] border-amber-500/30"
                    />
                    {!postponeNote.trim() && (
                      <p className="text-[10px] text-destructive">⚠️ Note is required when postponing</p>
                    )}
                  </div>
                </div>
              )}

              {/* Other statuses → Optional note */}
              {selectedStatus && !["cancelled", "postponed", "confirmed"].includes(selectedStatus) && (
                <Textarea placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="text-xs min-h-[50px]" />
              )}

              <Button className="w-full gap-2" onClick={handleSubmit} disabled={!canSubmit || submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
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
