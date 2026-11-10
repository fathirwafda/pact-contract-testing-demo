export type BreakingChange = 'none' | 'rename-stock';

export interface ServiceConfig {
  port: number;
  /** Bearer token -> customer id. */
  apiTokens: Map<string, string>;
  /**
   * Simulated regression used by `npm run demo:break`. Never set it in a real deployment:
   * it exists to show what a contract failure looks like.
   */
  breakingChange: BreakingChange;
}

export const DEFAULT_API_TOKENS = 'local-dev-token:cus-001';

/** Parses `token:customerId,token:customerId`. */
export function parseApiTokens(raw: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const [token, customerId] = pair.split(':').map((part) => part.trim());
    if (!token || !customerId) {
      throw new Error(
        `Invalid ORDER_SERVICE_API_TOKENS entry "${pair}", expected token:customerId`,
      );
    }
    tokens.set(token, customerId);
  }
  return tokens;
}

export function parseBreakingChange(raw: string | undefined): BreakingChange {
  if (raw === undefined || raw === '' || raw === 'none') return 'none';
  if (raw === 'rename-stock') return raw;
  throw new Error(`Unknown ORDER_SERVICE_BREAKING_CHANGE "${raw}", expected "rename-stock"`);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServiceConfig {
  return {
    port: Number(env.PORT ?? 3000),
    apiTokens: parseApiTokens(env.ORDER_SERVICE_API_TOKENS ?? DEFAULT_API_TOKENS),
    breakingChange: parseBreakingChange(env.ORDER_SERVICE_BREAKING_CHANGE),
  };
}
