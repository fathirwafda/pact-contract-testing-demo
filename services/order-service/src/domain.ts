export type Currency = 'AUD';

export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  currency: Currency;
  stock: number;
  imageUrl: string;
  createdAt: string;
}

export type OrderStatus = 'PENDING' | 'PAID' | 'SHIPPED' | 'CANCELLED';

export interface OrderLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Order {
  id: string;
  customerId: string;
  status: OrderStatus;
  items: OrderLine[];
  totalCents: number;
  currency: Currency;
  createdAt: string;
}

/** A field-level problem in a request body, returned with HTTP 400. */
export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ErrorBody {
  error: 'VALIDATION_ERROR' | 'NOT_FOUND' | 'UNAUTHORIZED' | 'OUT_OF_STOCK' | 'BAD_REQUEST';
  message: string;
  details?: ValidationIssue[];
}
