import { MatchersV3 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { createPact } from '../../pact-config.js';
import { MobileApiError, MobileOrderServiceClient } from '../src/order-service-client.js';

const { eachLike, integer, regex, string } = MatchersV3;

const pact = createPact('mobile-app');

const JSON_CONTENT = { 'Content-Type': regex(/^application\/json(;.*)?$/, 'application/json') };

describe('mobile-app -> order-service', () => {
  it('loads product tiles for a category, including stock for the "Sold out" badge', async () => {
    await pact
      .addInteraction()
      .given('products exist in a category', { category: 'kitchen' })
      .uponReceiving('a request for product tiles in a category')
      .withRequest('GET', '/products', (req) =>
        req.query({ category: 'kitchen' }).headers({ Accept: 'application/json' }),
      )
      .willRespondWith(200, (res) =>
        res.headers(JSON_CONTENT).jsonBody({
          // The mobile list view needs four fields. Nothing about images or descriptions.
          items: eachLike({
            id: regex(/^prd-\d+$/, 'prd-1001'),
            name: string('Stoneware Mug'),
            priceCents: integer(2400),
            stock: integer(0),
          }),
        }),
      )
      .executeTest(async (mockServer) => {
        const tiles = await new MobileOrderServiceClient(mockServer.url).productTiles('kitchen');

        expect(tiles).toEqual([
          { id: 'prd-1001', title: 'Stoneware Mug', priceCents: 2400, soldOut: true },
        ]);
      });
  });

  it('tracks an order', async () => {
    await pact
      .addInteraction()
      .given('an order exists', { orderId: 'ord-0042' })
      .uponReceiving('a request to track order ord-0042')
      .withRequest('GET', '/orders/ord-0042', (req) =>
        req.headers({
          Accept: 'application/json',
          Authorization: regex(/^Bearer \S+$/, 'Bearer mobile-test-token'),
        }),
      )
      .willRespondWith(200, (res) =>
        res.headers(JSON_CONTENT).jsonBody({
          id: regex(/^ord-\d+$/, 'ord-0042'),
          status: regex(/^(PENDING|PAID|SHIPPED|CANCELLED)$/, 'SHIPPED'),
          totalCents: integer(4800),
        }),
      )
      .executeTest(async (mockServer) => {
        const tracking = await new MobileOrderServiceClient(
          mockServer.url,
          'mobile-test-token',
        ).trackOrder('ord-0042');

        expect(tracking).toEqual({ orderId: 'ord-0042', status: 'SHIPPED', totalCents: 4800 });
      });
  });

  it('gets 401 when tracking an order after the session expired', async () => {
    await pact
      .addInteraction()
      .given('an order exists', { orderId: 'ord-0042' })
      .uponReceiving('a request to track an order without a bearer token')
      .withRequest('GET', '/orders/ord-0042', (req) => req.headers({ Accept: 'application/json' }))
      .willRespondWith(401, (res) =>
        res.headers(JSON_CONTENT).jsonBody({ error: 'UNAUTHORIZED', message: string() }),
      )
      .executeTest(async (mockServer) => {
        const error = await new MobileOrderServiceClient(mockServer.url)
          .trackOrder('ord-0042')
          .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MobileApiError);
        expect(error).toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
      });
  });
});
