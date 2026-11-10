import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, toProductResponse } from '../src/app.js';
import { parseApiTokens, parseBreakingChange } from '../src/config.js';
import { sampleProducts, seedSampleProducts, Store } from '../src/store.js';

const TOKEN = 'unit-token';
const OTHER_TOKEN = 'other-token';
const store = new Store();
let server: Server;
let baseUrl: string;

function call(method: string, path: string, options: { token?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body:
      options.body === undefined
        ? undefined
        : typeof options.body === 'string'
          ? options.body
          : JSON.stringify(options.body),
  });
}

beforeAll(async () => {
  const app = createApp({
    store,
    apiTokens: new Map([
      [TOKEN, 'cus-001'],
      [OTHER_TOKEN, 'cus-002'],
    ]),
    now: () => new Date('2026-03-01T10:15:30.000Z'),
  });
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  store.reset();
  seedSampleProducts(store);
});

describe('GET /products', () => {
  it('lists every product with a count', async () => {
    const res = await call('GET', '/products');
    const body = (await res.json()) as { items: { id: string }[]; count: number };

    expect(res.status).toBe(200);
    expect(body.count).toBe(sampleProducts.length);
    expect(body.items.map((item) => item.id)).toEqual(['prd-1001', 'prd-1002']);
  });

  it('filters by category', async () => {
    const res = await call('GET', '/products?category=kitchen');
    const body = (await res.json()) as { items: { id: string }[] };

    expect(body.items.map((item) => item.id)).toEqual(['prd-1001']);
  });
});

describe('GET /products/:id', () => {
  it('returns the product', async () => {
    const res = await call('GET', '/products/prd-1001');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'prd-1001', stock: 42, priceCents: 2400 });
  });

  it('returns 404 NOT_FOUND for an unknown id', async () => {
    const res = await call('GET', '/products/prd-9999');

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'NOT_FOUND' });
  });
});

describe('POST /orders', () => {
  it('creates an order, prices it from the catalogue and decrements stock', async () => {
    const res = await call('POST', '/orders', {
      token: TOKEN,
      body: { items: [{ productId: 'prd-1001', quantity: 2 }] },
    });

    expect(res.status).toBe(201);
    expect(res.headers.get('location')).toBe('/orders/ord-0001');
    const order = (await res.json()) as Record<string, unknown>;
    expect(order).toEqual({
      id: 'ord-0001',
      status: 'PENDING',
      items: [
        { productId: 'prd-1001', productName: 'Stoneware Mug', quantity: 2, unitPriceCents: 2400 },
      ],
      totalCents: 4800,
      currency: 'AUD',
      createdAt: '2026-03-01T10:15:30.000Z',
    });
    expect(order).not.toHaveProperty('customerId');
    expect(store.getProduct('prd-1001')?.stock).toBe(40);
  });

  it('returns 401 without a token', async () => {
    const res = await call('POST', '/orders', {
      body: { items: [{ productId: 'prd-1001', quantity: 1 }] },
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: 'UNAUTHORIZED' });
  });

  it('returns 401 for an unknown token', async () => {
    const res = await call('POST', '/orders', {
      token: 'not-a-real-token',
      body: { items: [{ productId: 'prd-1001', quantity: 1 }] },
    });

    expect(res.status).toBe(401);
  });

  it.each([
    ['an empty basket', { items: [] }, 'items'],
    ['a missing items field', {}, 'items'],
    ['a zero quantity', { items: [{ productId: 'prd-1001', quantity: 0 }] }, 'items.0.quantity'],
    [
      'a fractional quantity',
      { items: [{ productId: 'prd-1001', quantity: 1.5 }] },
      'items.0.quantity',
    ],
    ['an empty productId', { items: [{ productId: '', quantity: 1 }] }, 'items.0.productId'],
    [
      'an unknown product',
      { items: [{ productId: 'prd-9999', quantity: 1 }] },
      'items.0.productId',
    ],
  ])('returns 400 VALIDATION_ERROR for %s', async (_case, body, field) => {
    const res = await call('POST', '/orders', { token: TOKEN, body });
    const json = (await res.json()) as { error: string; details: { field: string }[] };

    expect(res.status).toBe(400);
    expect(json.error).toBe('VALIDATION_ERROR');
    expect(json.details.map((detail) => detail.field)).toContain(field);
  });

  it('returns 400 BAD_REQUEST for malformed JSON', async () => {
    const res = await call('POST', '/orders', { token: TOKEN, body: '{"items": [' });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'BAD_REQUEST' });
  });

  it('returns 409 OUT_OF_STOCK and leaves stock untouched', async () => {
    const res = await call('POST', '/orders', {
      token: TOKEN,
      body: {
        items: [
          { productId: 'prd-1001', quantity: 1 },
          { productId: 'prd-1002', quantity: 1 },
        ],
      },
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'OUT_OF_STOCK' });
    expect(store.getProduct('prd-1001')?.stock).toBe(42);
  });
});

describe('GET /orders/:id', () => {
  async function placeOrder(token: string): Promise<string> {
    const res = await call('POST', '/orders', {
      token,
      body: { items: [{ productId: 'prd-1001', quantity: 1 }] },
    });
    return ((await res.json()) as { id: string }).id;
  }

  it("returns the customer's own order", async () => {
    const id = await placeOrder(TOKEN);
    const res = await call('GET', `/orders/${id}`, { token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id, status: 'PENDING', totalCents: 2400 });
  });

  it("returns 404 for another customer's order, so ids cannot be probed", async () => {
    const id = await placeOrder(TOKEN);
    const res = await call('GET', `/orders/${id}`, { token: OTHER_TOKEN });

    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown order', async () => {
    const res = await call('GET', '/orders/ord-9999', { token: TOKEN });

    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await call('GET', '/orders/ord-0001');

    expect(res.status).toBe(401);
  });
});

describe('unknown routes', () => {
  it('return 404 JSON', async () => {
    const res = await call('GET', '/nope');

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});

describe('toProductResponse', () => {
  const product = sampleProducts[0]!;

  it('sends stock by default', () => {
    expect(toProductResponse(product)).toHaveProperty('stock', 42);
  });

  it('renames stock to quantityAvailable in the breaking-change demo', () => {
    const body = toProductResponse(product, 'rename-stock');

    expect(body).not.toHaveProperty('stock');
    expect(body).toHaveProperty('quantityAvailable', 42);
  });
});

describe('config', () => {
  it('parses token:customer pairs', () => {
    expect(parseApiTokens('a:cus-1, b:cus-2')).toEqual(
      new Map([
        ['a', 'cus-1'],
        ['b', 'cus-2'],
      ]),
    );
  });

  it('rejects a malformed token entry', () => {
    expect(() => parseApiTokens('no-customer')).toThrow(/expected token:customerId/);
  });

  it('accepts only known breaking-change flags', () => {
    expect(parseBreakingChange(undefined)).toBe('none');
    expect(parseBreakingChange('rename-stock')).toBe('rename-stock');
    expect(() => parseBreakingChange('drop-everything')).toThrow(/Unknown/);
  });
});
