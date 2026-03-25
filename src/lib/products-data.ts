export interface ProductOffer {
  id: string;
  quantity: number;
  price: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  sku: string;
  price: number;
  quantity: number;
}

export interface Product {
  id: string;
  seller: string;
  sku: string;
  name: string;
  image: string;
  price: number;
  totalQty: number;
  delivered: number;
  shipped: number;
  available: number;
  createdAt: string;
  variants: ProductVariant[];
  storeLink: string;
  videoLink: string;
  lastSellingPrice: number;
  lastPrice: number;
  offers: ProductOffer[];
}

const productImages = [
  'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1560343090-f0409e92791a?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1585386959984-a4155224a1ad?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1491553895911-0055eca6402d?w=80&h=80&fit=crop',
  'https://images.unsplash.com/photo-1546868871-af0de0ae72be?w=80&h=80&fit=crop',
];

const productNames = [
  'Argan Oil Set', 'Leather Bag', 'Ceramic Tagine', 'Berber Rug', 'Babouche Slippers',
  'Saffron Pack', 'Silver Bracelet', 'Lantern Lamp', 'Embroidered Cushion', 'Tea Set',
  'Wireless Earbuds Pro', 'LED Strip Lights 10m', 'Phone Holder Car Mount',
  'Portable Blender USB', 'Smart Watch Band', 'Ring Light 26cm',
  'Magnetic Charging Cable', 'Mini Projector HD', 'Electric Toothbrush Set',
  'Silicone Kitchen Utensils',
];

const sellers = ['Amine Shop', 'Nora Beauty', 'Atlas Store', 'Maroc Deals', 'Sahara Goods', 'Casa Electronics'];

const variantNames = [
  'Black', 'White', 'Red', 'Blue', 'Green', 'Pink', 'Gold', 'Silver',
  'Small', 'Medium', 'Large', 'XL',
  '16GB', '32GB', '64GB', '128GB',
  'EU Plug', 'US Plug', 'UK Plug',
];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateVariants(productSku: string, basePrice: number): ProductVariant[] {
  const count = Math.random() > 0.4 ? randInt(1, 4) : 0;
  const used = new Set<string>();
  const variants: ProductVariant[] = [];

  for (let j = 0; j < count; j++) {
    let vName = rand(variantNames);
    while (used.has(vName)) vName = rand(variantNames);
    used.add(vName);
    variants.push({
      id: `VAR-${productSku}-${j}`,
      name: vName,
      sku: `${productSku}-${vName.toUpperCase().replace(/\s/g, '')}`,
      price: basePrice + randInt(-20, 50),
      quantity: randInt(5, 200),
    });
  }
  return variants;
}

function generateProduct(i: number): Product {
  const totalQty = randInt(50, 1000);
  const delivered = randInt(0, Math.floor(totalQty * 0.6));
  const shipped = randInt(0, Math.floor((totalQty - delivered) * 0.5));
  const available = totalQty - delivered - shipped;
  const daysAgo = randInt(5, 120);
  const sku = `SKU-${String(randInt(10000, 99999))}`;
  const price = randInt(29, 899);

  const lastSellingPrice = price + randInt(-30, 30);
  const offerCount = Math.random() > 0.5 ? randInt(1, 3) : 0;
  const offers: ProductOffer[] = Array.from({ length: offerCount }, (_, j) => ({
    id: `OFF-${i}-${j}`,
    quantity: randInt(5, 50),
    price: price - randInt(5, 40),
  }));

  return {
    id: `PRD-${String(1000 + i).padStart(5, '0')}`,
    seller: rand(sellers),
    sku,
    name: rand(productNames),
    image: rand(productImages),
    price,
    totalQty,
    delivered,
    shipped,
    available,
    createdAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    variants: generateVariants(sku, price),
    storeLink: Math.random() > 0.3 ? `https://store.example.com/product/${sku}` : '',
    videoLink: Math.random() > 0.4 ? `https://youtube.com/watch?v=${sku}` : '',
    lastSellingPrice,
    lastPrice: lastSellingPrice + randInt(-10, 20),
    offers,
  };
}

export const mockProducts: Product[] = Array.from({ length: 42 }, (_, i) => generateProduct(i));

export const productSellers = [...new Set(mockProducts.map(p => p.seller))].sort();
