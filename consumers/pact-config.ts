import path from 'node:path';
import { PactV4 } from '@pact-foundation/pact';

export const PROVIDER_NAME = 'order-service';
export const PACT_DIR = path.resolve(import.meta.dirname, '..', 'pacts');

type LogLevel = NonNullable<ConstructorParameters<typeof PactV4>[0]['logLevel']>;

/** One Pact per consumer test file; every consumer writes to the shared `pacts/` folder. */
export function createPact(consumer: string): PactV4 {
  return new PactV4({
    consumer,
    provider: PROVIDER_NAME,
    dir: PACT_DIR,
    logLevel: (process.env.PACT_LOG_LEVEL as LogLevel | undefined) ?? 'warn',
  });
}
