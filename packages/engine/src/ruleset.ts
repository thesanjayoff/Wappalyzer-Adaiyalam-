import type { FingerprintRule } from "@adaiyalam/schema";
import { compileRule, type CompiledRule } from "./compile.js";
import { stableHash } from "./util.js";

export function hashRule(rule: FingerprintRule): string {
  return stableHash(JSON.stringify(rule));
}

export interface LoadedRuleset {
  rules: CompiledRule[];
  byId: Map<string, CompiledRule>;
  /** Hash of the whole ruleset (sorted rule hashes), stamped on scan results as the "rule version". */
  version: string;
}

export function compileRuleset(rules: FingerprintRule[]): LoadedRuleset {
  const compiled = rules.map((rule) => compileRule(rule, hashRule(rule)));
  const version = stableHash(
    compiled
      .map((r) => r.contentHash)
      .sort()
      .join(":")
  );
  return { rules: compiled, byId: new Map(compiled.map((r) => [r.id, r])), version };
}

/** Every DOM/CSS selector and jsGlobal path referenced anywhere in the ruleset — what a browser collector needs to probe for full coverage. */
export function collectBrowserTargets(rules: CompiledRule[]): { selectors: Set<string>; attrsBySelector: Map<string, Set<string>>; jsGlobals: Set<string> } {
  const selectors = new Set<string>();
  const attrsBySelector = new Map<string, Set<string>>();
  const jsGlobals = new Set<string>();

  for (const rule of rules) {
    for (const pattern of rule.evidence) {
      if ((pattern.type === "domExists" || pattern.type === "domText") && pattern.key) {
        selectors.add(pattern.key);
      }
      if (pattern.type === "domAttr" && pattern.key && pattern.attr) {
        selectors.add(pattern.key);
        const set = attrsBySelector.get(pattern.key) ?? new Set<string>();
        set.add(pattern.attr);
        attrsBySelector.set(pattern.key, set);
      }
      if (pattern.type === "jsGlobal" && pattern.key) {
        jsGlobals.add(pattern.key);
      }
    }
  }

  return { selectors, attrsBySelector, jsGlobals };
}
