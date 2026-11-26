import { collectFast, type FastCollectOptions } from "@adaiyalam/collectors";
import { collectBrowserTargets, compileRuleset, resolveStack, type DetectionResult, type SiteFacts, type StackResult } from "@adaiyalam/engine";
import { loadDefaultRuleset } from "@adaiyalam/rules";

export interface ScanReport {
  url: string;
  mode: "fast" | "browser";
  scannedAt: string;
  rulesetVersion: string;
  facts: {
    finalUrl: string;
    redirectChain: string[];
    statusCode: number;
    tlsValid?: boolean;
    errors: string[];
  };
  detections: DetectionResult[];
  audit: string[];
}

let cachedRuleset: ReturnType<typeof compileRuleset> | undefined;

export function getRuleset() {
  if (!cachedRuleset) {
    cachedRuleset = compileRuleset(loadDefaultRuleset());
  }
  return cachedRuleset;
}

export async function scanUrlFast(url: string, collectOptions: Partial<FastCollectOptions> = {}): Promise<ScanReport> {
  const ruleset = getRuleset();
  const browserTargets = collectBrowserTargets(ruleset.rules);

  const facts: SiteFacts = await collectFast(url, {
    ...collectOptions,
    domSelectors: browserTargets.selectors,
    domAttrsBySelector: browserTargets.attrsBySelector,
    jsGlobalCount: browserTargets.jsGlobals.size,
  });

  const stack: StackResult = resolveStack(ruleset.rules, facts);

  return {
    url,
    mode: facts.mode,
    scannedAt: facts.collectedAt,
    rulesetVersion: ruleset.version,
    facts: {
      finalUrl: facts.finalUrl,
      redirectChain: facts.redirectChain,
      statusCode: facts.statusCode,
      tlsValid: facts.tlsValid,
      errors: facts.errors,
    },
    detections: stack.detections,
    audit: stack.audit,
  };
}
