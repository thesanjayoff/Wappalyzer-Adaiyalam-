import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const WORKER_PATH = fileURLToPath(new URL("./safe-regex-worker.mjs", import.meta.url));

export interface SafeRegexCheckResult {
  safe: boolean;
  reason?: string;
  timedOutOn?: string;
}

/**
 * Cheap, offline static heuristics for the classic catastrophic-backtracking
 * shapes: a quantified group that is itself quantified, and a quantified
 * group whose alternation branches overlap. These do not catch everything
 * but catch the overwhelming majority of accidental ReDoS patterns rule
 * authors write, before we even spend time on the dynamic timing test.
 */
export function staticRedFlags(pattern: string): string[] {
  const flags: string[] = [];
  if (/\([^()]*[+*]\)[+*]/.test(pattern)) {
    flags.push("nested quantifier on a quantified group, e.g. (a+)+");
  }
  const altGroupQuantified = /\(([^()]*\|[^()]*)\)[+*]/g;
  let m: RegExpExecArray | null;
  while ((m = altGroupQuantified.exec(pattern))) {
    flags.push(`quantified alternation group may backtrack badly: (${m[1]})`);
  }
  if (/\.\*.*\.\*/.test(pattern)) {
    flags.push("multiple unbounded .* in one pattern can be quadratic on long input");
  }
  if (pattern.length > 300) {
    flags.push("pattern is unusually long (>300 chars) — consider splitting it");
  }
  return flags;
}

const ADVERSARIAL_INPUTS: readonly string[] = (() => {
  const inputs: string[] = [];
  for (const n of [16, 24, 32, 48, 64, 96]) {
    inputs.push("a".repeat(n) + "!");
    inputs.push("a".repeat(n) + "b".repeat(n));
    inputs.push("a".repeat(n));
    inputs.push("<" + "a".repeat(n));
    inputs.push(" ".repeat(n));
  }
  return inputs;
})();

function runInWorker(
  pattern: string,
  flags: string,
  input: string,
  timeoutMs: number
): Promise<{ ok: boolean; timedOut?: boolean; error?: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const worker = new Worker(WORKER_PATH, { workerData: { pattern, flags, input } });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      resolve({ ok: true, timedOut: true });
    }, timeoutMs);
    worker.once("message", (msg: { ok: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(msg.ok ? { ok: true } : { ok: false, error: msg.error });
    });
    worker.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: String(err.message) });
    });
  });
}

/**
 * Dynamic timing test: run the regex against a battery of adversarial
 * inputs in a disposable worker thread with a hard wall-clock timeout. If
 * any single match attempt doesn't return within the budget, we kill the
 * worker and call the pattern unsafe. This catches patterns the static
 * heuristic misses.
 */
export async function checkRegexTiming(pattern: string, flags: string, timeoutMs = 75): Promise<SafeRegexCheckResult> {
  for (const input of ADVERSARIAL_INPUTS) {
    const result = await runInWorker(pattern, flags, input, timeoutMs);
    if (!result.ok) {
      return { safe: false, reason: result.error };
    }
    if (result.timedOut) {
      return { safe: false, timedOutOn: input, reason: "regex exceeded the time budget on an adversarial input" };
    }
  }
  return { safe: true };
}

export async function assertSafeRegex(pattern: string, flags = "i"): Promise<SafeRegexCheckResult> {
  const staticFlags = staticRedFlags(pattern);
  if (staticFlags.length > 0) {
    return { safe: false, reason: staticFlags.join("; ") };
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern, flags);
  } catch (err) {
    return { safe: false, reason: `does not compile: ${(err as Error).message}` };
  }
  return checkRegexTiming(pattern, flags);
}

/**
 * At scan time we don't want to spawn a worker per pattern (far too slow for
 * thousands of domains). Instead the matcher wraps execution with a
 * synchronous wall-clock budget check between patterns and a global rule
 * evaluation time cap — see `engine/src/matcher.ts`'s `TimeBudget`. The
 * worker-based check here is strictly an authoring-time (`rule lint`,
 * `rule test`, ruleset build) safety net.
 */
