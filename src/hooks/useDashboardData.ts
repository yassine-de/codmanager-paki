import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMemo } from "react";
import { format, subDays, startOfDay, endOfDay, eachDayOfInterval, isAfter, isWithinInterval } from "date-fns";
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

function computeKPIs(orders: DashboardOrder[]): DashboardKPIs {
  const total = orders.length;

  // Confirmation status counts
  const newOrders = orders.filter(o => o.confirmation_status === 'new').length;
  // Confirmed = ANY order that reached the confirmed stage in this period.
  // Once an order is confirmed it may move on to shipped/booked/in_transit/delivered/etc.
  // The confirmation event itself still happened — count it.
  const POST_CONFIRM_DELIVERY = ['booked', 'shipped', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'];
  const confirmed = orders.filter(o =>
    o.confirmation_status === 'confirmed' ||
    POST_CONFIRM_DELIVERY.includes(o.delivery_status || '')
  ).length;
  const noAnswer = orders.filter(o => o.confirmation_status === 'no_answer').length;
  const postponed = orders.filter(o => o.confirmation_status === 'postponed').length;
  const cancelled = orders.filter(o => o.confirmation_status === 'cancelled').length;
  const doubleOrders = orders.filter(o => o.confirmation_status === 'double').length;
  const wrongNumber = orders.filter(o => o.confirmation_status === 'wrong_number').length;

  // Delivery status counts
  // "Pending" = orders with delivery_status: with_courier, in_transit, postponed, no_answer
  const pending = orders.filter(o => ['with_courier', 'in_transit', 'postponed', 'no_answer'].includes(o.delivery_status || '')).length;
  const shipped = orders.filter(o => o.delivery_status === 'shipped').length;
  const inTransit = orders.filter(o => o.delivery_status === 'in_transit').length;
  const withCourier = orders.filter(o => o.delivery_status === 'with_courier').length;
  const delivered = orders.filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid').length;
  const paid = orders.filter(o => o.delivery_status === 'paid').length;
  const returned = orders.filter(o => o.delivery_status === 'returned').length;
  const deliveryCancelled = orders.filter(o => o.delivery_status === 'cancelled').length;
  const deliveryNoAnswer = orders.filter(o => o.delivery_status === 'no_answer').length;
  const deliveryPostponed = orders.filter(o => o.delivery_status === 'postponed').length;

  // Rates
  const confirmableTotal = total - newOrders - doubleOrders;
  const confirmationRate = confirmableTotal > 0 ? Math.round((confirmed / confirmableTotal) * 100) : 0;
  const deliveryRate = confirmed > 0 ? Math.round((delivered / confirmed) * 100) : 0;

  // Financial
  // Delivered Amount = total of orders with delivery_status 'delivered' OR 'paid'
  const revenue = orders
    .filter(o => o.delivery_status === 'delivered' || o.delivery_status === 'paid')
    .reduce((s, o) => s + Number(o.total_amount), 0);
  // Paid Amount = total of orders with delivery_status 'paid'
  const paidAmount = orders
    .filter(o => o.delivery_status === 'paid')
    .reduce((s, o) => s + Number(o.total_amount), 0);
  // Pending Amount = total of orders with delivery_status 'delivered' (delivered but not yet paid)
  const pendingAmount = orders
    .filter(o => o.delivery_status === 'delivered')
    .reduce((s, o) => s + Number(o.total_amount), 0);

  return {
    total, newOrders, confirmed, noAnswer, postponed, cancelled, doubleOrders, wrongNumber,
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
  if (o.confirmation_status === 'confirmed') {
    // Prefer confirmed_at; if missing (legacy rows), fall back to updated_at
    // which is set on the same UPDATE that flipped the status.
    return new Date(o.confirmed_at || o.updated_at);
  }
  if (o.last_attempt_at) return new Date(o.last_attempt_at);
  if (o.last_activity_at) return new Date(o.last_activity_at);
  return new Date(o.updated_at);
}

function computeDailyData(orders: DashboardOrder[], numDays: number) {
  const days = eachDayOfInterval({
    start: startOfDay(subDays(new Date(), numDays - 1)),
    end: startOfDay(new Date()),
  });

  return days.map((date) => {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    const dayOrders = orders.filter((o) => {
      const treatDate = getTreatmentDate(o);
      return isAfter(treatDate, date) && !isAfter(treatDate, nextDay);
    });
    // Dropped = orders created on this day (based on created_at, not treatment date)
    const dropped = orders.filter((o) => {
      const createdDate = new Date(o.created_at);
      return isAfter(createdDate, date) && !isAfter(createdDate, nextDay);
    }).length;
    const total = dayOrders.length;
    // Confirmed = any order whose confirmation event happened on this day,
    // regardless of where it moved next (booked/shipped/in_transit/delivered/...).
    const confirmed = dayOrders.filter(o =>
      o.confirmation_status === 'confirmed' ||
      ['booked', 'shipped', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'].includes(o.delivery_status || '')
    ).length;
    const delivered = dayOrders.filter(o => o.delivery_status === 'delivered').length;
    const shipped = dayOrders.filter(o => ['shipped', 'in_transit', 'with_courier', 'delivered'].includes(o.delivery_status || '')).length;
    return {
      day: `${format(date, "EEE")}\n${format(date, "dd/MM")}`,
      orders: total,
      dropped,
      confirmed,
      shipped,
      delivered,
      confirmationRate: total > 0 ? Math.round((confirmed / total) * 100) : 0,
      deliveryRate: shipped > 0 ? Math.round((delivered / shipped) * 100) : 0,
    };
  });
}

export function useDashboardData(dateRange?: DateRange) {
  const { data: allOrders = [], isLoading, error } = useQuery({
    queryKey: ["dashboard-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, total_amount, price, quantity, product_name, seller_id, created_at, confirmed_at, delivered_at, last_attempt_at, last_activity_at, updated_at");
      if (error) throw error;
      return (data || []) as DashboardOrder[];
    },
    refetchInterval: 30_000, // refresh every 30s so chart picks up new confirmations live
    refetchOnWindowFocus: true,
  });

  // Filter by date range on treatment date

  // Filter by date range on treatment date
  const orders = useMemo(() => {
    if (!dateRange?.from) return allOrders;
    const from = startOfDay(dateRange.from);
    const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(dateRange.from);
    return allOrders.filter(o => {
      const treatDate = getTreatmentDate(o);
      return isWithinInterval(treatDate, { start: from, end: to });
    });
  }, [allOrders, dateRange]);

  const kpis = useMemo(() => computeKPIs(orders), [orders]);
  const last7 = useMemo(() => computeDailyData(orders, 7), [orders]);

  const totals7 = useMemo(() => ({
    orders: last7.reduce((s, d) => s + d.orders, 0),
    dropped: last7.reduce((s, d) => s + d.dropped, 0),
    confirmed: last7.reduce((s, d) => s + d.confirmed, 0),
    delivered: last7.reduce((s, d) => s + d.delivered, 0),
  }), [last7]);

  // Top products by delivery rate — system-wide standard: delivered / confirmed
  // Confirmed includes all orders that reached confirmed stage (confirmed, shipped, in_transit, with_courier, delivered, paid, returned)
  const topProducts = useMemo(() => {
    const map: Record<string, { total: number; delivered: number; shipped: number; confirmed: number }> = {};
    orders.forEach(o => {
      if (!map[o.product_name]) map[o.product_name] = { total: 0, delivered: 0, shipped: 0, confirmed: 0 };
      map[o.product_name].total += o.quantity;
      if (['delivered', 'paid'].includes(o.delivery_status || '')) map[o.product_name].delivered += o.quantity;
      if (['shipped', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'].includes(o.delivery_status || '')) map[o.product_name].shipped += o.quantity;
      // Confirmed = any order that was confirmed (regardless of current delivery status)
      if (o.confirmation_status === 'confirmed' || ['shipped', 'in_transit', 'with_courier', 'delivered', 'paid', 'returned'].includes(o.delivery_status || '')) {
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
