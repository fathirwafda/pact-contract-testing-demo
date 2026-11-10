import axios, { type AxiosInstance, isAxiosError } from 'axios';

/**
 * The mobile app's client for the order service. The mobile team needs a smaller slice of the API
 * than the web storefront (no descriptions or images in the list view), but it relies on `stock`
 * for its "Sold out" badge, which the web storefront never reads.
 */

interface ProductListResponse {
  items: { id: string; name: string; priceCents: number; stock: number }[];
}

interface OrderResponse {
  id: string;
  status: string;
  totalCents: number;
}

export interface ProductTile {
  id: string;
  title: string;
  priceCents: number;
  soldOut: boolean;
}

export interface OrderTracking {
  orderId: string;
  status: string;
  totalCents: number;
}

export class MobileApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Order service responded ${status} ${code}`);
    this.name = 'MobileApiError';
  }
}

export class MobileOrderServiceClient {
  private readonly http: AxiosInstance;

  constructor(baseURL: string, token?: string) {
    this.http = axios.create({
      baseURL,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  }

  async productTiles(category: string): Promise<ProductTile[]> {
    const { data } = await this.call(() =>
      this.http.get<ProductListResponse>('/products', { params: { category } }),
    );
    return data.items.map((item) => ({
      id: item.id,
      title: item.name,
      priceCents: item.priceCents,
      soldOut: item.stock <= 0,
    }));
  }

  async trackOrder(orderId: string): Promise<OrderTracking> {
    const { data } = await this.call(() =>
      this.http.get<OrderResponse>(`/orders/${encodeURIComponent(orderId)}`),
    );
    return { orderId: data.id, status: data.status, totalCents: data.totalCents };
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (isAxiosError<{ error?: string }>(error) && error.response) {
        throw new MobileApiError(error.response.status, error.response.data?.error ?? 'UNKNOWN');
      }
      throw error;
    }
  }
}
