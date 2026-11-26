import type { AppEvidenceHit, AppEvidencePattern, AppFacts, AppFingerprintRule } from "./types.js";

const MIN_MATCH_CONFIDENCE = 10;

function candidatesFor(pattern: AppEvidencePattern, facts: AppFacts): string[] {
  switch (pattern.type) {
    case "permission":
      return facts.permissions;
    case "classPrefix":
      return facts.classPrefixes;
    case "nativeLib":
      return facts.nativeLibs;
    case "string":
      return facts.strings;
    case "manifestMeta":
      if (!pattern.key) return [];
      return facts.manifestMeta.filter((m) => m.name.toLowerCase() === pattern.key?.toLowerCase()).map((m) => m.value ?? "");
    default:
      return [];
  }
}

function matchOnePattern(pattern: AppEvidencePattern, index: number, facts: AppFacts): AppEvidenceHit | undefined {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.pattern, pattern.flags.replace(/[gy]/g, ""));
  } catch {
    return undefined;
  }
  for (const candidate of candidatesFor(pattern, facts)) {
    const match = regex.exec(candidate);
    if (match) {
      const version = pattern.version ? pattern.version.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? "") : undefined;
      return { patternIndex: index, matchedValue: candidate.slice(0, 200), confidence: pattern.confidence, negative: pattern.negative, version };
    }
  }
  return undefined;
}

/** Same probabilistic-OR-plus-negative-suppression formula as the web engine's combineConfidence, duplicated here (it's a handful of lines) to keep app-analysis independent of the web-specific matcher. */
function combineConfidence(hits: AppEvidenceHit[]): number {
  const positives = hits.filter((h) => !h.negative);
  const negatives = hits.filter((h) => h.negative);
  if (positives.length === 0) return 0;

  let survivalProduct = 1;
  for (const hit of positives) survivalProduct *= 1 - Math.min(hit.confidence, 100) / 100;
  let combined = (1 - survivalProduct) * 100;
  for (const hit of negatives) combined *= 1 - Math.min(hit.confidence, 100) / 100;

  return Math.round(Math.min(100, Math.max(0, combined)));
}

export interface AppRuleMatchResult {
  matched: boolean;
  confidence: number;
  hits: AppEvidenceHit[];
  version?: string;
}

export function matchAppRule(rule: AppFingerprintRule, facts: AppFacts): AppRuleMatchResult {
  const hits: AppEvidenceHit[] = [];
  for (let i = 0; i < rule.evidence.length; i++) {
    const pattern = rule.evidence[i];
    if (!pattern) continue;
    const hit = matchOnePattern(pattern, i, facts);
    if (hit) hits.push(hit);
  }

  const confidence = combineConfidence(hits);
  const versionedHits = hits.filter((h) => h.version && !h.negative).sort((a, b) => b.confidence - a.confidence);
  const version = versionedHits[0]?.version;

  return { matched: confidence >= MIN_MATCH_CONFIDENCE && hits.some((h) => !h.negative), confidence, hits, version };
}
