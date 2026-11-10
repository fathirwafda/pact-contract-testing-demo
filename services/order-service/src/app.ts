import express, { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { BreakingChange } from './config.js';
import type { ErrorBody, Order, OrderLine, Product } from './domain.js';
import type { Store } from './store.js';

export interface AppOptions {
  store: Store;
  apiTokens: Map<string, string>;
  breakingChange?: BreakingChange;
  now?: () => Date;
}

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1, 'productId is required'),
        quantity: z
          .number()
          .int('quantity must be an integer')
          .min(1, 'quantity must be at least 1'),
      }),
    )
    .min(1, 'items must contain at least one line'),
});

function sendError(res: Response, status: number, body: ErrorBody): void {
  res.status(status).json(body);
}

/** Maps the domain object to the public JSON shape. */
export function toProductResponse(
  product: Product,
  breakingChange: BreakingChange = 'none',
): Record<string, unknown> {
  const { stock, ...rest } = product;
  // The demo regression: a "harmless" rename that one consumer depends on.
  return breakingChange === 'rename-stock'
    ? { ...rest, quantityAvailable: stock }
    : { ...rest, stock };
}

function toOrderResponse(order: Order): Omit<Order, 'customerId'> {
  const { customerId: _customerId, ...publicOrder } = order;
  return publicOrder;
}

export function createApp(options: AppOptions): express.Express {
  const { store, apiTokens, breakingChange = 'none', now = () => new Date() } = options;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  const requireAuth: RequestHandler = (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.get('authorization') ?? '');
    const customerId = match?.[1] ? apiTokens.get(match[1]) : undefined;
    if (!customerId) {
      sendError(res, 401, {
        error: 'UNAUTHORIZED',
        message: 'A valid bearer token is required',
      });
      return;
    }
    res.locals.customerId = customerId;
    next();
  };

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.get('/products', (req, res) => {
    const category = typeof req.query.category === 'string' ? req.query.category : undefined;
    const products = store
      .listProducts()
      .filter((product) => category === undefined || product.category === category)
      .map((product) => toProductResponse(product, breakingChange));
    res.json({ items: products, count: products.length });
  });

  app.get('/products/:id', (req, res) => {
    const product = store.getProduct(req.params.id);
    if (!product) {
      sendError(res, 404, {
        error: 'NOT_FOUND',
        message: `Product ${req.params.id} was not found`,
      });
      return;
    }
    res.json(toProductResponse(product, breakingChange));
  });

  app.post('/orders', requireAuth, (req, res) => {
    const parsed = createOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, {
        error: 'VALIDATION_ERROR',
        message: 'The order request is invalid',
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join('.') || 'body',
          message: issue.message,
        })),
      });
      return;
    }

    const lines: OrderLine[] = [];
    for (const [index, item] of parsed.data.items.entries()) {
      const product = store.getProduct(item.productId);
      if (!product) {
        sendError(res, 400, {
          error: 'VALIDATION_ERROR',
          message: 'The order request is invalid',
          details: [
            { field: `items.${index}.productId`, message: `Unknown product ${item.productId}` },
          ],
        });
        return;
      }
      if (product.stock < item.quantity) {
        sendError(res, 409, {
          error: 'OUT_OF_STOCK',
          message: `Only ${product.stock} of ${product.id} left in stock`,
        });
        return;
      }
      lines.push({
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPriceCents: product.priceCents,
      });
    }

    for (const line of lines) {
      const product = store.getProduct(line.productId);
      if (product) store.upsertProduct({ ...product, stock: product.stock - line.quantity });
    }

    const order: Order = {
      id: store.nextOrderId(),
      customerId: String(res.locals.customerId),
      status: 'PENDING',
      items: lines,
      totalCents: lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0),
      currency: 'AUD',
      createdAt: now().toISOString(),
    };
    store.upsertOrder(order);
    res.status(201).location(`/orders/${order.id}`).json(toOrderResponse(order));
  });

  app.get<{ id: string }>('/orders/:id', requireAuth, (req, res) => {
    const order = store.getOrder(req.params.id);
    // Another customer's order is reported as missing, so ids cannot be probed.
    if (!order || order.customerId !== res.locals.customerId) {
      sendError(res, 404, { error: 'NOT_FOUND', message: `Order ${req.params.id} was not found` });
      return;
    }
    res.json(toOrderResponse(order));
  });

  app.use((_req, res) => {
    sendError(res, 404, { error: 'NOT_FOUND', message: 'Route not found' });
  });

  const handleErrors: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof SyntaxError) {
      sendError(res, 400, { error: 'BAD_REQUEST', message: 'Request body is not valid JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Unexpected error' });
  };
  app.use(handleErrors);

  return app;
}
