import type { CompiledPattern, CompiledRule } from "./compile.js";
import { combineConfidence } from "./confidence.js";
import type { SiteFacts } from "./facts.js";
import { type EvidenceHit, MIN_MATCH_CONFIDENCE, type RuleMatchResult } from "./matcher-types.js";
import { TimeBudget, truncate } from "./util.js";
import { applyVersionTemplate, reconcileVersions, reliabilityForSignal, type VersionObservation } from "./version.js";

interface Candidate {
  value: string;
}

function extractCandidates(pattern: CompiledPattern, facts: SiteFacts): Candidate[] {
  switch (pattern.type) {
    case "header": {
      if (!pattern.key) return [];
      const value = facts.headers[pattern.key.toLowerCase()];
      return value !== undefined ? [{ value }] : [];
    }
    case "cookie": {
      if (!pattern.key) return [];
      // A trailing "*" means "name starts with" — several frameworks suffix
      // cookie names with a per-install hash (Drupal's SESS<md5>,
      // PrestaShop's PrestaShop-<hash>), so an exact-name match would never
      // fire for them.
      if (pattern.key.endsWith("*")) {
        const prefix = pattern.key.slice(0, -1).toLowerCase();
        return facts.cookies.filter((c) => c.name.toLowerCase().startsWith(prefix)).map((c) => ({ value: c.value }));
      }
      const keyLower = pattern.key.toLowerCase();
      return facts.cookies.filter((c) => c.name.toLowerCase() === keyLower).map((c) => ({ value: c.value }));
    }
    case "meta": {
      if (!pattern.key) return [];
      const keyLower = pattern.key.toLowerCase();
      return facts.metaTags
        .filter((m) => m.name?.toLowerCase() === keyLower || m.property?.toLowerCase() === keyLower)
        .map((m) => ({ value: m.content }));
    }
    case "scriptSrc":
      return facts.scriptSrcs.map((value) => ({ value }));
    case "scriptInline":
      return facts.scriptInline.map((value) => ({ value }));
    case "domAttr": {
      if (!pattern.key || !pattern.attr) return [];
      const result = facts.domQueries[pattern.key];
      const attrValue = result?.attrs?.[pattern.attr];
      return attrValue !== undefined ? [{ value: attrValue }] : [];
    }
    case "domText": {
      if (!pattern.key) return [];
      const result = facts.domQueries[pattern.key];
      return result?.firstText !== undefined ? [{ value: result.firstText }] : [];
    }
    case "jsGlobal": {
      if (!pattern.key) return [];
      const fact = facts.jsGlobals[pattern.key];
      if (!fact || !fact.exists) return [];
      return [{ value: fact.valuePreview ?? "true" }];
    }
    case "css":
      return facts.cssText.map((value) => ({ value }));
    case "url":
      return [facts.finalUrl, ...facts.redirectChain].map((value) => ({ value }));
    case "robots":
      return facts.robotsTxt !== undefined ? [{ value: facts.robotsTxt }] : [];
    case "dns": {
      if (!pattern.key) return [];
      const records = facts.dns?.[pattern.key.toLowerCase() as "cname" | "mx" | "txt" | "ns"];
      return (records ?? []).map((value) => ({ value }));
    }
    case "tlsIssuer":
      return facts.tlsIssuer !== undefined ? [{ value: facts.tlsIssuer }] : [];
    case "faviconHash":
      return facts.faviconHash !== undefined ? [{ value: facts.faviconHash }] : [];
    case "html":
      return [{ value: facts.html }];
    case "probe": {
      if (!pattern.key) return [];
      const probe = facts.probes[pattern.key];
      return probe ? [{ value: `${probe.status}\n${probe.bodySnippet ?? ""}` }] : [];
    }
    case "domExists":
      return [];
    default:
      return [];
  }
}

function matchPattern(pattern: CompiledPattern, index: number, facts: SiteFacts): EvidenceHit | undefined {
  if (pattern.type === "domExists") {
    if (!pattern.key) return undefined;
    const result = facts.domQueries[pattern.key];
    if (!result || !result.exists) return undefined;
    return {
      patternIndex: index,
      type: pattern.type,
      key: pattern.key,
      matchedValue: `${result.count} element(s)`,
      confidence: pattern.confidence,
      negative: pattern.negative,
    };
  }

  for (const candidate of extractCandidates(pattern, facts)) {
    const match = pattern.regex.exec(candidate.value);
    if (match) {
      const version = pattern.version ? applyVersionTemplate(pattern.version, match) : undefined;
      return {
        patternIndex: index,
        type: pattern.type,
        key: pattern.key,
        attr: pattern.attr,
        matchedValue: truncate(candidate.value, 200),
        confidence: pattern.confidence,
        negative: pattern.negative,
        version,
      };
    }
  }
  return undefined;
}

/**
 * Evaluates one compiled rule against one facts object. Pure and
 * deterministic: same rule + same facts always yields the same result, so
 * a stored facts snapshot can be re-matched offline against a newer
 * ruleset.
 */
export function matchRule(rule: CompiledRule, facts: SiteFacts, budgetMs = 50): RuleMatchResult {
  const budget = new TimeBudget(budgetMs);
  const hits: EvidenceHit[] = [];

  for (let i = 0; i < rule.evidence.length; i++) {
    if (!budget.check()) break;
    const pattern = rule.evidence[i];
    if (!pattern) continue;
    const hit = matchPattern(pattern, i, facts);
    if (hit) hits.push(hit);
  }

  const confidence = combineConfidence(hits);
  const observations: VersionObservation[] = hits
    .filter((h) => h.version && !h.negative)
    .map((h) => ({
      value: h.version as string,
      confidence: reliabilityForSignal(h.type),
      source: h.key ? `${h.type}:${h.key}` : h.type,
      weight: h.confidence,
    }));
  const version = observations.length > 0 ? reconcileVersions(observations) : undefined;

  return {
    ruleId: rule.id,
    matched: confidence >= MIN_MATCH_CONFIDENCE && hits.some((h) => !h.negative),
    confidence,
    hits,
    version,
    timedOut: budget.exceeded,
  };
}

export function matchRuleset(rules: CompiledRule[], facts: SiteFacts, perRuleBudgetMs = 50): Map<string, RuleMatchResult> {
  const results = new Map<string, RuleMatchResult>();
  for (const rule of rules) {
    results.set(rule.id, matchRule(rule, facts, perRuleBudgetMs));
  }
  return results;
}
