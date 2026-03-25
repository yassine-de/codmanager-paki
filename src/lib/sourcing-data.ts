export type SourcingStatus = 'pending' | 'ordered' | 'shipped' | 'received' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid';

export interface SourcingRequest {
  id: string;
  seller: string;
  productName: string;
  productImage: string;
  sourceLink: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  status: SourcingStatus;
  paymentStatus: PaymentStatus;
  paidAmount: number;
  createdAt: string;
  updatedAt: string;
  expectedDelivery?: string;
  notes?: string;
}

const productImages = [
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=80&h=80&fit=crop',
];

const productNames = [
  'Wireless Earbuds Pro', 'LED Strip Lights 10m', 'Phone Holder Car Mount',
  'Portable Blender USB', 'Smart Watch Band', 'Ring Light 26cm',
  'Magnetic Charging Cable', 'Mini Projector HD', 'Electric Toothbrush Set',
  'Silicone Kitchen Utensils', 'Car Vacuum Cleaner', 'Fitness Resistance Bands',
];

const sellers = ['Amine Shop', 'Nora Beauty', 'Atlas Store', 'Maroc Deals', 'Sahara Goods'];

const sourceLinks = [
  'https://www.alibaba.com/product/1234',
  'https://www.alibaba.com/product/5678',
  'https://www.alibaba.com/product/9012',
  'https://www.aliexpress.com/item/3456',
  'https://www.aliexpress.com/item/7890',
];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateSourcingRequest(i: number): SourcingRequest {
  const statuses: SourcingStatus[] = ['pending', 'pending', 'ordered', 'ordered', 'shipped', 'shipped', 'received', 'received', 'received', 'cancelled'];
  const status = rand(statuses);
  const daysAgo = randInt(0, 45);
  const createdAt = new Date(Date.now() - daysAgo * 86400000).toISOString();
  const updatedAt = new Date(Date.now() - randInt(0, daysAgo) * 86400000).toISOString();
  const quantity = randInt(10, 500);
  const unitPrice = randInt(5, 150);
  const totalPrice = quantity * unitPrice;

  const paymentStatus: PaymentStatus = status === 'received' ? 'paid'
    : status === 'shipped' ? rand(['paid', 'partially_paid'] as const)
    : status === 'ordered' ? rand(['unpaid', 'partially_paid', 'paid'] as const)
    : 'unpaid';

  const paidAmount = paymentStatus === 'paid' ? totalPrice
    : paymentStatus === 'partially_paid' ? Math.round(totalPrice * (randInt(30, 70) / 100))
    : 0;

  return {
    id: `SRC-${String(100 + i).padStart(4, '0')}`,
    seller: rand(sellers),
    productName: rand(productNames),
    productImage: rand(productImages),
    sourceLink: rand(sourceLinks),
    quantity,
    unitPrice,
    totalPrice,
    status,
    paymentStatus,
    paidAmount,
    createdAt,
    updatedAt,
    expectedDelivery: ['ordered', 'shipped'].includes(status) ? new Date(Date.now() + randInt(5, 30) * 86400000).toISOString() : undefined,
    notes: Math.random() > 0.7 ? rand(['Check quality on arrival', 'Urgent order', 'Seller confirmed specs', 'Waiting for sample first']) : undefined,
  };
}

export const mockSourcingRequests: SourcingRequest[] = Array.from({ length: 35 }, (_, i) => generateSourcingRequest(i));

export const sourcingStatusConfig: Record<SourcingStatus, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'bg-warning/15 text-warning border-warning/25' },
  ordered: { label: 'Ordered', color: 'bg-info/15 text-info border-info/25' },
  shipped: { label: 'Shipped', color: 'bg-primary/15 text-primary border-primary/25' },
  received: { label: 'Received', color: 'bg-success/15 text-success border-success/25' },
  cancelled: { label: 'Cancelled', color: 'bg-destructive/15 text-destructive border-destructive/25' },
};

export const paymentStatusConfig: Record<PaymentStatus, { label: string; color: string }> = {
  unpaid: { label: 'Unpaid', color: 'bg-destructive/15 text-destructive border-destructive/25' },
  partially_paid: { label: 'Partial', color: 'bg-warning/15 text-warning border-warning/25' },
  paid: { label: 'Paid', color: 'bg-success/15 text-success border-success/25' },
};
