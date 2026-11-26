import type { CompiledRule } from "./compile.js";
import type { SiteFacts } from "./facts.js";
import { matchRuleset } from "./matcher.js";
import type { EvidenceHit, RuleMatchResult } from "./matcher-types.js";
import { MIN_MATCH_CONFIDENCE } from "./matcher-types.js";
import type { VersionConfidence } from "./version.js";

export interface DetectionResult {
  techId: string;
  name: string;
  categories: string[];
  confidence: number;
  version?: { value?: string; confidence: VersionConfidence };
  evidence: EvidenceHit[];
  impliedBy: string[];
  directlyMatched: boolean;
  ruleContentHash: string;
  conflictNote?: string;
}

export interface StackResult {
  detections: DetectionResult[];
  audit: string[];
  /** techId -> other techId, for the frontend/backend/hosting stack graph. */
  relationships: { from: string; to: string; kind: "implies" | "requires" | "excludes-lost-to" }[];
}

interface ActiveEntry {
  confidence: number;
  impliedBy: Set<string>;
  directlyMatched: boolean;
}

const MAX_ITERATIONS = 6;

export function resolveStack(rules: CompiledRule[], facts: SiteFacts, perRuleBudgetMs = 50): StackResult {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const raw: Map<string, RuleMatchResult> = matchRuleset(rules, facts, perRuleBudgetMs);
  const audit: string[] = [];

  const active = new Map<string, ActiveEntry>();
  for (const [id, result] of raw) {
    if (result.matched) {
      active.set(id, { confidence: result.confidence, impliedBy: new Set(), directlyMatched: true });
    }
    if (result.timedOut) {
      audit.push(`rule "${id}" hit its matching time budget and was evaluated partially`);
    }
  }

  const relationships: StackResult["relationships"] = [];

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    let changed = false;

    // 1. Propagate `implies`.
    for (const [id, entry] of [...active.entries()]) {
      const rule = byId.get(id);
      if (!rule) continue;
      for (const impliesEntry of rule.implies) {
        const impliedId = typeof impliesEntry === "string" ? impliesEntry : impliesEntry.id;
        const impliedWeight = typeof impliesEntry === "string" ? 100 : impliesEntry.confidence;
        if (!byId.has(impliedId)) continue; // dangling reference to an unknown tech id
        const impliedConfidence = Math.round((entry.confidence * impliedWeight) / 100);
        const existing = active.get(impliedId);
        if (!existing) {
          active.set(impliedId, { confidence: impliedConfidence, impliedBy: new Set([id]), directlyMatched: false });
          relationships.push({ from: id, to: impliedId, kind: "implies" });
          changed = true;
        } else if (!existing.impliedBy.has(id) && !existing.directlyMatched) {
          existing.impliedBy.add(id);
          if (impliedConfidence > existing.confidence) existing.confidence = impliedConfidence;
          relationships.push({ from: id, to: impliedId, kind: "implies" });
          changed = true;
        } else if (!existing.impliedBy.has(id)) {
          existing.impliedBy.add(id);
        }
      }
    }

    // 2. Enforce `requires`.
    for (const [id, entry] of [...active.entries()]) {
      const rule = byId.get(id);
      if (!rule || rule.requires.length === 0) continue;
      const satisfied = rule.requires.some((reqId) => active.has(reqId));
      if (!satisfied) {
        if (entry.directlyMatched && entry.confidence >= 70) {
          audit.push(
            `"${id}" matched directly with high confidence but none of its required technologies (${rule.requires.join(", ")}) were detected — kept, flagged`
          );
        } else {
          active.delete(id);
          audit.push(`"${id}" dropped: requires one of [${rule.requires.join(", ")}], none detected`);
          changed = true;
        }
      }
    }

    // 3. Resolve `excludes` conflicts, keep the higher-confidence side.
    for (const [id, entry] of [...active.entries()]) {
      const rule = byId.get(id);
      if (!rule) continue;
      for (const excludedId of rule.excludes) {
        const other = active.get(excludedId);
        if (!other) continue;
        if (entry.confidence >= other.confidence) {
          active.delete(excludedId);
          relationships.push({ from: id, to: excludedId, kind: "excludes-lost-to" });
          audit.push(`"${excludedId}" suppressed: conflicts with "${id}" (${entry.confidence} vs ${other.confidence} confidence)`);
        } else {
          active.delete(id);
          relationships.push({ from: excludedId, to: id, kind: "excludes-lost-to" });
          audit.push(`"${id}" suppressed: conflicts with "${excludedId}" (${other.confidence} vs ${entry.confidence} confidence)`);
        }
        changed = true;
      }
    }

    if (!changed) break;
  }

  const detections: DetectionResult[] = [];
  for (const [id, entry] of active) {
    if (entry.confidence < MIN_MATCH_CONFIDENCE) continue;
    const rule = byId.get(id);
    if (!rule) continue;
    const rawResult = raw.get(id);
    detections.push({
      techId: id,
      name: rule.name,
      categories: rule.categories,
      confidence: entry.confidence,
      version: entry.directlyMatched ? rawResult?.version : undefined,
      evidence: entry.directlyMatched ? rawResult?.hits.filter((h) => !h.negative) ?? [] : [],
      impliedBy: [...entry.impliedBy],
      directlyMatched: entry.directlyMatched,
      ruleContentHash: rule.contentHash,
    });
  }

  detections.sort((a, b) => b.confidence - a.confidence || a.name.localeCompare(b.name));

  return { detections, audit, relationships };
}
