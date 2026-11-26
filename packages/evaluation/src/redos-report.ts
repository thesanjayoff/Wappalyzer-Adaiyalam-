import { checkRegexTiming } from "@adaiyalam/schema";
import { loadDefaultRuleset } from "@adaiyalam/rules";

export interface RedosReportEntry {
  techId: string;
  patternIndex: number;
  pattern: string;
  safe: boolean;
  reason?: string;
  elapsedMs: number;
}

export interface RedosReport {
  rulesChecked: number;
  patternsChecked: number;
  unsafeCount: number;
  slowestPatterns: RedosReportEntry[];
  unsafePatterns: RedosReportEntry[];
  totalElapsedMs: number;
}

/**
 * Runs the dynamic ReDoS timing check (the same one `rule lint`/the ruleset
 * test suite use) against every evidence pattern in the default ruleset,
 * reporting elapsed time per pattern rather than just pass/fail — useful
 * for spotting rules that are "safe" but slow enough to matter at scale.
 */
export async function runRedosReport(): Promise<RedosReport> {
  const rules = loadDefaultRuleset();
  const entries: RedosReportEntry[] = [];
  const started = Date.now();

  for (const rule of rules) {
    let index = 0;
    for (const evidence of rule.evidence) {
      if (evidence.type === "domExists" || !evidence.pattern) {
        index++;
        continue;
      }
      const t0 = Date.now();
      const result = await checkRegexTiming(evidence.pattern, evidence.flags ?? "i");
      entries.push({ techId: rule.id, patternIndex: index, pattern: evidence.pattern, safe: result.safe, reason: result.reason, elapsedMs: Date.now() - t0 });
      index++;
    }
  }

  const sorted = [...entries].sort((a, b) => b.elapsedMs - a.elapsedMs);

  return {
    rulesChecked: rules.length,
    patternsChecked: entries.length,
    unsafeCount: entries.filter((e) => !e.safe).length,
    slowestPatterns: sorted.slice(0, 10),
    unsafePatterns: entries.filter((e) => !e.safe),
    totalElapsedMs: Date.now() - started,
  };
}
