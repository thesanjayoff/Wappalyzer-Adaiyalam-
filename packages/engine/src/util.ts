export function escapeRegex(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wall-clock budget enforced *between* pattern evaluations (not inside a single regex exec — that's the authoring-time job of `assertSafeRegex`). Prevents one pathological rule from stalling a whole scan. */
export class TimeBudget {
  private readonly deadline: number;
  public exceeded = false;

  constructor(budgetMs: number) {
    this.deadline = Date.now() + budgetMs;
  }

  check(): boolean {
    if (Date.now() > this.deadline) {
      this.exceeded = true;
    }
    return !this.exceeded;
  }
}

export function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Deterministic, dependency-free content fingerprint (two interleaved
 * 32-bit FNV-1a passes, printed as 16 hex chars). Not cryptographic — used
 * only for change detection (did this rule/ruleset's content change?), so
 * it needs to be identical in Node and in a bundled browser extension,
 * which rules out `node:crypto`.
 */
export function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= code + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h1) + hex(h2);
}
