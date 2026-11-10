import type { Order, Product } from './domain.js';

/**
 * In-memory persistence. Tests and provider states reset and seed it directly,
 * which is the whole reason the provider has no database.
 */
export class Store {
  private readonly products = new Map<string, Product>();
  private readonly orders = new Map<string, Order>();
  private orderSequence = 1;

  reset(): void {
    this.products.clear();
    this.orders.clear();
    this.orderSequence = 1;
  }

  listProducts(): Product[] {
    return [...this.products.values()];
  }

  getProduct(id: string): Product | undefined {
    return this.products.get(id);
  }

  upsertProduct(product: Product): void {
    this.products.set(product.id, product);
  }

  getOrder(id: string): Order | undefined {
    return this.orders.get(id);
  }

  upsertOrder(order: Order): void {
    this.orders.set(order.id, order);
  }

  nextOrderId(): string {
    let id: string;
    do {
      id = `ord-${String(this.orderSequence++).padStart(4, '0')}`;
    } while (this.orders.has(id));
    return id;
  }
}

export const sampleProducts: readonly Product[] = [
  {
    id: 'prd-1001',
    sku: 'MUG-STONE-350',
    name: 'Stoneware Mug',
    description: 'A 350 ml hand-glazed stoneware mug.',
    category: 'kitchen',
    priceCents: 2400,
    currency: 'AUD',
    stock: 42,
    imageUrl: 'https://cdn.example.com/products/prd-1001.jpg',
    createdAt: '2026-01-15T09:30:00.000Z',
  },
  {
    id: 'prd-1002',
    sku: 'TOTE-CANVAS-L',
    name: 'Canvas Tote Bag',
    description: 'A heavy canvas tote with an inner pocket.',
    category: 'accessories',
    priceCents: 3500,
    currency: 'AUD',
    stock: 0,
    imageUrl: 'https://cdn.example.com/products/prd-1002.jpg',
    createdAt: '2026-02-03T14:00:00.000Z',
  },
];

export function seedSampleProducts(store: Store): void {
  for (const product of sampleProducts) store.upsertProduct({ ...product });
}
