import { getFacts, getScan, getSite, type ScanRecord } from "@adaiyalam/store";
import { replayScan } from "./scan.js";

export interface DetectionSnapshot {
  version?: string;
  confidence: number;
}

export interface DetectionDiffEntry {
  techId: string;
  name: string;
  categories: string[];
  change: "added" | "removed" | "version-changed" | "confidence-changed" | "unchanged";
  before?: DetectionSnapshot;
  after?: DetectionSnapshot;
}

export interface ScanDiff {
  hostname: string;
  before: { scanId: string; scannedAt: string };
  after: { scanId: string; scannedAt: string };
  entries: DetectionDiffEntry[];
  summary: { added: number; removed: number; versionChanged: number; confidenceChanged: number; unchanged: number };
}

/**
 * Diffs two saved scans of (presumably) the same site by replaying BOTH of
 * their raw-facts snapshots against the CURRENT ruleset, so differences
 * reflect real changes on the site rather than ruleset drift between the
 * two original scan dates.
 */
export function diffScans(beforeScanId: string, afterScanId: string): ScanDiff {
  const beforeScan = getScan(beforeScanId);
  const afterScan = getScan(afterScanId);
  const beforeFacts = getFacts(beforeScanId);
  const afterFacts = getFacts(afterScanId);
  if (!beforeScan || !afterScan || !beforeFacts || !afterFacts) {
    throw new Error("One or both scan IDs were not found (or their snapshot is missing).");
  }

  const beforeReport = replayScan(beforeFacts);
  const afterReport = replayScan(afterFacts);

  const beforeByTech = new Map(beforeReport.detections.map((d) => [d.techId, d]));
  const afterByTech = new Map(afterReport.detections.map((d) => [d.techId, d]));
  const allTechIds = new Set([...beforeByTech.keys(), ...afterByTech.keys()]);

  const entries: DetectionDiffEntry[] = [];
  for (const techId of allTechIds) {
    const before = beforeByTech.get(techId);
    const after = afterByTech.get(techId);

    if (!before && after) {
      entries.push({ techId, name: after.name, categories: after.categories, change: "added", after: { version: after.version?.value, confidence: after.confidence } });
    } else if (before && !after) {
      entries.push({ techId, name: before.name, categories: before.categories, change: "removed", before: { version: before.version?.value, confidence: before.confidence } });
    } else if (before && after) {
      const beforeSnap = { version: before.version?.value, confidence: before.confidence };
      const afterSnap = { version: after.version?.value, confidence: after.confidence };
      let change: DetectionDiffEntry["change"] = "unchanged";
      if (beforeSnap.version !== afterSnap.version) change = "version-changed";
      else if (beforeSnap.confidence !== afterSnap.confidence) change = "confidence-changed";
      entries.push({ techId, name: after.name, categories: after.categories, change, before: beforeSnap, after: afterSnap });
    }
  }

  entries.sort((a, b) => a.techId.localeCompare(b.techId));

  return {
    hostname: afterScan.hostname,
    before: { scanId: beforeScan.id, scannedAt: beforeScan.scannedAt },
    after: { scanId: afterScan.id, scannedAt: afterScan.scannedAt },
    entries,
    summary: {
      added: entries.filter((e) => e.change === "added").length,
      removed: entries.filter((e) => e.change === "removed").length,
      versionChanged: entries.filter((e) => e.change === "version-changed").length,
      confidenceChanged: entries.filter((e) => e.change === "confidence-changed").length,
      unchanged: entries.filter((e) => e.change === "unchanged").length,
    },
  };
}

/** Diffs a site's two most recent saved scans. Returns undefined if it has fewer than two. */
export function diffSiteLatest(hostname: string): ScanDiff | undefined {
  const site = getSite(hostname);
  if (!site || site.scanIds.length < 2) return undefined;
  const [afterId, beforeId] = site.scanIds as [string, string];
  return diffScans(beforeId, afterId);
}

export function hasMeaningfulChange(diff: ScanDiff): boolean {
  return diff.summary.added > 0 || diff.summary.removed > 0 || diff.summary.versionChanged > 0;
}

export function latestTwoScans(hostname: string): [ScanRecord, ScanRecord] | undefined {
  const site = getSite(hostname);
  if (!site || site.scanIds.length < 2) return undefined;
  const after = getScan(site.scanIds[0]!);
  const before = getScan(site.scanIds[1]!);
  if (!after || !before) return undefined;
  return [before, after];
}
