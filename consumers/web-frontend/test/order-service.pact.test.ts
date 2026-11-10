import { MatchersV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { createPact } from '../../pact-config.js';
import { ApiError, OrderServiceClient } from '../src/order-service-client.js';

const { like, eachLike, integer, regex, string, datetime } = MatchersV3;

const pact = createPact('web-frontend');

const JSON_CONTENT = { 'Content-Type': regex(/^application\/json(;.*)?$/, 'application/json') };
const BEARER = regex(/^Bearer \S+$/, 'Bearer web-test-token');
const ISO_DATETIME = "yyyy-MM-dd'T'HH:mm:ss.SSSX";

/** Only the fields the storefront renders. The provider is free to send more. */
const productBody = {
  id: regex(/^prd-\d+$/, 'prd-1001'),
  name: string('Stoneware Mug'),
  description: string('A 350 ml hand-glazed stoneware mug.'),
  priceCents: integer(2400),
  currency: regex(/^[A-Z]{3}$/, 'AUD'),
  imageUrl: regex(/^https:\/\/.+/, 'https://cdn.example.com/products/prd-1001.jpg'),
};

const orderBody = {
  id: regex(/^ord-\d+$/, 'ord-0042'),
  status: regex(/^(PENDING|PAID|SHIPPED|CANCELLED)$/, 'PENDING'),
  items: eachLike({
    productId: regex(/^prd-\d+$/, 'prd-1001'),
    productName: string('Stoneware Mug'),
    quantity: integer(2),
    unitPriceCents: integer(2400),
  }),
  totalCents: integer(4800),
  currency: regex(/^[A-Z]{3}$/, 'AUD'),
  createdAt: datetime(ISO_DATETIME, '2026-03-01T10:15:30.000Z'),
};

const client = (baseUrl: string, token?: string) => new OrderServiceClient(baseUrl, () => token);

describe('web-frontend -> order-service', () => {
  describe('GET /products', () => {
    it('lists products for the catalogue page', async () => {
      await pact
        .addInteraction()
        .given('products exist')
        .uponReceiving('a request for the product catalogue')
        .withRequest('GET', '/products', (req) => req.headers({ Accept: 'application/json' }))
        .willRespondWith(200, (res) =>
          res.headers(JSON_CONTENT).jsonBody({ items: eachLike(productBody) }),
        )
        .executeTest(async (mockServer) => {
          const products = await client(mockServer.url).listProducts();

          expect(products).toHaveLength(1);
          expect(products[0]).toMatchObject({ id: 'prd-1001', priceCents: 2400, currency: 'AUD' });
        });
    });
  });

  describe('GET /products/:id', () => {
    it('returns one product for the product page', async () => {
      await pact
        .addInteraction()
        .given('a product exists', { productId: 'prd-1001' })
        .uponReceiving('a request for product prd-1001')
        .withRequest('GET', '/products/prd-1001', (req) =>
          req.headers({ Accept: 'application/json' }),
        )
        .willRespondWith(200, (res) => res.headers(JSON_CONTENT).jsonBody(productBody))
        .executeTest(async (mockServer) => {
          const product = await client(mockServer.url).getProduct('prd-1001');

          expect(product.name).toBe('Stoneware Mug');
        });
    });

    it('reports a missing product as NOT_FOUND', async () => {
      await pact
        .addInteraction()
        .given('no product exists', { productId: 'prd-9999' })
        .uponReceiving('a request for a product that does not exist')
        .withRequest('GET', '/products/prd-9999', (req) =>
          req.headers({ Accept: 'application/json' }),
        )
        .willRespondWith(404, (res) =>
          res.headers(JSON_CONTENT).jsonBody({
            error: 'NOT_FOUND',
            message: string('Product prd-9999 was not found'),
          }),
        )
        .executeTest(async (mockServer) => {
          const error = await client(mockServer.url)
            .getProduct('prd-9999')
            .catch((e: unknown) => e);

          expect(error).toBeInstanceOf(ApiError);
          expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
        });
    });
  });

  describe('POST /orders', () => {
    it('places an order at checkout', async () => {
      await pact
        .addInteraction()
        .given('a product is in stock', { productId: 'prd-1001', stock: 10 })
        .uponReceiving('a request to place an order')
        .withRequest('POST', '/orders', (req) =>
          req
            .headers({
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: BEARER,
            })
            .jsonBody({ items: [{ productId: 'prd-1001', quantity: 2 }] }),
        )
        .willRespondWith(201, (res) =>
          res
            .headers({
              ...JSON_CONTENT,
              Location: regex(/^\/orders\/ord-\d+$/, '/orders/ord-0042'),
            })
            .jsonBody({ ...orderBody, status: 'PENDING' }),
        )
        .executeTest(async (mockServer) => {
          const order = await client(mockServer.url, 'web-test-token').placeOrder([
            { productId: 'prd-1001', quantity: 2 },
          ]);

          expect(order.status).toBe('PENDING');
          expect(order.totalCents).toBe(4800);
        });
    });

    it('shows field errors when the basket is empty', async () => {
      await pact
        .addInteraction()
        .uponReceiving('a request to place an order with no items')
        .withRequest('POST', '/orders', (req) =>
          req
            .headers({
              Accept: 'application/json',
              'Content-Type': 'application/json',
              Authorization: BEARER,
            })
            .jsonBody({ items: [] }),
        )
        .willRespondWith(400, (res) =>
          res.headers(JSON_CONTENT).jsonBody({
            error: 'VALIDATION_ERROR',
            message: string('The order request is invalid'),
            details: eachLike({
              field: 'items',
              message: string('items must contain at least one line'),
            }),
          }),
        )
        .executeTest(async (mockServer) => {
          const error = await client(mockServer.url, 'web-test-token')
            .placeOrder([])
            .catch((e: unknown) => e);

          expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
          expect((error as ApiError).details[0]?.field).toBe('items');
        });
    });

    it('asks the shopper to sign in when there is no token', async () => {
      await pact
        .addInteraction()
        .uponReceiving('a request to place an order without a bearer token')
        .withRequest('POST', '/orders', (req) =>
          req
            .headers({ Accept: 'application/json', 'Content-Type': 'application/json' })
            .jsonBody({ items: [{ productId: 'prd-1001', quantity: 1 }] }),
        )
        .willRespondWith(401, (res) =>
          res.headers(JSON_CONTENT).jsonBody({
            error: 'UNAUTHORIZED',
            message: string('A valid bearer token is required'),
          }),
        )
        .executeTest(async (mockServer) => {
          const error = await client(mockServer.url)
            .placeOrder([{ productId: 'prd-1001', quantity: 1 }])
            .catch((e: unknown) => e);

          expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
        });
    });
  });

  describe('GET /orders/:id', () => {
    it('shows the order confirmation page', async () => {
      await pact
        .addInteraction()
        .given('an order exists', { orderId: 'ord-0042' })
        .uponReceiving('a request for order ord-0042')
        .withRequest('GET', '/orders/ord-0042', (req) =>
          req.headers({ Accept: 'application/json', Authorization: BEARER }),
        )
        .willRespondWith(200, (res) => res.headers(JSON_CONTENT).jsonBody(orderBody))
        .executeTest(async (mockServer) => {
          const order = await client(mockServer.url, 'web-test-token').getOrder('ord-0042');

          expect(order.id).toBe('ord-0042');
          expect(order.items[0]?.productName).toBe('Stoneware Mug');
        });
    });

    it('reports a missing order as NOT_FOUND', async () => {
      await pact
        .addInteraction()
        .given('no order exists', { orderId: 'ord-9999' })
        .uponReceiving('a request for an order that does not exist')
        .withRequest('GET', '/orders/ord-9999', (req) =>
          req.headers({ Accept: 'application/json', Authorization: BEARER }),
        )
        .willRespondWith(404, (res) =>
          res.headers(JSON_CONTENT).jsonBody({
            error: 'NOT_FOUND',
            message: like('Order ord-9999 was not found'),
          }),
        )
        .executeTest(async (mockServer) => {
          const error = await client(mockServer.url, 'web-test-token')
            .getOrder('ord-9999')
            .catch((e: unknown) => e);

          expect(error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
        });
    });
  });
});
