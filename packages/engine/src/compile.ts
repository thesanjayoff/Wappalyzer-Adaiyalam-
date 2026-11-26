import type { EvidencePattern, FingerprintRule } from "@adaiyalam/schema";

export interface CompiledPattern extends EvidencePattern {
  regex: RegExp;
}

export interface CompiledRule extends Omit<FingerprintRule, "evidence"> {
  evidence: CompiledPattern[];
  /** sha256 of the rule's JSON form, used as the "rule version" stamped on every detection. */
  contentHash: string;
}

/**
 * `g` and `y` flags are stripped deliberately: compiled regexes are reused
 * across thousands of scans in bulk mode, and a stateful `lastIndex` on a
 * shared RegExp instance would make matches depend on call order — exactly
 * the kind of non-determinism the engine is designed to avoid.
 */
function compilePattern(pattern: EvidencePattern): CompiledPattern {
  const safeFlags = pattern.flags.replace(/[gy]/g, "");
  return { ...pattern, regex: new RegExp(pattern.pattern, safeFlags) };
}

export function compileRule(rule: FingerprintRule, contentHash: string): CompiledRule {
  return {
    ...rule,
    evidence: rule.evidence.map(compilePattern),
    contentHash,
  };
}
