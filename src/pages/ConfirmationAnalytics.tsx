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
import { startOfDayPKT as startOfDay, endOfDayPKT as endOfDay } from "@/lib/timezone";
import { supabase } from "@/integrations/supabase/client";
import { SmartRecommendations } from "@/components/SmartRecommendations";
import { DailyConfirmationReport } from "@/components/DailyConfirmationReport";
import { confirmationRatePercent } from "@/lib/confirmation-rate";
import { deliveryRatePercent, isDeliveredStatus, isInShippedDeliveryPool } from "@/lib/delivery-rate";
import { useAuth } from "@/contexts/AuthContext";

type DateField = "created" | "updated";

export default function ConfirmationAnalytics() {
  const { authUser } = useAuth();
  const isGeneralManager = authUser?.role === "general_manager";
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [sellerFilter, setSellerFilter] = useState<string>("all");
  const [productFilter, setProductFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("maximum");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [dateField, setDateField] = useState<DateField>("updated");

  // Fetch ALL orders with pagination — Supabase caps at 1000 rows by default,
  // so we paginate to avoid silently missing orders (which causes under-counting).
  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["confirmation-analytics-orders"],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: Array<{
        id: string; order_id: string; confirmation_status: string; confirmation_channel: string | null;
        delivery_status: string; cancel_reason: string | null; product_name: string; seller_id: string;
        agent_id: string | null; original_agent_id: string | null; created_at: string;
        confirmed_at: string | null; delivered_at: string | null; assigned_at: string | null;
        last_attempt_at: string | null; last_activity_at: string | null; updated_at: string;
        price: number | null; quantity: number | null; postpone_date: string | null; attempt_count: number | null;
      }> = [];
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("id, order_id, confirmation_status, confirmation_channel, delivery_status, cancel_reason, product_name, seller_id, agent_id, original_agent_id, created_at, confirmed_at, delivered_at, assigned_at, last_attempt_at, last_activity_at, updated_at, price, quantity, postpone_date, attempt_count")
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
    },
  });

  // Fetch profiles for sellers & agents
  const { data: profiles = [] } = useQuery({
    queryKey: ["profiles-for-analytics"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("user_id, name, phone");
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

  // Fetch order history for time calculations.
  // Supabase caps queries at 1000 rows by default — we paginate to get the full dataset,
  // otherwise recent events (today's actions) get cut off when history grows large.
  const { data: orderHistory = [] } = useQuery({
    queryKey: ["order-history-for-analytics"],
    queryFn: async () => {
      const pageSize = 1000;
      let from = 0;
      const all: Array<{ order_id: string; field_changed: string; old_value: string | null; new_value: string | null; created_at: string; changed_by: string }> = [];
      while (true) {
        const { data, error } = await supabase
          .from("order_history")
          .select("order_id, field_changed, old_value, new_value, created_at, changed_by")
          // "agent_id" is legacy and has zero rows in the live table — the app's
          // claim mechanism writes "agent_lock" (old_value null -> agent's id
          // when claimed, back to null when released) instead. Querying
          // "agent_id" silently returned nothing, so every claim-to-response
          // time metric on this page (Handling Time, SmartRecommendations'
          // Avg Time / "Agent is slow" detection) always showed N/A / defaulted.
          .in("field_changed", ["confirmation_status", "agent_lock"])
          .order("created_at", { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
      return all;
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

  const profilePhoneMap = useMemo(() => {
    const map: Record<string, string> = {};
    profiles.forEach(p => { if (p.phone) map[p.user_id] = p.phone; });
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

  // STATUS-EVENT BASED FILTERING
  // All confirmation analytics are based on order_history confirmation_status events.
  // For each order, we keep the LAST status-change action that matches the active filters
  // (date range + optional agent). The order's "effective status" is overridden to the
  // status set by that action — so all downstream sections (KPIs, cancel reasons, product
  // tables, daily report) reflect what actually happened in the selected period.
  //
  // This map is active whenever a date range OR an agent filter is applied. When neither
  // is set (= "maximum" with all agents), we fall back to the orders' current status snapshot.
  // When dateField="updated" (default): filter by WHEN the status change happened in order_history
  //   → most accurate for "what did agents do in this period"
  // When dateField="created": filter orders by their created_at directly
  //   → shows orders that were placed in this period (with current statuses)
  // Agent filter always uses history events for precise attribution.
  const statusActionsInPeriod = useMemo(() => {
    const hasDateFilter  = !!(dateRange?.from || dateRange?.to);
    const hasAgentFilter = agentFilter !== "all";
    const useHistoryDate = hasDateFilter && dateField === "updated";

    if (!hasAgentFilter && !useHistoryDate) return null;

    const map = new Map<string, { lastStatus: string; lastAt: string; changedBy: string }>();
    orderHistory.forEach(h => {
      if (h.field_changed !== "confirmation_status") return;
      if (!h.new_value) return; // skip events with no new status (null new_value would cause fallback to stale status)
      if (hasAgentFilter && h.changed_by !== agentFilter) return;
      if (useHistoryDate) {
        if (dateRange?.from && new Date(h.created_at) < dateRange.from) return;
        if (dateRange?.to   && new Date(h.created_at) > dateRange.to)   return;
      }
      const prev = map.get(h.order_id);
      if (!prev || new Date(h.created_at) > new Date(prev.lastAt)) {
        map.set(h.order_id, {
          lastStatus: h.new_value, // guaranteed non-null/empty here
          lastAt: h.created_at,
          changedBy: h.changed_by || "",
        });
      }
    });
    return map;
  }, [orderHistory, agentFilter, dateRange, dateField]);

  const filteredOrders = useMemo(() => {
    // No deduplication — orders that share the same text order_id (generate_order_id
    // overflow bug) are genuinely different orders with different UUIDs and should both
    // be counted. Deduplicating by text order_id would remove legitimate orders.
    let filtered = [...orders];

    // "created" mode: filter by order creation date (direct, no history)
    if (dateRange?.from && dateField === "created") {
      const from = startOfDay(dateRange.from);
      const to   = endOfDay(dateRange.to ?? dateRange.from);
      filtered = filtered.filter(o => {
        const ts = new Date(o.created_at);
        return ts >= from && ts <= to;
      });
    }

    // History-based filter: active for "updated" date mode OR agent filter.
    // Overrides confirmation_status with what actually happened in the period.
    // No fallback to o.confirmation_status — if there's no history entry, the order is excluded.
    if (statusActionsInPeriod) {
      filtered = filtered
        .filter(o => statusActionsInPeriod.has(o.order_id))
        .map(o => {
          const action = statusActionsInPeriod.get(o.order_id)!;
          // _actedBy = who actually made this period's last action — NOT
          // necessarily this order's current agent_id/original_agent_id. An
          // order originally assigned to one agent gets reassigned/reattempted
          // constantly in this workflow; whoever's order_history event this
          // is, is who did today's work, and per-agent breakdowns below must
          // group by that, not by current ownership (reported: HARRAM's
          // "Agent Performance Breakdown" row showed 9 handled orders today
          // despite having zero order_history activity today — all 9 were
          // orders he originally owned that OTHER agents reattempted today).
          return { ...o, confirmation_status: action.lastStatus, _actedBy: action.changedBy || null };
        });
    }

    if (sellerFilter !== "all") filtered = filtered.filter(o => o.seller_id === sellerFilter);
    if (productFilter !== "all") filtered = filtered.filter(o => o.product_name === productFilter);
    return filtered;
  }, [orders, statusActionsInPeriod, sellerFilter, productFilter, dateRange, dateField]);

  // Stats — Claimed/Treated/Confirmed/Cancelled/Postponed/Unreachable must use
  // the SAME population as the Status Distribution breakdown and Agent Scores
  // below (filteredOrders, action-based via statusActionsInPeriod whenever an
  // agent filter or an "updated" date range is active), or the KPI cards
  // silently disagree with the breakdown — reported: filtered to one agent +
  // Today + Updated, "Claimed" showed 22 (ownership snapshot: orders this
  // agent currently/originally owns) while Status Distribution's segments
  // summed to 51 (action log: every order that agent touched today, including
  // ones released back to the queue and reassigned since). Delivery isn't a
  // confirmation-agent action (courier/automation-driven), so it stays on the
  // ownership snapshot regardless of which branch below is active.
  const stats = useMemo(() => {
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.from ? endOfDay(dateRange.to ?? dateRange.from) : null;
    const inSelectedRange = (d: Date) => !from || !to || (d >= from && d <= to);

    const baseOrders = orders.filter(o => {
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (agentFilter !== "all" && o.agent_id !== agentFilter && o.original_agent_id !== agentFilter) return false;
      return true;
    });

    const deliveredDate = (o: typeof orders[number]) =>
      new Date(dateField === "updated" ? (o.delivered_at || o.updated_at) : o.created_at);
    const delivered = baseOrders.filter(o => isDeliveredStatus(o.delivery_status) && inSelectedRange(deliveredDate(o))).length;
    const shippedPool = baseOrders.filter(o => isInShippedDeliveryPool(o.delivery_status) && inSelectedRange(deliveredDate(o))).length;
    const deliveryRate = deliveryRatePercent(delivered, shippedPool);

    let total: number, confirmed: number, newOrders: number, cancelled: number, postponed: number, unreachable: number, treated: number, claimed: number;

    if (statusActionsInPeriod) {
      // Action-based: filteredOrders already carries only orders with a
      // matching order_history event in this period, with confirmation_status
      // overridden to that event's outcome.
      total = filteredOrders.length;
      confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed").length;
      newOrders = filteredOrders.filter(o => o.confirmation_status === "new").length;
      cancelled = filteredOrders.filter(o => o.confirmation_status === "cancelled").length;
      postponed = filteredOrders.filter(o => o.confirmation_status === "postponed").length;
      unreachable = filteredOrders.filter(o => o.confirmation_status === "unreachable").length;
      treated = total; // every order here has a matching action by construction
      claimed = filteredOrders.filter(o => o.agent_id || o.original_agent_id).length;
    } else {
      // Default view (all agents, no date filter or "created" date field):
      // ownership snapshot, unchanged.
      const genericDate = (o: typeof orders[number]) =>
        new Date(dateField === "updated" ? o.updated_at : o.created_at);
      const confirmedDate = (o: typeof orders[number]) =>
        new Date(dateField === "updated" ? (o.confirmed_at || o.updated_at) : o.created_at);
      const denominatorOrders = baseOrders.filter(o => inSelectedRange(genericDate(o)));
      total = denominatorOrders.length;
      confirmed = baseOrders.filter(o => o.confirmation_status === "confirmed" && inSelectedRange(confirmedDate(o))).length;
      newOrders = denominatorOrders.filter(o => o.confirmation_status === "new").length;
      cancelled = denominatorOrders.filter(o => o.confirmation_status === "cancelled").length;
      postponed = denominatorOrders.filter(o => o.confirmation_status === "postponed").length;
      unreachable = denominatorOrders.filter(o => o.confirmation_status === "unreachable").length;

      // Treated = distinct orders that had at least one status-change action within filters.
      const filteredOrderIds = new Set(denominatorOrders.map(o => o.order_id));
      const treatedIds = new Set<string>();
      orderHistory.forEach(h => {
        if (h.field_changed !== "confirmation_status") return;
        if (!h.new_value) return;
        if (!filteredOrderIds.has(h.order_id)) return;
        if (dateRange?.from && new Date(h.created_at) < dateRange.from) return;
        if (dateRange?.to   && new Date(h.created_at) > dateRange.to)   return;
        treatedIds.add(h.order_id);
      });
      treated = treatedIds.size;

      // Claimed = orders that were touched by an agent (status not "new")
      claimed = denominatorOrders.filter(o => (o.agent_id || o.original_agent_id) && o.confirmation_status !== "new").length;
    }

    const confirmationRate = confirmationRatePercent(confirmed, total, newOrders);

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
      unreachable,
      unreachableRate: claimed > 0 ? Math.round((unreachable / claimed) * 100) : 0,
      delivered,
      deliveredRate: deliveryRate,
    };
  }, [orders, filteredOrders, statusActionsInPeriod, orderHistory, agentFilter, sellerFilter, productFilter, dateRange, dateField]);

  // Confirmed count for display — now just the confirmed subset of filteredOrders,
  // the same population Status Distribution and `stats` above use, so all three
  // agree instead of each computing their own separate definition.
  const confirmedForDisplay = useMemo(() => {
    const confirmed = filteredOrders.filter(o => o.confirmation_status === "confirmed");
    return {
      total:      confirmed.length,
      byWhatsApp: confirmed.filter(o => (o as any).confirmation_channel === "whatsapp").length,
    };
  }, [filteredOrders]);

  // Time-based KPIs: First Call Avg & Handling Time. When filtered to one
  // agent, both must measure THAT agent's own speed — not whoever happened to
  // claim/respond to the order first across its whole history, which is
  // usually a DIFFERENT agent after reassignments (reported: an agent's own
  // page showed a "Handling Time" built from a different agent's
  // claim-to-response speed on orders they'd only inherited). With no agent
  // filter, keep the original "first claim by anyone -> first response by
  // anyone" team-wide latency, unchanged.
  const timeStats = useMemo(() => {
    const targetAgent = agentFilter !== "all" ? agentFilter : null;

    const orderCreatedMap: Record<string, string> = {};
    const filteredOrderIds = new Set<string>();
    filteredOrders.forEach(o => {
      orderCreatedMap[o.order_id] = o.created_at;
      filteredOrderIds.add(o.order_id);
    });

    // First Call Avg: created_at -> first confirmation_status change away
    // from "new" — by the target agent specifically when one is filtered,
    // by anyone otherwise.
    const firstStatusChangeMap: Record<string, string> = {};
    orderHistory.forEach(h => {
      if (h.field_changed !== "confirmation_status" || h.old_value !== "new") return;
      if (targetAgent && h.changed_by !== targetAgent) return;
      if (!firstStatusChangeMap[h.order_id]) firstStatusChangeMap[h.order_id] = h.created_at;
    });
    let firstCallTotalMs = 0;
    let firstCallCount = 0;
    for (const [orderId, changeTime] of Object.entries(firstStatusChangeMap)) {
      if (!filteredOrderIds.has(orderId) || !orderCreatedMap[orderId]) continue;
      const diff = new Date(changeTime).getTime() - new Date(orderCreatedMap[orderId]).getTime();
      if (diff > 0) { firstCallTotalMs += diff; firstCallCount++; }
    }

    // Handling Time: agent_id claim -> next confirmation_status change.
    let handlingTotalMs = 0;
    let handlingCount = 0;
    if (targetAgent) {
      // Every claim by THIS agent (an order can be claimed/reattempted by
      // several agents over its life; each is its own interval) -> the next
      // confirmation_status change made by that SAME agent.
      const statusEventsByOrder: Record<string, Array<{ at: string; changedBy: string }>> = {};
      orderHistory.forEach(h => {
        if (h.field_changed !== "confirmation_status") return;
        (statusEventsByOrder[h.order_id] ||= []).push({ at: h.created_at, changedBy: h.changed_by || "" });
      });
      orderHistory.forEach(h => {
        if (h.field_changed !== "agent_lock" || h.old_value || h.new_value !== targetAgent) return;
        if (!filteredOrderIds.has(h.order_id)) return;
        const claimTime = new Date(h.created_at).getTime();
        const events = statusEventsByOrder[h.order_id] || [];
        const next = events.find(e => e.changedBy === targetAgent && new Date(e.at).getTime() >= claimTime);
        if (!next) return;
        const diff = new Date(next.at).getTime() - claimTime;
        if (diff > 0) { handlingTotalMs += diff; handlingCount++; }
      });
    } else {
      const agentClaimMap: Record<string, string> = {};
      const firstChangeAfterClaimMap: Record<string, string> = {};
      orderHistory.forEach(h => {
        if (h.field_changed === "agent_lock" && !h.old_value && h.new_value && !agentClaimMap[h.order_id]) {
          agentClaimMap[h.order_id] = h.created_at;
        }
      });
      orderHistory.forEach(h => {
        if (h.field_changed === "confirmation_status" && agentClaimMap[h.order_id] && !firstChangeAfterClaimMap[h.order_id]) {
          const claimTime = new Date(agentClaimMap[h.order_id]).getTime();
          const changeTime = new Date(h.created_at).getTime();
          if (changeTime >= claimTime) firstChangeAfterClaimMap[h.order_id] = h.created_at;
        }
      });
      for (const [orderId, changeTime] of Object.entries(firstChangeAfterClaimMap)) {
        if (!filteredOrderIds.has(orderId) || !agentClaimMap[orderId]) continue;
        const diff = new Date(changeTime).getTime() - new Date(agentClaimMap[orderId]).getTime();
        if (diff > 0) { handlingTotalMs += diff; handlingCount++; }
      }
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
  }, [orderHistory, filteredOrders, agentFilter]);

  // order_id -> agent who actually pressed confirm, taken from order_history's
  // LATEST confirmation_status->confirmed event (orderHistory is fetched
  // ascending, so a later forEach write for the same order_id overwrites an
  // earlier one). This is the same attribution get_agent_rankings() uses in the
  // DB — without it, an order agent A marks no_answer/postponed and agent B
  // later confirms still shows confirmation_status="confirmed" against agent A
  // too (if A still owns it via agent_id/original_agent_id), wrongly inflating
  // A's confirmed count. Reported: a confirmation agent's own dashboard
  // "Confirmed" count disagreed with "Your Ranking" for exactly this reason.
  // hasConfirmHistory tracks orders with a confirm event but no changed_by on
  // record — those should count for nobody rather than fall back to whoever
  // currently owns the order (only orders with NO confirm history at all, e.g.
  // legacy data predating order_history, fall back to agent_id/original_agent_id).
  const confirmedByAgentMap = useMemo(() => {
    const confirmedByAgent: Record<string, string> = {};
    const hasConfirmHistory: Record<string, boolean> = {};
    orderHistory.forEach(h => {
      if (h.field_changed === "confirmation_status" && h.new_value === "confirmed") {
        hasConfirmHistory[h.order_id] = true;
        if (h.changed_by) confirmedByAgent[h.order_id] = h.changed_by;
      }
    });
    return { confirmedByAgent, hasConfirmHistory };
  }, [orderHistory]);

  // Agent scores — use original_agent_id as fallback for attribution
  const agentScores = useMemo(() => {
    const { confirmedByAgent, hasConfirmHistory } = confirmedByAgentMap;

    const map: Record<string, { total: number; answered: number; confirmed: number; shipped: number; delivered: number }> = {};
    const ensure = (id: string) => {
      if (!map[id]) map[id] = { total: 0, answered: 0, confirmed: 0, shipped: 0, delivered: 0 };
      return map[id];
    };

    filteredOrders.forEach(o => {
      // _actedBy (who actually made this period's last action, set by
      // filteredOrders above) takes priority over ownership fallback — see
      // the comment there for why.
      const agentId = (o as any)._actedBy || o.agent_id || o.original_agent_id;
      if (!agentId || o.confirmation_status === "new") return;
      ensure(agentId).total++;
      if (["confirmed", "cancelled", "wrong_number", "reported"].includes(o.confirmation_status)) ensure(agentId).answered++;
    });

    // Credit "confirmed" to whoever actually pressed confirm, not whoever
    // currently/originally owns the order — see confirmedByAgentMap above.
    filteredOrders.forEach(o => {
      if (o.confirmation_status !== "confirmed") return;
      const agentId = o.agent_id || o.original_agent_id;
      if (!agentId) return;
      const confirmingAgent = confirmedByAgent[o.order_id] || (hasConfirmHistory[o.order_id] ? null : agentId);
      if (confirmingAgent) ensure(confirmingAgent).confirmed++;
    });

    // Count shipped-pool and delivered orders per confirming agent. Falls back
    // to _actedBy (not raw ownership) so this stays keyed the same way as the
    // total/answered loop above and DailyConfirmationReport's agentRows —
    // otherwise a reassigned order's delivery credit could land on a row that
    // no longer exists in either of those (e.g. the original owner, who has
    // zero other activity this period and so isn't a row at all).
    filteredOrders.forEach(o => {
      const agentId = (o as any)._actedBy || o.agent_id || o.original_agent_id;
      const confirmingAgent = confirmedByAgent[o.order_id] || agentId;
      if (confirmingAgent && map[confirmingAgent]) {
        if (isInShippedDeliveryPool(o.delivery_status)) map[confirmingAgent].shipped++;
        if (isDeliveredStatus(o.delivery_status)) map[confirmingAgent].delivered++;
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
        deliveryRate: deliveryRatePercent(d.delivered, d.shipped),
      }))
      .sort((a, b) => b.confirmationRate - a.confirmationRate);
  }, [filteredOrders, confirmedByAgentMap, profileNameMap]);

  // No Answer attempts breakdown — respects the date filter like every other
  // section (dateField="created": order's created_at; "updated": its last
  // call attempt, falling back to updated_at), plus seller/product.
  const noAnswerAttempts = useMemo(() => {
    const from = dateRange?.from ? startOfDay(dateRange.from) : null;
    const to = dateRange?.from ? endOfDay(dateRange.to ?? dateRange.from) : null;
    const inRange = (d: Date) => !from || !to || (d >= from && d <= to);
    const relevantDate = (o: typeof orders[number]) =>
      new Date(dateField === "created" ? o.created_at : (o.last_attempt_at || o.updated_at));

    const noAnswerOrders = orders.filter(o => {
      if (o.confirmation_status !== "no_answer") return false;
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (!inRange(relevantDate(o))) return false;
      return true;
    });
    const buckets: Record<number, number> = {};
    noAnswerOrders.forEach(o => {
      const n = Math.max(1, o.attempt_count ?? 1);
      buckets[n] = (buckets[n] || 0) + 1;
    });
    const total = noAnswerOrders.length;
    // Unreachable = orders that exhausted all call attempts (terminal state of no_answer).
    const unreachable = orders.filter(o => {
      if (o.confirmation_status !== "unreachable") return false;
      if (sellerFilter !== "all" && o.seller_id !== sellerFilter) return false;
      if (productFilter !== "all" && o.product_name !== productFilter) return false;
      if (!inRange(relevantDate(o))) return false;
      return true;
    }).length;
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
    return { rows, total, unreachable };
  }, [orders, sellerFilter, productFilter, dateRange, dateField]);

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

  // Confirmation rate by product — same formula as dashboard/summary:
  // confirmed / (all leads - new pending leads).
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
        rate: confirmationRatePercent(d.confirmed, d.leads, d.pending),
        total: d.leads,
      }))
      .sort((a, b) => b.rate - a.rate);
  }, [filteredOrders]);

  // Delivery rate by product — delivered / shipped pool.
  const deliveryByProduct = useMemo(() => {
    const map: Record<string, { confirmed: number; shipped: number; delivered: number; returned: number; inTransit: number }> = {};
    filteredOrders.forEach(o => {
      const name = o.product_name || "Unknown";
      if (!map[name]) map[name] = { confirmed: 0, shipped: 0, delivered: 0, returned: 0, inTransit: 0 };
      if (o.confirmation_status === "confirmed") map[name].confirmed++;
      const ds = o.delivery_status;
      if (isInShippedDeliveryPool(ds)) map[name].shipped++;
      if (isDeliveredStatus(ds)) map[name].delivered++;
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
        rate: deliveryRatePercent(d.delivered, d.shipped),
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
    <div className="space-y-6 w-full max-w-none">
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
        {!isGeneralManager && (
        <SearchableSelect
          value={sellerFilter}
          onValueChange={(v) => { setSellerFilter(v); setProductFilter("all"); }}
          options={sellerOptions}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[160px]"
        />
        )}
        <SearchableSelect
          value={productFilter}
          onValueChange={setProductFilter}
          options={productOptions}
          placeholder="Product"
          allLabel="All Products"
          className="w-[160px]"
        />
        {/* Date field toggle: Created / Updated */}
        <div className="flex items-center gap-0 rounded-lg border overflow-hidden h-9">
          {(["created", "updated"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setDateField(f)}
              className={cn(
                "px-3 h-full text-xs font-medium transition-colors",
                dateField === f
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {f === "created" ? "Created" : "Updated"}
            </button>
          ))}
        </div>

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
        orders={filteredOrders.map(o => {
          return {
            order_id: o.order_id,
            agent_id: o.agent_id,
            original_agent_id: o.original_agent_id,
            confirmation_status: o.confirmation_status,
            confirmation_channel: (o as any).confirmation_channel ?? null,
            postpone_date: o.postpone_date,
            actedBy: (o as any)._actedBy ?? null,
          };
        })}
        profileNameMap={profileNameMap}
        profilePhoneMap={profilePhoneMap}
        agentIds={agentIds}
        totalConfirmed={confirmedForDisplay.total}
        totalByWhatsApp={confirmedForDisplay.byWhatsApp}
        confirmationRate={stats.confirmationRate}
        treatedOrders={stats.treated}
        claimedOrders={stats.claimed}
        firstCallAvg={timeStats.firstCallAvg}
        handlingTime={timeStats.handlingTime}
        confirmedByAgentMap={confirmedByAgentMap}
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
          actedBy: (o as any)._actedBy ?? null,
        })).filter(o => o.actedBy || o.agent_id !== '' || o.original_agent_id !== null)}
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
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground tabular-nums">
              {noAnswerAttempts.unreachable} unreachable
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">{noAnswerAttempts.total} orders</span>
          </div>
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
