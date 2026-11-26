import { collectBrowser, collectFast, type BrowserCollectOptions, type FastCollectOptions } from "@adaiyalam/collectors";
import {
  collectBrowserTargets,
  compileRuleset,
  resolveStack,
  type DetectionResult,
  type LoadedRuleset,
  type SiteFacts,
  type StackResult,
} from "@adaiyalam/engine";
import { loadDefaultRuleset } from "@adaiyalam/rules";
import { recordScan, type ScanRecord } from "@adaiyalam/store";
import { buildInsightsReport, type InsightsReport } from "@adaiyalam/insights";

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
  insights: InsightsReport;
  savedScanId?: string;
}

let cachedRuleset: LoadedRuleset | undefined;

export function getRuleset(): LoadedRuleset {
  if (!cachedRuleset) {
    cachedRuleset = compileRuleset(loadDefaultRuleset());
  }
  return cachedRuleset;
}

/** Tests may load a different ruleset; call this after swapping it out. */
export function invalidateRulesetCache(): void {
  cachedRuleset = undefined;
}

export interface ScanUrlOptions extends Partial<FastCollectOptions> {
  /** Persist the facts snapshot + index record to local storage (on by default). */
  save?: boolean;
}

function buildReport(url: string, facts: SiteFacts, stack: StackResult, rulesetVersion: string): ScanReport {
  const ruleset = getRuleset();
  const insights = buildInsightsReport(stack.detections, facts, (techId) => {
    const rule = ruleset.byId.get(techId);
    return rule ? { cpe: rule.cpe, osvPackage: rule.osvPackage } : undefined;
  });

  return {
    url,
    mode: facts.mode,
    scannedAt: facts.collectedAt,
    rulesetVersion,
    facts: {
      finalUrl: facts.finalUrl,
      redirectChain: facts.redirectChain,
      statusCode: facts.statusCode,
      tlsValid: facts.tlsValid,
      errors: facts.errors,
    },
    detections: stack.detections,
    audit: stack.audit,
    insights,
  };
}

export async function scanUrlFast(url: string, options: ScanUrlOptions = {}): Promise<ScanReport> {
  const ruleset = getRuleset();
  const browserTargets = collectBrowserTargets(ruleset.rules);

  const facts: SiteFacts = await collectFast(url, {
    ...options,
    domSelectors: browserTargets.selectors,
    domAttrsBySelector: browserTargets.attrsBySelector,
    jsGlobalCount: browserTargets.jsGlobals.size,
  });

  const stack = resolveStack(ruleset.rules, facts);
  const report = buildReport(url, facts, stack, ruleset.version);

  if (options.save !== false) {
    const record: ScanRecord = recordScan(
      {
        url,
        finalUrl: facts.finalUrl,
        mode: facts.mode,
        scannedAt: facts.collectedAt,
        statusCode: facts.statusCode,
        rulesetVersion: ruleset.version,
        techIds: stack.detections.map((d) => d.techId),
        errors: facts.errors,
      },
      facts
    );
    report.savedScanId = record.id;
  }

  return report;
}

export interface ScanUrlBrowserOptions extends Partial<BrowserCollectOptions> {
  save?: boolean;
}

export async function scanUrlBrowser(url: string, options: ScanUrlBrowserOptions = {}): Promise<ScanReport> {
  const ruleset = getRuleset();
  const browserTargets = collectBrowserTargets(ruleset.rules);

  const facts: SiteFacts = await collectBrowser(url, {
    ...options,
    domSelectors: browserTargets.selectors,
    domAttrsBySelector: browserTargets.attrsBySelector,
    jsGlobalPaths: browserTargets.jsGlobals,
  });

  const stack = resolveStack(ruleset.rules, facts);
  const report = buildReport(url, facts, stack, ruleset.version);

  if (options.save !== false) {
    const record: ScanRecord = recordScan(
      {
        url,
        finalUrl: facts.finalUrl,
        mode: facts.mode,
        scannedAt: facts.collectedAt,
        statusCode: facts.statusCode,
        rulesetVersion: ruleset.version,
        techIds: stack.detections.map((d) => d.techId),
        errors: facts.errors,
      },
      facts
    );
    report.savedScanId = record.id;
  }

  return report;
}

/** Re-runs the matcher/stack resolver against a previously-saved facts snapshot and the *current* ruleset — no network access. */
export function replayScan(facts: SiteFacts): Omit<ScanReport, "savedScanId"> {
  const ruleset = getRuleset();
  const stack = resolveStack(ruleset.rules, facts);
  return buildReport(facts.requestedUrl, facts, stack, ruleset.version);
}
