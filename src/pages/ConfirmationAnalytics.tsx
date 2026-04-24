import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { SearchableSelect } from "@/components/SearchableSelect";
import { KPICard } from "@/components/KPICard";
import { Phone, CheckCircle2, PhoneCall, Clock, XCircle, AlertTriangle, Truck, ShoppingCart, Loader2, Timer, Hourglass, ClipboardCheck, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DatePresetFilter, type DatePresetValue } from "@/components/DatePresetFilter";
import { DateRange } from "react-day-picker";
import { supabase } from "@/integrations/supabase/client";
import { SmartRecommendations } from "@/components/SmartRecommendations";
import { DailyConfirmationReport } from "@/components/DailyConfirmationReport";

export default function ConfirmationAnalytics() {
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

  // Fetch all orders
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["confirmation-analytics-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, cancel_reason, product_name, seller_id, agent_id, original_agent_id, created_at, confirmed_at, delivered_at, assigned_at, last_attempt_at, last_activity_at, updated_at, price, quantity, postpone_date, attempt_count")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Fetch profiles for sellers & agents
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch agent roles
  const { data: agentRoles = [] } = useQuery({
    queryKey: ["agent-roles-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id").eq("role", "agent");
      if (error) throw error;
      return data;
    },
  });

  // Fetch order history for time calculations
  const { data: orderHistory = [] } = useQuery({
    queryKey: ["order-history-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("order_history")
        .select("order_id, field_changed, old_value, new_value, created_at, changed_by")
        .in("field_changed", ["confirmation_status", "agent_id"])
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
  });

  // Fetch calls for duration tracking
  const { data: callsData = [] } = useQuery({
    queryKey: ["calls-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calls")
        .select("agent_id, duration");
      if (error) throw error;
      return data;
    },
  });

  const profileNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { map[p.user_id] = p.name; });
    return map;
  }, [profiles]);

  const agentIds = useMemo(() => agentRoles.map(r => r.user_id), [agentRoles]);

  const agentOptions = useMemo(() => {
    return agentIds.map(id => ({
      value: id,
      label: profileNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [agentIds, profileNameMap]);

  const sellerOptions = useMemo(() => {
    const ids = new Set(orders.map(o => o.seller_id));
    return [...ids].map(id => ({
      value: id,
      label: profileNameMap[id] || id.slice(0, 8),
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, profileNameMap]);

  const productOptions = useMemo(() => {
    const source = sellerFilter !== "all"
      ? orders.filter(o => o.seller_id === sellerFilter)
      : orders;
    const names = new Set(source.map(o => o.product_name).filter(Boolean));
    return [...names].map(n => ({ value: n, label: n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [orders, sellerFilter]);

  // Filter orders — use original_agent_id as fallback for released orders
  // Treatment date: the most relevant action timestamp for an order
  const getTreatmentDate = (o: typeof orders[0]): Date => {
    if (o.confirmation_status === 'confirmed' && o.confirmed_at) return new Date(o.confirmed_at);
    if (o.last_attempt_at) return new Date(o.last_attempt_at);
    if (o.last_activity_at) return new Date(o.last_activity_at);
    return new Date(o.updated_at);
  };

  // When filtering by agent, include orders where the agent performed a confirmation_status
  // action within the selected date range (this is the agent's actual workload for the period).
  // We derive each order's "effective status" from the agent's LAST action on it in the period,
  // so downstream sections (cancel reasons, top products, daily report) reflect what the agent did.
  const agentActionsInPeriod = useMemo(() => {
    if (agentFilter === "all") return null;
    const map = new Map<string, { lastStatus: string; lastAt: string }>();
    orderHistory.forEach(h => {
      if (h.field_changed !== "confirmation_status") return;
      if (h.changed_by !== agentFilter) return;
      if (dateRange?.from && new Date(h.created_at) < dateRange.from) return;
      if (dateRange?.to && new Date(h.created_at) > dateRange.to) return;
      const prev = map.get(h.order_id);
      if (!prev || new Date(h.created_at) > new Date(prev.lastAt)) {
        map.set(h.order_id, { lastStatus: h.new_value || "", lastAt: h.created_at });
      }
    });
    return map;
  }, [orderHistory, agentFilter, dateRange]);

  const filteredOrders = useMemo(() => {
    let filtered = [...orders];
    if (agentActionsInPeriod) {
      // Only orders the agent actually acted on in the period, with their "effective status"
      // overridden to the status the agent set (so cancel/postpone breakdowns are accurate).
      filtered = filtered
        .filter(o => agentActionsInPeriod.has(o.order_id))
        .map(o => {
          const action = agentActionsInPeriod.get(o.order_id)!;
          return { ...o, confirmation_status: action.lastStatus || o.confirmation_status };
        });
    }
    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    if (agentFilter === "all") {
      if (dateRange?.from) filtered = filtered.filter(o => getTreatmentDate(o) >= dateRange.from!);
      if (dateRange?.to) filtered = filtered.filter(o => getTreatmentDate(o) <= dateRange.to!);
    }
    return filtered;
  }, [orders, agentActionsInPeriod, agentFilter, sellerFilter, productFilter, dateRange]);

  // Stats
  const stats = useMemo(() => {
    const total = filteredOrders.length;
    const delivered = filteredOrders.filter(o => o.delivery_status === "delivered" || o.delivery_status === "paid").length;

    // Build set of filtered order_ids for cross-referencing
    const filteredOrderIds = new Set(filteredOrders.map(o => o.order_id));

    // Action-based counts from order_history.
    // When an agent filter is active, count actions performed by that agent (changed_by).
    // This reflects "what the agent actually did" instead of the order's current status,
    // because orders can be reassigned/changed by other agents afterwards.
    const actionMatchesFilters = (h: typeof orderHistory[0]) => {
      if (h.field_changed !== "confirmation_status") return false;
      if (!filteredOrderIds.has(h.order_id)) return false;
      if (agentFilter !== "all" && h.changed_by !== agentFilter) return false;
      if (dateRange?.from && new Date(h.created_at) < dateRange.from) return false;
      if (dateRange?.to && new Date(h.created_at) > dateRange.to) return false;
      return true;
    };

    const treatedActions = orderHistory.filter(actionMatchesFilters);
    const treated = treatedActions.length;

    // Distinct orders that the agent moved to a given status during the period.
    // Using a Set on order_id avoids double-counting if status was toggled multiple times.
    const distinctOrdersByNewValue = (status: string) => {
      const ids = new Set<string>();
      treatedActions.forEach(h => { if (h.new_value === status) ids.add(h.order_id); });
      return ids.size;
    };

    let confirmed: number;
    let cancelled: number;
    let postponed: number;

    if (agentFilter !== "all") {
      // Per-agent view: count agent's actions in the period (true workload).
      confirmed = distinctOrdersByNewValue("confirmed");
      cancelled = distinctOrdersByNewValue("cancelled");
      postponed = distinctOrdersByNewValue("postponed");
    } else {
      // Global view: keep current state of orders (overall pipeline snapshot).
      confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed").length;
      cancelled = filteredOrders.filter(o => o.confirmation_status === "cancelled").length;
      postponed = filteredOrders.filter(o => o.confirmation_status === "postponed").length;
    }

    // Claimed = unique orders that were claimed (assigned to agent) AND status was changed
    const claimed = filteredOrders.filter(o => (o.agent_id || o.original_agent_id) && o.confirmation_status !== "new").length;

    // Confirmation rate from claimed orders
    const confirmationRate = claimed > 0 ? Math.round((confirmed / claimed) * 100) : 0;

    // Delivery rate = delivered / confirmed (not shipped)
    const deliveryRate = confirmed > 0 ? Math.round((delivered / confirmed) * 100) : 0;

    return {
      total,
      confirmed,
      treated,
      claimed,
      confirmationRate,
      cancelled,
      cancelledRate: claimed > 0 ? Math.round((cancelled / claimed) * 100) : 0,
      postponed,
      postponedRate: claimed > 0 ? Math.round((postponed / claimed) * 100) : 0,
      delivered,
      deliveredRate: deliveryRate,
    };
  }, [filteredOrders, orderHistory, agentFilter, dateRange]);

  // Time-based KPIs: First Call Avg & Handling Time
  const timeStats = useMemo(() => {
    // Build maps from order_history
    // First status change per order (first time confirmation_status changed from 'new')
    const firstStatusChangeMap: Record<string, string> = {};
    // Agent claim time per order (when agent_id was set)
    const agentClaimMap: Record<string, string> = {};
    // First status change after agent claim
    const firstChangeAfterClaimMap: Record<string, string> = {};

    orderHistory.forEach(h => {
      if (h.field_changed === "confirmation_status" && h.old_value === "new" && !firstStatusChangeMap[h.order_id]) {
        firstStatusChangeMap[h.order_id] = h.created_at;
      }
      if (h.field_changed === "agent_id" && !h.old_value && h.new_value && !agentClaimMap[h.order_id]) {
        agentClaimMap[h.order_id] = h.created_at;
      }
    });

    // Find first status change AFTER agent claim
    orderHistory.forEach(h => {
      if (h.field_changed === "confirmation_status" && agentClaimMap[h.order_id] && !firstChangeAfterClaimMap[h.order_id]) {
        const claimTime = new Date(agentClaimMap[h.order_id]).getTime();
        const changeTime = new Date(h.created_at).getTime();
        if (changeTime >= claimTime) {
          firstChangeAfterClaimMap[h.order_id] = h.created_at;
        }
      }
    });

    // Build order created_at map from filtered orders
    const orderCreatedMap: Record<string, string> = {};
    const filteredOrderIds = new Set<string>();
    filteredOrders.forEach(o => {
      orderCreatedMap[o.order_id] = o.created_at;
      filteredOrderIds.add(o.order_id);
    });

    // First Call Avg: time from created_at to first status change
    let firstCallTotalMs = 0;
    let firstCallCount = 0;
    for (const [orderId, changeTime] of Object.entries(firstStatusChangeMap)) {
      if (!filteredOrderIds.has(orderId) || !orderCreatedMap[orderId]) continue;
      const diff = new Date(changeTime).getTime() - new Date(orderCreatedMap[orderId]).getTime();
      if (diff > 0) { firstCallTotalMs += diff; firstCallCount++; }
    }

    // Handling Time: time from agent claim to first status change after claim
    let handlingTotalMs = 0;
    let handlingCount = 0;
    for (const [orderId, changeTime] of Object.entries(firstChangeAfterClaimMap)) {
      if (!filteredOrderIds.has(orderId) || !agentClaimMap[orderId]) continue;
      const diff = new Date(changeTime).getTime() - new Date(agentClaimMap[orderId]).getTime();
      if (diff > 0) { handlingTotalMs += diff; handlingCount++; }
    }

    const formatDuration = (ms: number) => {
      const totalMinutes = Math.round(ms / 60000);
      if (totalMinutes < 60) return `${totalMinutes}m`;
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      if (hours < 24) return `${hours}h ${mins}m`;
      const days = Math.floor(hours / 24);
      const remHours = hours % 24;
      return `${days}d ${remHours}h`;
    };

    return {
      firstCallAvg: firstCallCount > 0 ? formatDuration(firstCallTotalMs / firstCallCount) : "N/A",
      handlingTime: handlingCount > 0 ? formatDuration(handlingTotalMs / handlingCount) : "N/A",
    };
  }, [orderHistory, filteredOrders]);

  // Agent scores — use original_agent_id as fallback for attribution
  const agentScores = useMemo(() => {
    // Build a map: order_id -> agent who confirmed it (from order_history)
    const confirmedByAgent: Record<string, string> = {};
    orderHistory.forEach(h => {
      if (h.field_changed === "confirmation_status" && h.new_value === "confirmed" && !confirmedByAgent[h.order_id]) {
        const order = filteredOrders.find(o => o.order_id === h.order_id);
        const agentId = order?.agent_id || order?.original_agent_id;
        if (agentId) confirmedByAgent[h.order_id] = agentId;
      }
    });

    const map: Record<string, { total: number; answered: number; confirmed: number; delivered: number }> = {};
    filteredOrders.forEach(o => {
      // Use original_agent_id as fallback for released orders
      const agentId = o.agent_id || o.original_agent_id;
      if (!agentId || o.confirmation_status === "new") return;
      if (!map[agentId]) map[agentId] = { total: 0, answered: 0, confirmed: 0, delivered: 0 };
      map[agentId].total++;
      if (["confirmed", "cancelled", "wrong_number", "reported"].includes(o.confirmation_status)) map[agentId].answered++;
      if (o.confirmation_status === "confirmed") map[agentId].confirmed++;
    });

    // Count delivered orders per confirming agent
    filteredOrders.forEach(o => {
      if (o.delivery_status === "delivered" || o.delivery_status === "paid") {
        const confirmingAgent = confirmedByAgent[o.order_id] || o.agent_id || o.original_agent_id;
        if (confirmingAgent && map[confirmingAgent]) {
          map[confirmingAgent].delivered++;
        }
      }
    });

    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        name: profileNameMap[id] || id.slice(0, 8),
        total: d.total,
        confirmed: d.confirmed,
        confirmationRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
        delivered: d.delivered,
        deliveryRate: d.confirmed > 0 ? Math.round((d.delivered / d.confirmed) * 100) : 0,
      }))
      .sort((a, b) => b.confirmationRate - a.confirmationRate);
  }, [filteredOrders, orderHistory, profileNameMap]);

  // No Answer attempts breakdown
  const noAnswerAttempts = useMemo(() => {
    const noAnswerOrders = filteredOrders.filter(o => o.confirmation_status === "no_answer");
    const buckets: Record<number, number> = {};
    noAnswerOrders.forEach(o => {
      const n = Math.max(1, o.attempt_count ?? 1);
      buckets[n] = (buckets[n] || 0) + 1;
    });
    const total = noAnswerOrders.length;
    const maxAttempt = Object.keys(buckets).length > 0 ? Math.max(...Object.keys(buckets).map(Number)) : 0;
    const rows = [];
    for (let i = 1; i <= maxAttempt; i++) {
      const count = buckets[i] || 0;
      rows.push({
        attempt: i,
        count,
        rate: total > 0 ? Math.round((count / total) * 100) : 0,
      });
    }
    return { rows, total };
  }, [filteredOrders]);

  // Cancel reasons
  const cancelData = useMemo(() => {
    const cancelledOrders = filteredOrders.filter(o => o.confirmation_status === "cancelled");
    const reasons: Record<string, number> = {};
    cancelledOrders.forEach(o => {
      const reason = o.cancel_reason || "Not specified";
      reasons[reason] = (reasons[reason] || 0) + 1;
    });
    const total = cancelledOrders.length;
    return Object.entries(reasons)
      .map(([reason, count]) => ({ reason, count, rate: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [filteredOrders]);

  // Confirmation rate by product — based on claimed orders (not total)
  const confirmByProduct = useMemo(() => {
    const map: Record<string, { leads: number; claimed: number; confirmed: number; cancelled: number; pending: number }> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { leads: 0, claimed: 0, confirmed: 0, cancelled: 0, pending: 0 };
      map[name].leads++;
      if (o.confirmation_status === "new") {
        map[name].pending++;
        return;
      }
      if (!(o.agent_id || o.original_agent_id)) return;
      map[name].claimed++;
      if (o.confirmation_status === "confirmed") map[name].confirmed++;
      if (o.confirmation_status === "cancelled") map[name].cancelled++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        leads: d.leads,
        claimed: d.claimed,
        confirmed: d.confirmed,
        cancelled: d.cancelled,
        pending: d.pending,
        rate: d.claimed > 0 ? Math.round((d.confirmed / d.claimed) * 100) : 0,
        total: d.claimed,
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  // Delivery rate by product — delivered / confirmed
  const deliveryByProduct = useMemo(() => {
    const map: Record<string, { confirmed: number; shipped: number; delivered: number; returned: number; inTransit: number }> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { confirmed: 0, shipped: 0, delivered: 0, returned: 0, inTransit: 0 };
      if (o.confirmation_status === "confirmed") map[name].confirmed++;
      const ds = o.delivery_status;
      if (ds === "shipped" || ds === "in_transit" || ds === "delivered" || ds === "paid" || ds === "returned" || ds === "cancelled") {
        map[name].shipped++;
      }
      if (ds === "delivered" || ds === "paid") map[name].delivered++;
      if (ds === "returned" || ds === "cancelled") map[name].returned++;
      if (ds === "shipped" || ds === "in_transit") map[name].inTransit++;
    });
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        confirmed: d.confirmed,
        shipped: d.shipped,
        delivered: d.delivered,
        returned: d.returned,
        inTransit: d.inTransit,
        rate: d.confirmed > 0 ? Math.round((d.delivered / d.confirmed) * 100) : 0,
        returnRate: d.shipped > 0 ? Math.round((d.returned / d.shipped) * 100) : 0,
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  const rateColor = (rate: number) => rate >= 70 ? 'hsl(155, 50%, 42%)' : rate >= 40 ? 'hsl(38, 90%, 55%)' : 'hsl(0, 65%, 52%)';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="animate-fade-in">
        <h1 className="text-2xl font-semibold">Confirmation Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">Agent performance & confirmation insights</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-card rounded-lg border p-4">
        <SearchableSelect
          value={agentFilter}
          onValueChange={setAgentFilter}
          options={agentOptions}
          placeholder="Agent"
          allLabel="All Agents"
          className="w-[160px]"
        />
        <SearchableSelect
          value={sellerFilter}
          onValueChange={(v) => { setSellerFilter(v); setProductFilter("all"); }}
          options={sellerOptions}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[160px]"
        />
        <SearchableSelect
          value={productFilter}
          onValueChange={setProductFilter}
          options={productOptions}
          placeholder="Product"
          allLabel="All Products"
          className="w-[160px]"
        />
        <DatePresetFilter
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          preset={datePreset}
          onPresetChange={setDatePreset}
        />
        {(agentFilter !== "all" || sellerFilter !== "all" || productFilter !== "all" || dateRange) && (
          <Button variant="ghost" size="sm" className="h-9 text-xs" onClick={() => { setAgentFilter("all"); setSellerFilter("all"); setProductFilter("all"); setDatePreset("maximum"); setDateRange(undefined); }}>
            Clear
          </Button>
        )}
      </div>

      {/* KPI Cards removed per request */}

      {/* Daily Confirmation Report (includes merged Agent Performance Breakdown) */}
      <DailyConfirmationReport
        orders={filteredOrders.map(o => ({
          agent_id: o.agent_id,
          original_agent_id: o.original_agent_id,
          confirmation_status: o.confirmation_status,
          postpone_date: o.postpone_date,
        }))}
        profileNameMap={profileNameMap}
        agentIds={agentIds}
        treatedOrders={stats.treated}
        firstCallAvg={timeStats.firstCallAvg}
        handlingTime={timeStats.handlingTime}
        agentScores={agentScores.map(a => ({
          id: a.id,
          confirmed: a.confirmed,
          confirmationRate: a.confirmationRate,
          delivered: a.delivered,
          deliveryRate: a.deliveryRate,
        }))}
      />


      {/* Smart Recommendations */}
      <SmartRecommendations
        orders={filteredOrders.map(o => ({
          agent_id: o.agent_id || '',
          original_agent_id: o.original_agent_id || null,
          confirmation_status: o.confirmation_status,
          delivery_status: o.delivery_status,
          created_at: o.created_at,
          assigned_at: o.assigned_at || null,
          confirmed_at: o.confirmed_at || null,
          attempt_count: o.attempt_count ?? 0,
          postpone_date: o.postpone_date,
        })).filter(o => o.agent_id !== '' || o.original_agent_id !== null)}
        orderHistory={orderHistory}
        calls={callsData}
        profileNameMap={profileNameMap}
        agentIds={agentIds}
      />

      {/* No Answer Attempts Breakdown */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '125ms' }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">No Answer — Attempts Breakdown</h2>
          </div>
          <span className="text-xs text-muted-foreground tabular-nums">{noAnswerAttempts.total} orders</span>
        </div>
        {noAnswerAttempts.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No "No Answer" orders in selected period</p>
        ) : (
          <div className="space-y-3">
            {noAnswerAttempts.rows.map(r => (
              <div key={r.attempt} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium">Attempt {r.attempt}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{r.count} orders · {r.rate}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-warning/70 rounded-full transition-all" style={{ width: `${r.rate}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cancel Reasons */}
      <div className="bg-card rounded-lg border p-5 animate-slide-up" style={{ animationDelay: '150ms' }}>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Cancellation Reasons</h2>
        {cancelData.length === 0 ? (
          <p className="text-muted-foreground text-sm">No cancellations in selected period</p>
        ) : (
          <div className="space-y-3">
            {cancelData.map(r => (
              <div key={r.reason} className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium">{r.reason}</span>
                    <span className="text-xs text-muted-foreground">{r.count} orders · {r.rate}%</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-destructive/70 rounded-full transition-all" style={{ width: `${r.rate}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Product performance tables */}
      <div className="space-y-6">
        <div className="bg-card rounded-lg border animate-slide-up overflow-hidden" style={{ animationDelay: '200ms' }}>
          <div className="p-5 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Confirmation Rate by Product</h2>
            <span className="text-xs text-muted-foreground">{confirmByProduct.length} products</span>
          </div>
          {confirmByProduct.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-10">No data</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10 border-y">
                  <tr className="text-left">
                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground w-10">#</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Product</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Leads</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Claimed</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Pending</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Confirmed</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Cancelled</th>
                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums w-24">Conf. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {confirmByProduct.map((entry, idx) => (
                    <tr key={entry.name} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-2.5 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                      <td className="px-2 py-2.5 font-medium truncate max-w-[280px]" title={entry.name}>{entry.name}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.leads}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.claimed}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.pending}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{entry.confirmed}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.cancelled}</td>
                      <td className="px-5 py-2.5 text-right">
                        <span
                          className="inline-flex items-center justify-center min-w-[52px] px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums"
                          style={{ backgroundColor: `${rateColor(entry.rate)}20`, color: rateColor(entry.rate) }}
                        >
                          {entry.rate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-card rounded-lg border animate-slide-up overflow-hidden" style={{ animationDelay: '250ms' }}>
          <div className="p-5 pb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Delivery Rate by Product</h2>
            <span className="text-xs text-muted-foreground">{deliveryByProduct.length} products</span>
          </div>
          {deliveryByProduct.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-10">No data</p>
          ) : (
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card z-10 border-y">
                  <tr className="text-left">
                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground w-10">#</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground">Product</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Confirmed</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Shipped</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">In Transit</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Delivered</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums">Returned</th>
                    <th className="px-2 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums w-20">Return %</th>
                    <th className="px-5 py-2 text-xs font-medium text-muted-foreground text-right tabular-nums w-24">Del. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveryByProduct.map((entry, idx) => (
                    <tr key={entry.name} className="border-b last:border-0 hover:bg-muted/40 transition-colors">
                      <td className="px-5 py-2.5 text-xs text-muted-foreground tabular-nums">{idx + 1}</td>
                      <td className="px-2 py-2.5 font-medium truncate max-w-[280px]" title={entry.name}>{entry.name}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.confirmed}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.shipped}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.inTransit}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-foreground">{entry.delivered}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{entry.returned}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-xs text-muted-foreground">{entry.returnRate}%</td>
                      <td className="px-5 py-2.5 text-right">
                        <span
                          className="inline-flex items-center justify-center min-w-[52px] px-2 py-0.5 rounded-md text-xs font-semibold tabular-nums"
                          style={{ backgroundColor: `${rateColor(entry.rate)}20`, color: rateColor(entry.rate) }}
                        >
                          {entry.rate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
