export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled' | 'returned' | 'postponed' | 'no_answer' | 'double' | 'wrong_number' | 'in_transit' | 'with_courier';

export type ConfirmationStatus = 'new' | 'confirmed' | 'no_answer' | 'postponed' | 'cancelled' | 'wrong_number' | 'double';
export type DeliveryStatus = 'pending' | 'shipped' | 'in_transit' | 'with_courier' | 'delivered' | 'returned' | 'cancelled' | 'no_answer' | 'postponed';

export interface OrderHistoryEvent {
  id: string;
  timestamp: string;
  type: 'created' | 'status_change' | 'confirmation' | 'delivery_update' | 'quantity_change' | 'price_change' | 'note' | 'assigned' | 'call_attempt';
  description: string;
  agent?: string;
  oldValue?: string;
  newValue?: string;
}

export interface Order {
  id: string;
  systemId?: number;
  customer: string;
  phone: string;
  city: string;
  address: string;
  products: { name: string; qty: number; price: number }[];
  total: number;
  paidAmount: number;
  status: OrderStatus;
  confirmationStatus: ConfirmationStatus;
  deliveryStatus: DeliveryStatus;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  shippedAt?: string;
  deliveredAt?: string;
  notes?: string;
  seller: string;
  upsell: boolean;
  warehouseState: 'in_stock' | 'out_of_stock' | 'reserved';
  history: OrderHistoryEvent[];
  attemptCount?: number;
}

const cities = ['Casablanca', 'Rabat', 'Marrakech', 'Fes', 'Tangier', 'Agadir', 'Oujda', 'Kenitra', 'Tetouan', 'Meknes'];
const firstNames = ['Youssef', 'Fatima', 'Ahmed', 'Amina', 'Omar', 'Khadija', 'Hassan', 'Salma', 'Khalid', 'Nadia', 'Rachid', 'Zineb'];
const lastNames = ['El Amrani', 'Benali', 'Tahiri', 'Fassi', 'Idrissi', 'Berrada', 'Kettani', 'Alaoui', 'Chraibi', 'Benjelloun'];
export const productNames = ['Argan Oil Set', 'Leather Bag', 'Ceramic Tagine', 'Berber Rug', 'Babouche Slippers', 'Saffron Pack', 'Silver Bracelet', 'Lantern Lamp', 'Embroidered Cushion', 'Tea Set'];
export const sellerNames = ['Amine Shop', 'Nora Beauty', 'Atlas Store', 'Maroc Deals', 'Sahara Goods'];

const agentNames = ['Karim B.', 'Sara M.', 'Youssef H.', 'Nadia K.', 'Omar T.'];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateHistory(status: OrderStatus, createdAt: string, daysAgo: number, orderId: string, products: { name: string; qty: number; price: number }[]): OrderHistoryEvent[] {
  const events: OrderHistoryEvent[] = [];
  let eid = 0;
  const ts = (offset: number, hours = 0) => new Date(new Date(createdAt).getTime() + offset * 86400000 + hours * 3600000).toISOString();

  // Order created
  events.push({ id: `${orderId}-h${eid++}`, timestamp: createdAt, type: 'created', description: 'Order created', agent: rand(agentNames) });

  // Assigned to agent
  if (Math.random() > 0.3) {
    const assignedAgent = rand(agentNames);
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(0, 1), type: 'assigned', description: `Assigned to ${assignedAgent}`, agent: rand(agentNames) });
  }

  // Call attempts for no_answer
  if (['no_answer', 'postponed'].includes(status)) {
    const attempts = randInt(1, 3);
    for (let c = 0; c < attempts; c++) {
      events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(c, 2 + c * 3), type: 'call_attempt', description: `Call attempt #${c + 1} — No answer`, agent: rand(agentNames) });
    }
  }

  // Confirmation
  if (['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier', 'returned'].includes(status)) {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(1, 2), type: 'confirmation', description: 'Order confirmed by agent', agent: rand(agentNames), oldValue: 'New', newValue: 'Confirmed' });
  }
  if (status === 'cancelled') {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(1, 2), type: 'status_change', description: 'Order cancelled by client', agent: rand(agentNames), oldValue: 'New', newValue: 'Cancelled' });
  }
  if (status === 'wrong_number') {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(0, 3), type: 'status_change', description: 'Marked as wrong number', agent: rand(agentNames), oldValue: 'New', newValue: 'Wrong Number' });
  }
  if (status === 'double') {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(0, 2), type: 'status_change', description: 'Flagged as duplicate order', agent: rand(agentNames), oldValue: 'New', newValue: 'Double' });
  }

  // Quantity or price change (random)
  if (Math.random() > 0.6 && products.length > 0) {
    const p = products[0];
    const oldQty = p.qty + randInt(1, 2);
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(1, 4), type: 'quantity_change', description: `Quantity updated for ${p.name}`, agent: rand(agentNames), oldValue: `${oldQty}`, newValue: `${p.qty}` });
  }
  if (Math.random() > 0.7 && products.length > 0) {
    const p = products[0];
    const oldPrice = p.price + randInt(20, 100);
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(1, 5), type: 'price_change', description: `Price adjusted for ${p.name}`, agent: rand(agentNames), oldValue: `${oldPrice} MAD`, newValue: `${p.price} MAD` });
  }

  // Shipping & delivery
  if (['shipped', 'in_transit', 'with_courier', 'delivered', 'returned'].includes(status)) {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(2, 0), type: 'delivery_update', description: 'Order shipped to courier', agent: rand(agentNames), oldValue: 'Pending', newValue: 'Shipped' });
  }
  if (['in_transit', 'with_courier', 'delivered'].includes(status)) {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(3, 0), type: 'delivery_update', description: 'Package in transit', oldValue: 'Shipped', newValue: 'In Transit' });
  }
  if (['with_courier', 'delivered'].includes(status)) {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(3, 6), type: 'delivery_update', description: 'Package with courier for delivery', oldValue: 'In Transit', newValue: 'With Courier' });
  }
  if (status === 'delivered') {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(4, 2), type: 'delivery_update', description: 'Order delivered successfully', oldValue: 'With Courier', newValue: 'Delivered' });
  }
  if (status === 'returned') {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(4, 0), type: 'delivery_update', description: 'Order returned by client', oldValue: 'Shipped', newValue: 'Returned' });
  }

  // Notes
  if (Math.random() > 0.6) {
    events.push({ id: `${orderId}-h${eid++}`, timestamp: ts(1, 6), type: 'note', description: rand(['Client requested morning delivery', 'Call before arriving', 'Fragile package — handle with care', 'Client wants to add another item']), agent: rand(agentNames) });
  }

  return events;
}


function generateOrder(i: number): Order {
  const statuses: OrderStatus[] = [
    'pending', 'pending', 'confirmed', 'confirmed',
    'shipped', 'shipped', 'delivered', 'delivered', 'delivered',
    'cancelled', 'returned', 'postponed', 'postponed', 'no_answer', 'no_answer',
    'double', 'wrong_number', 'in_transit', 'with_courier',
  ];
  const status = rand(statuses);
  const daysAgo = randInt(0, 30);
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const updatedAt = new Date(Date.now() - randInt(0, daysAgo) * 86400000).toISOString();
  const numProducts = randInt(1, 3);
  const products = Array.from({ length: numProducts }, () => ({
    name: rand(productNames),
    qty: randInt(1, 3),
    price: randInt(50, 800),
  }));
  const total = products.reduce((s, p) => s + p.qty * p.price, 0);
  const paidAmount = status === 'delivered' ? total : (status === 'with_courier' ? Math.round(total * 0.5) : 0);

  // Derive confirmation status from main status
  const confirmationStatuses: Record<string, ConfirmationStatus> = {
    pending: 'new', confirmed: 'confirmed', shipped: 'confirmed', delivered: 'confirmed',
    cancelled: 'cancelled', returned: 'confirmed', postponed: 'postponed',
    no_answer: 'no_answer', double: 'double', wrong_number: 'wrong_number',
    in_transit: 'confirmed', with_courier: 'confirmed',
  };
  const confirmationStatus = confirmationStatuses[status] || 'new';

  // Derive delivery status from main status
  const deliveryStatuses: Record<string, DeliveryStatus> = {
    pending: 'pending', confirmed: 'pending', shipped: 'shipped', delivered: 'delivered',
    cancelled: 'cancelled', returned: 'returned', postponed: 'postponed',
    no_answer: 'no_answer', double: 'pending', wrong_number: 'pending',
    in_transit: 'in_transit', with_courier: 'with_courier',
  };
  const deliveryStatus = deliveryStatuses[status] || 'pending';

  return {
    id: `COD-${String(1000 + i).padStart(4, '0')}`,
    customer: `${rand(firstNames)} ${rand(lastNames)}`,
    phone: `+212 6${randInt(10, 99)} ${randInt(100, 999)} ${randInt(100, 999)}`,
    city: rand(cities),
    address: `${randInt(1, 200)} ${rand(['Rue', 'Av.', 'Bd.'])} ${rand(['Mohammed V', 'Hassan II', 'Al Massira', 'Zerktouni', 'Anfa'])}`,
    products,
    total,
    paidAmount,
    status,
    confirmationStatus,
    deliveryStatus,
    createdAt,
    updatedAt,
    confirmedAt: ['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(status) ? new Date(Date.now() - (daysAgo - 1) * 86400000).toISOString() : undefined,
    shippedAt: ['shipped', 'delivered', 'in_transit', 'with_courier'].includes(status) ? new Date(Date.now() - (daysAgo - 2) * 86400000).toISOString() : undefined,
    deliveredAt: status === 'delivered' ? new Date(Date.now() - (daysAgo - 4) * 86400000).toISOString() : undefined,
    notes: Math.random() > 0.7 ? rand(['Call before delivery', 'Fragile items', 'Leave at door', 'Customer prefers morning delivery']) : undefined,
    seller: rand(sellerNames),
    upsell: Math.random() > 0.7,
    warehouseState: rand(['in_stock', 'out_of_stock', 'reserved'] as const),
    history: generateHistory(status, createdAt, daysAgo, `COD-${String(1000 + i).padStart(4, '0')}`, products),
  };
}

export const mockOrders: Order[] = Array.from({ length: 60 }, (_, i) => generateOrder(i));

export function getKPIs(orders: Order[]) {
  const total = orders.length;
  const pending = orders.filter(o => o.status === 'pending').length;
  const confirmed = orders.filter(o => ['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status)).length;
  const delivered = orders.filter(o => o.status === 'delivered').length;
  const cancelled = orders.filter(o => o.status === 'cancelled').length;
  const returned = orders.filter(o => o.status === 'returned').length;
  const shipped = orders.filter(o => ['shipped', 'in_transit', 'with_courier', 'delivered'].includes(o.status)).length;
  const postponed = orders.filter(o => o.status === 'postponed').length;
  const noAnswer = orders.filter(o => o.status === 'no_answer').length;
  const doubleOrders = orders.filter(o => o.status === 'double').length;
  const wrongNumber = orders.filter(o => o.status === 'wrong_number').length;
  const inTransit = orders.filter(o => o.status === 'in_transit').length;
  const withCourier = orders.filter(o => o.status === 'with_courier').length;

  const revenue = orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.total, 0);
  const paidAmount = orders.reduce((s, o) => s + o.paidAmount, 0);
  const pendingAmount = revenue - paidAmount;
  const confirmationRate = total > 0 ? Math.round((confirmed / total) * 100) : 0;
  const deliveryRate = shipped > 0 ? Math.round((delivered / shipped) * 100) : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const newOrders = orders.filter(o => new Date(o.createdAt) >= today).length;

  return {
    total, pending, confirmed, delivered, cancelled, returned, shipped,
    postponed, noAnswer, doubleOrders, wrongNumber, inTransit, withCourier,
    revenue, paidAmount, pendingAmount, confirmationRate, deliveryRate, newOrders,
  };
}

export function getTopProductsByDeliveryRate(orders: Order[]) {
  const productMap: Record<string, { total: number; delivered: number; confirmed: number }> = {};
  orders.forEach(o => {
    o.products.forEach(p => {
      if (!productMap[p.name]) productMap[p.name] = { total: 0, delivered: 0, confirmed: 0 };
      productMap[p.name].total += p.qty;
      if (o.status === 'delivered') productMap[p.name].delivered += p.qty;
      if (['confirmed', 'shipped', 'delivered', 'in_transit', 'with_courier'].includes(o.status)) productMap[p.name].confirmed += p.qty;
    });
  });
  return Object.entries(productMap)
    .map(([name, d]) => ({
      name,
      total: d.total,
      delivered: d.delivered,
      confirmed: d.confirmed,
      deliveryRate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0,
      confirmationRate: d.total > 0 ? Math.round((d.confirmed / d.total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

export function getTopSellersByDelivered(orders: Order[]) {
  const sellerMap: Record<string, { total: number; delivered: number }> = {};
  orders.forEach(o => {
    if (!sellerMap[o.seller]) sellerMap[o.seller] = { total: 0, delivered: 0 };
    sellerMap[o.seller].total++;
    if (o.status === 'delivered') sellerMap[o.seller].delivered++;
  });
  return Object.entries(sellerMap)
    .map(([name, d]) => ({
      name,
      total: d.total,
      delivered: d.delivered,
      deliveryRate: d.total > 0 ? Math.round((d.delivered / d.total) * 100) : 0,
    }))
    .sort((a, b) => b.delivered - a.delivered);
}

export const statusConfig: Record<OrderStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-warning/15 text-warning border-warning/25' },
  confirmed: { label: 'Confirmed', color: 'bg-info/15 text-info border-info/25' },
  shipped: { label: 'Shipped', color: 'bg-primary/15 text-primary border-primary/25' },
  delivered: { label: 'Delivered', color: 'bg-success/15 text-success border-success/25' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/15 text-destructive border-destructive/25' },
  returned: { label: 'Returned', color: 'bg-muted-foreground/15 text-muted-foreground border-muted-foreground/25' },
  postponed: { label: 'Postponed', color: 'bg-warning/15 text-warning border-warning/25' },
  no_answer: { label: 'No Answer', color: 'bg-muted-foreground/15 text-muted-foreground border-muted-foreground/25' },
  double: { label: 'Double', color: 'bg-destructive/15 text-destructive border-destructive/25' },
  wrong_number: { label: 'Wrong Number', color: 'bg-destructive/15 text-destructive border-destructive/25' },
  in_transit: { label: 'In Transit', color: 'bg-info/15 text-info border-info/25' },
  with_courier: { label: 'With Courier', color: 'bg-primary/15 text-primary border-primary/25' },
};
