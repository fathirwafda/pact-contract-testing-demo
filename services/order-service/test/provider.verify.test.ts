import { existsSync, readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Verifier, type VerifierOptions } from '@pact-foundation/pact';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseBreakingChange } from '../src/config.js';
import type { Order } from '../src/domain.js';
import { seedSampleProducts, Store } from '../src/store.js';

const PACT_DIR = path.resolve(import.meta.dirname, '..', '..', '..', 'pacts');
const VERIFIER_TOKEN = 'pact-verifier-token';
const VERIFIER_CUSTOMER = 'cus-pact';

const store = new Store();
let server: Server;
let baseUrl: string;

/** Params arrive as JSON from the pact file; read them defensively. */
function param(params: unknown, key: string): string {
  const value = (params as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`Provider state is missing parameter "${key}"`);
  }
  return String(value);
}

function sampleOrder(id: string): Order {
  return {
    id,
    customerId: VERIFIER_CUSTOMER,
    status: 'SHIPPED',
    items: [
      { productId: 'prd-1001', productName: 'Stoneware Mug', quantity: 2, unitPriceCents: 2400 },
    ],
    totalCents: 4800,
    currency: 'AUD',
    createdAt: '2026-03-01T10:15:30.000Z',
  };
}

/**
 * Each state name must match a `.given(...)` in a consumer test exactly. beforeEach resets the
 * store to the sample catalogue, so a handler only adds what its state needs on top.
 */
const stateHandlers: NonNullable<VerifierOptions['stateHandlers']> = {
  'products exist': () => Promise.resolve(),
  'products exist in a category': (params) => {
    const category = param(params, 'category');
    if (!store.listProducts().some((product) => product.category === category)) {
      throw new Error(`Sample data has no product in category ${category}`);
    }
    return Promise.resolve();
  },
  'a product exists': (params) => {
    const id = param(params, 'productId');
    if (!store.getProduct(id)) throw new Error(`Sample data has no product ${id}`);
    return Promise.resolve();
  },
  'no product exists': (params) => {
    const id = param(params, 'productId');
    if (store.getProduct(id)) throw new Error(`Product ${id} must not exist for this state`);
    return Promise.resolve();
  },
  'a product is in stock': (params) => {
    const id = param(params, 'productId');
    const product = store.getProduct(id);
    if (!product) throw new Error(`Sample data has no product ${id}`);
    store.upsertProduct({ ...product, stock: Number(param(params, 'stock')) });
    return Promise.resolve();
  },
  'an order exists': (params) => {
    store.upsertOrder(sampleOrder(param(params, 'orderId')));
    return Promise.resolve();
  },
  'no order exists': () => Promise.resolve(),
};

/**
 * Consumers record any bearer token. Swap it for one the provider accepts, but only when the
 * request carries one: the 401 interactions must still arrive without it.
 */
const requestFilter: NonNullable<VerifierOptions['requestFilter']> = (req, _res, next) => {
  if (req.headers.authorization) req.headers.authorization = `Bearer ${VERIFIER_TOKEN}`;
  next();
};

function pactSource(): Partial<VerifierOptions> {
  const brokerUrl = process.env.PACT_BROKER_BASE_URL;
  if (brokerUrl) {
    const { PACT_BROKER_TOKEN, PACT_BROKER_USERNAME, PACT_BROKER_PASSWORD } = process.env;
    return {
      pactBrokerUrl: brokerUrl,
      // Pact rejects credential keys that are present but undefined, so add only the ones set.
      ...(PACT_BROKER_TOKEN ? { pactBrokerToken: PACT_BROKER_TOKEN } : {}),
      ...(PACT_BROKER_USERNAME ? { pactBrokerUsername: PACT_BROKER_USERNAME } : {}),
      ...(PACT_BROKER_PASSWORD ? { pactBrokerPassword: PACT_BROKER_PASSWORD } : {}),
      // Same-branch pacts (this repo changes consumer and provider together), the consumers'
      // main branch, and whatever is currently deployed.
      consumerVersionSelectors: [
        { matchingBranch: true },
        { mainBranch: true },
        { deployedOrReleased: true },
      ],
      enablePending: true,
      publishVerificationResult: process.env.PACT_PUBLISH_VERIFICATION_RESULTS === 'true',
    };
  }

  const files = existsSync(PACT_DIR)
    ? readdirSync(PACT_DIR).filter((file) => file.endsWith('.json'))
    : [];
  if (files.length === 0) {
    throw new Error(`No pact files in ${PACT_DIR}. Run "npm run test:consumer" first.`);
  }
  return { pactUrls: files.map((file) => path.join(PACT_DIR, file)) };
}

describe('order-service provider verification', () => {
  beforeAll(async () => {
    const app = createApp({
      store,
      apiTokens: new Map([[VERIFIER_TOKEN, VERIFIER_CUSTOMER]]),
      breakingChange: parseBreakingChange(process.env.ORDER_SERVICE_BREAKING_CHANGE),
    });
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('honours every consumer contract', async () => {
    const verifier = new Verifier({
      provider: 'order-service',
      providerBaseUrl: baseUrl,
      providerVersion: process.env.GIT_COMMIT ?? '0.0.0-local',
      providerVersionBranch: process.env.GIT_BRANCH ?? 'local',
      logLevel: (process.env.PACT_LOG_LEVEL as VerifierOptions['logLevel']) ?? 'warn',
      beforeEach: () => {
        store.reset();
        seedSampleProducts(store);
        return Promise.resolve();
      },
      stateHandlers,
      requestFilter,
      ...pactSource(),
    });

    await expect(verifier.verifyProvider()).resolves.toBeDefined();
  });
});
