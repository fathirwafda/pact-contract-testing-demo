/**
 * The web storefront's client for the order service. These types are the web team's own view
 * of the API: they list only the fields the storefront renders, not everything the provider sends.
 */

export interface Product {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  imageUrl: string;
}

export interface OrderLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  status: string;
  items: OrderLine[];
  totalCents: number;
  currency: string;
  createdAt: string;
}

export interface NewOrderLine {
  productId: string;
  quantity: number;
}

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: FieldError[] = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class OrderServiceClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | undefined = () => undefined,
  ) {}

  async listProducts(): Promise<Product[]> {
    const body = await this.request<{ items: Product[] }>('GET', '/products');
    return body.items;
  }

  getProduct(id: string): Promise<Product> {
    return this.request<Product>('GET', `/products/${encodeURIComponent(id)}`);
  }

  placeOrder(items: NewOrderLine[]): Promise<Order> {
    return this.request<Order>('POST', '/orders', { items }, true);
  }

  getOrder(id: string): Promise<Order> {
    return this.request<Order>('GET', `/orders/${encodeURIComponent(id)}`, undefined, true);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    authenticated = false,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = authenticated ? this.getToken() : undefined;
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(new URL(path, this.baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: unknown = await response.json();

    if (!response.ok) {
      const error = json as { error?: string; message?: string; details?: FieldError[] };
      throw new ApiError(
        response.status,
        error.error ?? 'UNKNOWN',
        error.message ?? `HTTP ${response.status}`,
        error.details ?? [],
      );
    }
    return json as T;
  }
}

/** Formats integer cents for display, e.g. 2400 AUD -> "A$24.00". */
export function formatPrice(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency }).format(cents / 100);
}
