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
