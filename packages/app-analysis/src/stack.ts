import { matchAppRule } from "./matcher.js";
import type { AppDetectionResult, AppFacts, AppFingerprintRule } from "./types.js";

const IMPLIED_CONFIDENCE = 60;

export function resolveAppStack(rules: AppFingerprintRule[], facts: AppFacts): AppDetectionResult[] {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const results = new Map<string, AppDetectionResult>();

  for (const rule of rules) {
    const result = matchAppRule(rule, facts);
    if (!result.matched) continue;
    results.set(rule.id, {
      techId: rule.id,
      name: rule.name,
      categories: rule.categories,
      confidence: result.confidence,
      version: result.version,
      impliedBy: [],
      hits: result.hits,
    });
  }

  // Fixed-point resolution: a matched rule's `implies` list adds (or
  // strengthens) the implied technology, which may itself have further
  // implications — same idea as the web engine's implies resolution, just
  // without the requires/excludes refinements (not needed yet for the
  // small app ruleset).
  let changed = true;
  while (changed) {
    changed = false;
    for (const result of [...results.values()]) {
      const rule = byId.get(result.techId);
      if (!rule) continue;
      for (const impliedId of rule.implies) {
        const impliedRule = byId.get(impliedId);
        if (!impliedRule) continue;
        const existing = results.get(impliedId);
        if (!existing) {
          results.set(impliedId, {
            techId: impliedId,
            name: impliedRule.name,
            categories: impliedRule.categories,
            confidence: IMPLIED_CONFIDENCE,
            impliedBy: [result.techId],
            hits: [],
          });
          changed = true;
        } else if (!existing.impliedBy.includes(result.techId)) {
          existing.impliedBy.push(result.techId);
          changed = true;
        }
      }
    }
  }

  return [...results.values()].sort((a, b) => b.confidence - a.confidence);
}

export function appFactsAreEmpty(facts: AppFacts): boolean {
  return (
    facts.permissions.length === 0 &&
    facts.classPrefixes.length === 0 &&
    facts.manifestMeta.length === 0 &&
    facts.nativeLibs.length === 0 &&
    facts.strings.length === 0
  );
}
