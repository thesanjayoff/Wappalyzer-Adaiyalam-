function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enforces both a global request rate and a per-host politeness delay.
 * `schedule(host)` resolves only once it is safe to send the next request;
 * callers must await it immediately before issuing the request. Scheduling
 * decisions are serialized through an internal queue so two concurrent
 * callers can't both observe "no wait needed" for the same host.
 */
export class RateLimiter {
  private lastGlobalAt = 0;
  private readonly lastHostAt = new Map<string, number>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly globalMinIntervalMs: number,
    private readonly perHostMinIntervalMs: number
  ) {}

  schedule(host: string): Promise<void> {
    const run = this.queue.then(() => this.waitTurn(host));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async waitTurn(host: string): Promise<void> {
    const hostLast = this.lastHostAt.get(host) ?? 0;
    const wait = Math.max(this.perHostMinIntervalMs - (Date.now() - hostLast), this.globalMinIntervalMs - (Date.now() - this.lastGlobalAt), 0);
    if (wait > 0) await sleep(wait);
    this.lastGlobalAt = Date.now();
    this.lastHostAt.set(host, Date.now());
  }

  snapshot(): { hostsTracked: number } {
    return { hostsTracked: this.lastHostAt.size };
  }
}

export interface RateLimitConfig {
  /** Max requests/second across all hosts combined. */
  globalRps: number;
  /** Minimum milliseconds between two requests to the same host. */
  perHostDelayMs: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  globalRps: 5,
  perHostDelayMs: 1500,
};

export function createRateLimiter(config: RateLimitConfig = DEFAULT_RATE_LIMIT): RateLimiter {
  return new RateLimiter(1000 / Math.max(config.globalRps, 0.1), config.perHostDelayMs);
}
