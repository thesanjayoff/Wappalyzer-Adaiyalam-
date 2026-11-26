import { createRateLimiter } from "@adaiyalam/collectors";
import { scanUrlFast } from "@adaiyalam/orchestrator";
import { loadGroundTruth } from "./loader.js";
import type { GroundTruthSite, NegativeControlSite } from "./ground-truth-types.js";

export interface SitePredictionError {
  url: string;
  error: string;
}

export interface SitePredictionResult {
  url: string;
  expected: string[];
  detected: string[];
  truePositives: string[];
  falsePositives: string[];
  falseNegatives: string[];
  /** Confidence of each detection that matched an expected tech, or fired on a negative-control tech it shouldn't have. */
  confidenceSamples: { techId: string; confidence: number; correct: boolean }[];
}

export const PRECISION_CAVEAT =
  "Ground-truth labels are NOT exhaustive — each site lists only the 1-3 headline technologies verified by hand, not every technology genuinely present. " +
  "Recall is therefore a reliable signal (every labelled technology was either found or counted as a false negative), but precision as computed here is a " +
  "pessimistic lower bound: most 'false positives' are very likely additional technologies that are genuinely present but were never verified and added to " +
  "the label list, not real detector errors. Treat a 'false positive' as worth investigating, not as proven wrong.";

export interface GroundTruthEvalReport {
  verifiedAsOf: string;
  note: string;
  sitesEvaluated: number;
  sitesErrored: SitePredictionError[];
  perSite: SitePredictionResult[];
  /** Micro-averaged across all (site, expected-or-detected tech) pairs. */
  overall: { precision: number; recall: number; f1: number; truePositives: number; falsePositives: number; falseNegatives: number };
  perTechnology: { techId: string; truePositives: number; falsePositives: number; falseNegatives: number; precision: number; recall: number }[];
}

function safeDivide(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

async function scanOne(url: string): Promise<{ techIds: string[]; confidences: Map<string, number> } | SitePredictionError> {
  try {
    const rateLimiter = createRateLimiter({ globalRps: 2, perHostDelayMs: 1500 });
    const report = await scanUrlFast(url, { rateLimiter, save: false });
    const confidences = new Map(report.detections.map((d) => [d.techId, d.confidence]));
    return { techIds: report.detections.map((d) => d.techId), confidences };
  } catch (err) {
    return { url, error: err instanceof Error ? err.message : String(err) };
  }
}

function isError(x: unknown): x is SitePredictionError {
  return typeof x === "object" && x !== null && "error" in x;
}

async function evaluateGroundTruthSite(site: GroundTruthSite): Promise<SitePredictionResult | SitePredictionError> {
  const scanned = await scanOne(site.url);
  if (isError(scanned)) return scanned;

  const expectedSet = new Set(site.expectedTechIds);
  const detectedSet = new Set(scanned.techIds);
  const truePositives = site.expectedTechIds.filter((t) => detectedSet.has(t));
  const falsePositives = scanned.techIds.filter((t) => !expectedSet.has(t));
  const falseNegatives = site.expectedTechIds.filter((t) => !detectedSet.has(t));

  const confidenceSamples = truePositives.map((techId) => ({ techId, confidence: scanned.confidences.get(techId) ?? 0, correct: true }));

  return { url: site.url, expected: site.expectedTechIds, detected: scanned.techIds, truePositives, falsePositives, falseNegatives, confidenceSamples };
}

async function evaluateNegativeControl(site: NegativeControlSite): Promise<SitePredictionResult | SitePredictionError> {
  const scanned = await scanOne(site.url);
  if (isError(scanned)) return scanned;

  const detectedSet = new Set(scanned.techIds);
  const falsePositives = site.mustNotDetect.filter((t) => detectedSet.has(t));
  const confidenceSamples = falsePositives.map((techId) => ({ techId, confidence: scanned.confidences.get(techId) ?? 0, correct: false }));

  return { url: site.url, expected: [], detected: scanned.techIds, truePositives: [], falsePositives, falseNegatives: [], confidenceSamples };
}

/**
 * Scans every site in the bundled ground-truth set (real, hand-verified
 * sites — see data/ground-truth.json) with the CURRENT ruleset and compares
 * detections against each site's expected technologies and negative
 * controls' "must not detect" list. Hits the real network — this is a
 * small, infrequent evaluation run, not something to loop.
 */
export async function runGroundTruthEval(): Promise<GroundTruthEvalReport> {
  const groundTruth = loadGroundTruth();
  const sitesErrored: SitePredictionError[] = [];
  const perSite: SitePredictionResult[] = [];

  for (const site of groundTruth.sites) {
    const result = await evaluateGroundTruthSite(site);
    if (isError(result)) sitesErrored.push(result);
    else perSite.push(result);
  }
  for (const site of groundTruth.negativeControls) {
    const result = await evaluateNegativeControl(site);
    if (isError(result)) sitesErrored.push(result);
    else perSite.push(result);
  }

  let tp = 0;
  let fp = 0;
  let fn = 0;
  const perTech = new Map<string, { tp: number; fp: number; fn: number }>();
  const bump = (techId: string, field: "tp" | "fp" | "fn") => {
    const entry = perTech.get(techId) ?? { tp: 0, fp: 0, fn: 0 };
    entry[field]++;
    perTech.set(techId, entry);
  };

  for (const site of perSite) {
    for (const t of site.truePositives) {
      tp++;
      bump(t, "tp");
    }
    for (const t of site.falsePositives) {
      fp++;
      bump(t, "fp");
    }
    for (const t of site.falseNegatives) {
      fn++;
      bump(t, "fn");
    }
  }

  const precision = safeDivide(tp, tp + fp);
  const recall = safeDivide(tp, tp + fn);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    verifiedAsOf: groundTruth.verifiedAsOf,
    note: PRECISION_CAVEAT,
    sitesEvaluated: perSite.length,
    sitesErrored,
    perSite,
    overall: { precision, recall, f1, truePositives: tp, falsePositives: fp, falseNegatives: fn },
    perTechnology: [...perTech.entries()]
      .map(([techId, { tp, fp, fn }]) => ({ techId, truePositives: tp, falsePositives: fp, falseNegatives: fn, precision: safeDivide(tp, tp + fp), recall: safeDivide(tp, tp + fn) }))
      .sort((a, b) => a.techId.localeCompare(b.techId)),
  };
}
