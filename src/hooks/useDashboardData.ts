import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { isWithinInterval } from "date-fns";
import { formatPKT, startOfDayPKT, endOfDayPKT } from "@/lib/timezone";
import type { DateRange } from "react-day-picker";

export interface DashboardOrder {
  id: string;
  order_id: string;
  confirmation_status: string;
  delivery_status: string | null;
  total_amount: number;
  price: number;
  quantity: number;
  product_name: string;
  seller_id: string;
  created_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  last_attempt_at: string | null;
  last_activity_at: string | null;
  updated_at: string;
}

export interface DashboardKPIs {
  total: number;
  newOrders: number;
  confirmed: number;
  noAnswer: number;
  unreachable: number;
  postponed: number;
  cancelled: number;
  doubleOrders: number;
  wrongNumber: number;
  // Delivery
  pending: number;
  shipped: number;
  inTransit: number;
  withCourier: number;
  delivered: number;
  returned: number;
  paid: number;
  deliveryCancelled: number;
  deliveryNoAnswer: number;
  deliveryPostponed: number;
  // Rates
  confirmationRate: number;
  deliveryRate: number;
  // Financial
  revenue: number;
  paidAmount: number;
  pendingAmount: number;
}

const DASHBOARD_ORDER_SELECT = "id, order_id, confirmation_status, delivery_status, total_amount, price, quantity, product_name, seller_id, created_at, confirmed_at, delivered_at, last_attempt_at, last_activity_at, updated_at";
const DASHBOARD_PAGE_SIZE = 1000;

// The date basis the user chose to filter the dashboard by.
//   "created" → cohort view: every metric is filtered by orders.created_at
//               (of the orders CREATED in this range, how many confirmed / delivered…)
//   "updated" → event view: each metric is filtered by WHEN that event happened
//               (how many orders were CONFIRMED / DELIVERED in this range, no matter
//                when they were created) → confirmed_at / delivered_at, else updated_at.
export type DateBasis = "created" | "updated";

type MetricKind = "generic" | "confirmed" | "delivered";

// Returns the date used to decide whether order `o` falls in the selected range,
// given the chosen basis and which metric is being counted.
function eventDate(o: DashboardOrder, basis: DateBasis, kind: MetricKind = "generic"): Date {
  if (basis === "created") return new Date(o.created_at);
  // "updated" basis → use the real event timestamp for that metric.
  if (kind === "confirmed") return new Date(o.confirmed_at ?? o.updated_at);
  if (kind === "delivered") return new Date(o.delivered_at ?? o.updated_at);
  return new Date(o.updated_at);
}

// Generic basis date for filtering the order LIST (status breakdown, top products/sellers).
function getBasisDate(o: DashboardOrder, basis: DateBasis): Date {
  return new Date(basis === "updated" ? o.updated_at : o.created_at);
}

function isInDay(date: Date, start: Date, nextDay: Date): boolean {
  return date >= start && date < nextDay;
}

async function fetchAllDashboardOrders(): Promise<DashboardOrder[]> {
  const rows: DashboardOrder[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("orders")
      .select(DASHBOARD_ORDER_SELECT)
      .order("created_at", { ascending: false })
      .range(from, from + DASHBOARD_PAGE_SIZE - 1);

    if (error) throw error;

    const page = (data || []) as DashboardOrder[];
    rows.push(...page);
    if (page.length < DASHBOARD_PAGE_SIZE) break;
    from += DASHBOARD_PAGE_SIZE;
  }

  return rows;
}

function reachedConfirmedStage(o: DashboardOrder): boolean {
  // Strict: only count orders currently in "confirmed" status.
  // Using confirmed_at or delivery_status fallbacks inflates the count
  // and causes discrepancy with ConfirmationAnalytics page.
  return o.confirmation_status === 'confirmed';
}

function getConfirmationEventDate(o: DashboardOrder): Date | null {
  return o.confirmed_at ? new Date(o.confirmed_at) : null;
}

function computeKPIs(orders: DashboardOrder[], allOrders?: DashboardOrder[], dateRange?: { from: Date; to: Date }, basis: DateBasis = "created"): DashboardKPIs {
  // If a date range is provided, every metric is filtered by the SAME chosen date
  // basis (created_at or updated_at) so the numbers are internally consistent and
  // match what the user selected. Otherwise fall back to the pre-filtered orders list.
  const source = allOrders && dateRange ? allOrders : orders;
  const inRange = (d: Date) => !dateRange || (d >= dateRange.from && d <= dateRange.to);
  // Per-metric range test: under "created" basis every metric uses created_at
  // (cohort view); under "updated" basis each metric uses its own event date
  // (confirmed_at for confirmed, delivered_at for delivered, updated_at otherwise).
  const inRangeFor = (o: DashboardOrder, kind: MetricKind) => inRange(eventDate(o, basis, kind));

  // Total Orders = orders whose chosen date falls in this period
  const total = dateRange
    ? source.filter(o => inRangeFor(o, "generic")).length
    : orders.length;

  // Confirmation status counts — use treatment-filtered orders for status breakdown
  const newOrders = orders.filter(o => o.confirmation_status === 'new').length;
  // Confirmed = orders currently confirmed whose chosen date falls in this period.
  //   created → confirmed orders CREATED in range; updated → confirmed in range (confirmed_at)
  const confirmed = dateRange
    ? source.filter(o => reachedConfirmedStage(o) && inRangeFor(o, "confirmed")).length
    : orders.filter(reachedConfirmedStage).length;
  const noAnswer = orders.filter(o => o.confirmation_status === 'no_answer').length;
  const unreachable = orders.filter(o => o.confirmation_status === 'unreachable').length;
  const postponed = orders.filter(o => o.confirmation_status === 'postponed').length;
  const cancelled = orders.filter(o => o.confirmation_status === 'cancelled').length;
  const doubleOrders = orders.filter(o => o.confirmation_status === 'double').length;
  const wrongNumber = orders.filter(o => o.confirmation_status === 'wrong_number').length;

  // Delivery status counts (matching real DB values)
  // Pending = explicit 'pending' OR legacy in-flight statuses
  const pending = orders.filter(o => ['pending', 'with_courier', 'in_transit', 'postponed'].includes(o.delivery_status || '')).length;
  const shipped = orders.filter(o => ['shipped', 'booked'].includes(o.delivery_status || '')).length;
  const inTransit = orders.filter(o => o.delivery_status === 'in_transit').length;
  const withCourier = orders.filter(o => o.delivery_status === 'with_courier').length;
  // Delivered = orders currently delivered/paid whose chosen date falls in this period
  const delivered = dateRange
    ? source.filter(o => reachedDeliveredStage(o) && inRangeFor(o, "delivered")).length
    : orders.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid').length;
  const paid = orders.filter(o => o.delivery_status === 'paid').length;
  // Returned = 'return' (current) OR 'returned' (legacy) OR 'ready_for_return'
  const returned = orders.filter(o => ['return', 'returned', 'ready_for_return'].includes(o.delivery_status || '')).length;
  const deliveryCancelled = orders.filter(o => o.delivery_status === 'cancelled').length;
  // Failed Attempt = 'failed_attempt' (current) OR 'no_answer' (legacy)
  const deliveryNoAnswer = orders.filter(o => ['failed_attempt', 'no_answer'].includes(o.delivery_status || '')).length;
  const deliveryPostponed = orders.filter(o => o.delivery_status === 'postponed').length;

  // Rates
  const confirmableTotal = total - newOrders - doubleOrders;
  const confirmationRate = confirmableTotal > 0 ? Math.round((confirmed / confirmableTotal) * 100) : 0;
  const deliveryRate = confirmed > 0 ? Math.round((delivered / confirmed) * 100) : 0;

  // Financial — use delivered_at event date when filtering
  // Revenue (Delivered Amount) = total of orders delivered/paid in this period
  const revenue = dateRange
    ? source
        .filter(o => reachedDeliveredStage(o) && inRangeFor(o, "delivered"))
        .reduce((s, o) => s + Number(o.total_amount), 0)
    : orders
        .filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid')
        .reduce((s, o) => s + Number(o.total_amount), 0);
  // Paid Amount = total of orders with delivery_status 'paid' whose chosen date is in this period
  const paidAmount = dateRange
    ? source
        .filter(o => o.delivery_status === 'paid' && inRangeFor(o, "delivered"))
        .reduce((s, o) => s + Number(o.total_amount), 0)
    : orders
        .filter(o => o.delivery_status === 'paid')
        .reduce((s, o) => s + Number(o.total_amount), 0);
  // Pending Amount = delivered (not yet paid) whose chosen date is in this period
  const pendingAmount = dateRange
    ? source
        .filter(o => o.delivery_status === 'delivered' && inRangeFor(o, "delivered"))
        .reduce((s, o) => s + Number(o.total_amount), 0)
    : orders
        .filter(o => o.delivery_status === 'delivered')
        .reduce((s, o) => s + Number(o.total_amount), 0);

  return {
    total, newOrders, confirmed, noAnswer, unreachable, postponed, cancelled, doubleOrders, wrongNumber,
    pending, shipped, inTransit, withCourier, delivered, paid, returned,
    deliveryCancelled, deliveryNoAnswer, deliveryPostponed,
    confirmationRate, deliveryRate,
    revenue, paidAmount, pendingAmount,
  };
}

// Treatment date = when an action was last taken on the order.
// For confirmed orders we ALWAYS use confirmed_at (when the confirmation actually
// happened — by WhatsApp, agent, or admin). This guarantees the Confirmed chart
// counts every order that became confirmed on a given day, regardless of channel.
function getTreatmentDate(o: DashboardOrder): Date {
  if (reachedConfirmedStage(o)) {
    // Prefer confirmed_at; if missing (legacy rows), fall back to updated_at
    // which is set on the same UPDATE that flipped the status.
    return getConfirmationEventDate(o);
  }
  if (o.last_attempt_at) return new Date(o.last_attempt_at);
  if (o.last_activity_at) return new Date(o.last_activity_at);
  return new Date(o.updated_at);
}

// Event date helpers — each metric uses its own actual event timestamp so
// charts reflect WHEN the event happened, not when the order was treated.
function getDeliveredEventDate(o: DashboardOrder): Date | null {
  return o.delivered_at ? new Date(o.delivered_at) : null;
}

function reachedDeliveredStage(o: DashboardOrder): boolean {
  return o.delivery_status === 'delivered' || o.delivery_status === 'paid';
}

const SHIPPED_DELIVERY_STATUSES = ['shipped', 'booked', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'];

function computeDailyData(orders: DashboardOrder[], numDays: number) {
  // Use startOfDayPKT(now) as the true UTC timestamp for midnight PKT today.
  // PKT = UTC+5, no DST → exactly 86 400 000 ms per calendar day.
  // We avoid eachDayOfIntervalPKT / toPKT here because those return "zoned"
  // Date objects whose internal UTC value is shifted for display purposes;
  // comparing them directly against real UTC timestamps (o.created_at etc.)
  // would give wrong results.
  const todayStart = startOfDayPKT(new Date()); // real UTC ≡ midnight PKT today
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  const buckets = Array.from({ length: numDays }, (_, i) => {
    const daysBack = numDays - 1 - i;
    const start   = new Date(todayStart.getTime() - daysBack * MS_PER_DAY);
    const nextDay = new Date(start.getTime() + MS_PER_DAY);
    return { start, nextDay };
  });

  return buckets.map(({ start, nextDay }) => {
    // Dropped = orders CREATED on this day (created_at)
    const dropped = orders.filter((o) =>
      isInDay(new Date(o.created_at), start, nextDay)
    ).length;

    // Confirmed = orders whose confirmation EVENT happened on this day (confirmed_at only — no updated_at fallback)
    const confirmed = orders.filter((o) => {
      if (!reachedConfirmedStage(o)) return false;
      const d = getConfirmationEventDate(o);
      return d != null && isInDay(d, start, nextDay);
    }).length;

    // Delivered = orders that were actually DELIVERED on this day (delivered_at only — no updated_at fallback)
    const delivered = orders.filter((o) => {
      if (!reachedDeliveredStage(o)) return false;
      const d = getDeliveredEventDate(o);
      return d != null && isInDay(d, start, nextDay);
    }).length;

    // Shipped = orders currently in/past shipping pipeline (uses treatment date for trend visualisation)
    const shipped = orders.filter((o) => {
      if (!o.delivery_status || !SHIPPED_DELIVERY_STATUSES.includes(o.delivery_status)) return false;
      return isInDay(getTreatmentDate(o), start, nextDay);
    }).length;

    return {
      day: `${formatPKT(start, "EEE")}\n${formatPKT(start, "dd/MM")}`,
      orders: dropped,
      dropped,
      confirmed,
      shipped,
      delivered,
      confirmationRate: dropped > 0 ? Math.round((confirmed / dropped) * 100) : 0,
      deliveryRate: shipped > 0 ? Math.round((delivered / shipped) * 100) : 0,
    };
  });
}

export function useDashboardData(dateRange?: DateRange, dateBasis: DateBasis = "created") {
  const { data: allOrders = [], isLoading, error } = useQuery({
    queryKey: ["dashboard-orders"],
    queryFn: fetchAllDashboardOrders,
    refetchInterval: 30_000, // refresh every 30s so chart picks up new confirmations live
    refetchOnWindowFocus: true,
  });

  // Filter by date range on the chosen basis date (created_at or updated_at)
  const orders = useMemo(() => {
    if (!dateRange?.from) return allOrders;
    const from = startOfDayPKT(dateRange.from);
    const to = dateRange.to ? endOfDayPKT(dateRange.to) : endOfDayPKT(dateRange.from);
    return allOrders.filter(o =>
      isWithinInterval(getBasisDate(o, dateBasis), { start: from, end: to }),
    );
  }, [allOrders, dateRange, dateBasis]);

  const kpis = useMemo(() => {
    if (!dateRange?.from) return computeKPIs(orders);
    const from = startOfDayPKT(dateRange.from);
    const to = dateRange.to ? endOfDayPKT(dateRange.to) : endOfDayPKT(dateRange.from);
    return computeKPIs(orders, allOrders, { from, to }, dateBasis);
  }, [orders, allOrders, dateRange, dateBasis]);
  // Daily charts: when a date range is active, bucket each day in the range by event date.
  // Otherwise fall back to last-7-days view.
  const last7 = useMemo(() => {
    if (dateRange?.from) {
      const from = startOfDayPKT(dateRange.from);
      const to   = dateRange.to ? startOfDayPKT(dateRange.to) : from;
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const numDays = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY) + 1;
      // Cap at 60 days to avoid unreadable charts
      const cappedDays = Math.min(numDays, 60);
      const startOffset = numDays > 60 ? numDays - 60 : 0;
      return Array.from({ length: cappedDays }, (_, i) => {
        const start   = new Date(from.getTime() + (startOffset + i) * MS_PER_DAY);
        const nextDay = new Date(start.getTime() + MS_PER_DAY);
        // Bucket each line by its own event date (per chosen basis) so the trend
        // matches the KPI cards: created → created_at; updated → confirmed_at / delivered_at.
        const dropped   = allOrders.filter(o => isInDay(eventDate(o, dateBasis, "generic"), start, nextDay)).length;
        const confirmed = allOrders.filter(o => {
          if (!reachedConfirmedStage(o)) return false;
          return isInDay(eventDate(o, dateBasis, "confirmed"), start, nextDay);
        }).length;
        const delivered = allOrders.filter(o => {
          if (!reachedDeliveredStage(o)) return false;
          return isInDay(eventDate(o, dateBasis, "delivered"), start, nextDay);
        }).length;
        const shipped = allOrders.filter(o => {
          if (!o.delivery_status || !SHIPPED_DELIVERY_STATUSES.includes(o.delivery_status)) return false;
          return isInDay(eventDate(o, dateBasis, "delivered"), start, nextDay);
        }).length;
        return {
          day: `${formatPKT(start, "EEE")}\n${formatPKT(start, "dd/MM")}`,
          orders: dropped, dropped, confirmed, shipped, delivered,
          confirmationRate: dropped > 0 ? Math.round((confirmed / dropped) * 100) : 0,
          deliveryRate: shipped > 0 ? Math.round((delivered / shipped) * 100) : 0,
        };
      });
    }
    return computeDailyData(allOrders, 7);
  }, [allOrders, dateRange, dateBasis]);

  const totals7 = useMemo(() => ({
    orders: last7.reduce((s, d) => s + d.orders, 0),
    dropped: last7.reduce((s, d) => s + d.dropped, 0),
    confirmed: last7.reduce((s, d) => s + d.confirmed, 0),
    delivered: last7.reduce((s, d) => s + d.delivered, 0),
  }), [last7]);

  // Top products by delivery rate — system-wide standard: delivered / confirmed
  // Confirmed = strict confirmation_status === 'confirmed' (matches ConfirmationAnalytics)
  const topProducts = useMemo(() => {
    const map: Record<string, { total: number; delivered: number; shipped: number; confirmed: number }> = {};
    orders.forEach(o => {
      if (!map[o.product_name]) map[o.product_name] = { total: 0, delivered: 0, shipped: 0, confirmed: 0 };
      map[o.product_name].total += o.quantity;
      if (['delivered', 'paid'].includes(o.delivery_status || '')) map[o.product_name].delivered += o.quantity;
      if (['shipped', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'].includes(o.delivery_status || '')) map[o.product_name].shipped += o.quantity;
      // Confirmed = strict confirmation_status === 'confirmed'
      if (reachedConfirmedStage(o)) {
        map[o.product_name].confirmed += o.quantity;
      }
    });
    return Object.entries(map)
      .map(([name, d]) => ({
        name,
        total: d.total,
        delivered: d.delivered,
        shipped: d.shipped,
        confirmed: d.confirmed,
        deliveryRate: d.confirmed > 0 ? Math.round((d.delivered / d.confirmed) * 100) : 0,
        confirmationRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
      }))
      .filter(p => p.confirmed >= 5) // require minimum sample size for meaningful rate
      .sort((a, b) => b.deliveryRate - a.deliveryRate)
      .slice(0, 5);
  }, [orders]);


  // Top sellers by delivered - need profiles for names
  const topSellers = useMemo(() => {
    const map: Record<string, { total: number; delivered: number }> = {};
    orders.forEach(o => {
      if (!map[o.seller_id]) map[o.seller_id] = { total: 0, delivered: 0 };
      map[o.seller_id].total++;
      if (o.delivery_status === 'delivered') map[o.seller_id].delivered++;
    });
    return Object.entries(map)
      .map(([sellerId, d]) => ({
        name: sellerId, // Will be replaced with profile name
        sellerId,
        total: d.total,
        delivered: d.delivered,
        deliveryRate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0,
      }))
      .sort((a, b) => b.delivered - a.delivered)
      .slice(0, 5);
  }, [orders]);

  return { orders, kpis, last7, totals7, topProducts, topSellers, isLoading, error };
}
