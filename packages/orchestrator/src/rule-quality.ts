import { listFalsePositiveReports, listScans } from "@adaiyalam/store";
import { getRuleset } from "./scan.js";

export interface RuleQualityEntry {
  techId: string;
  name: string;
  /** How many saved scans detected this technology at all. */
  timesDetected: number;
  /** Total saved scans considered (same denominator for every row, so rows are comparable). */
  totalScans: number;
  /** timesDetected / totalScans — 0 when there are no saved scans yet. */
  hitRate: number;
  falsePositiveReports: number;
}

/**
 * Local rule-quality signal built entirely from this installation's own
 * scan history and false-positive reports (see packages/store/feedback.ts)
 * — never sent anywhere, and not a substitute for the ground-truth
 * evaluation harness (packages/evaluation), which checks against hand-
 * verified sites rather than whatever the user happened to scan. A very
 * low hit rate isn't necessarily a bad rule (an uncommon technology is
 * supposed to rarely fire); a nonzero false-positive count is the more
 * actionable signal here.
 */
export function buildRuleQualityReport(): RuleQualityEntry[] {
  const scans = listScans();
  const totalScans = scans.length;
  const ruleset = getRuleset();
  const fpReports = listFalsePositiveReports();

  const detectionCounts = new Map<string, number>();
  for (const scan of scans) {
    for (const techId of scan.techIds) {
      detectionCounts.set(techId, (detectionCounts.get(techId) ?? 0) + 1);
    }
  }
  const fpCounts = new Map<string, number>();
  for (const report of fpReports) {
    fpCounts.set(report.techId, (fpCounts.get(report.techId) ?? 0) + 1);
  }

  return ruleset.rules
    .map((rule) => {
      const timesDetected = detectionCounts.get(rule.id) ?? 0;
      return {
        techId: rule.id,
        name: rule.name,
        timesDetected,
        totalScans,
        hitRate: totalScans > 0 ? timesDetected / totalScans : 0,
        falsePositiveReports: fpCounts.get(rule.id) ?? 0,
      };
    })
    .sort((a, b) => b.falsePositiveReports - a.falsePositiveReports || b.timesDetected - a.timesDetected);
}
