import { getFacts, getSite } from "@adaiyalam/store";
import { replayScan } from "./scan.js";

export interface CompareSiteSnapshot {
  version?: string;
  confidence: number;
}

export interface CompareTechRow {
  techId: string;
  name: string;
  categories: string[];
  /** Keyed by hostname; undefined means that site doesn't have this technology. */
  presentIn: Record<string, CompareSiteSnapshot | undefined>;
}

export interface CompareResult {
  sites: { hostname: string; scanId: string; scannedAt: string }[];
  technologies: CompareTechRow[];
}

/**
 * Compares 2+ sites' most recent saved scans side by side, replaying each
 * against the current ruleset so the comparison isn't skewed by sites
 * having been scanned with different historical ruleset versions.
 */
export function compareSites(hostnames: string[]): CompareResult {
  const sites: CompareResult["sites"] = [];
  const perSiteDetections = new Map<string, Map<string, { name: string; categories: string[]; version?: string; confidence: number }>>();

  for (const hostname of hostnames) {
    const site = getSite(hostname);
    const latestScanId = site?.scanIds[0];
    if (!site || !latestScanId) {
      throw new Error(`No saved scan found for "${hostname}". Scan it first.`);
    }
    const facts = getFacts(latestScanId);
    if (!facts) throw new Error(`Snapshot missing for ${hostname}'s latest scan.`);

    const report = replayScan(facts);
    sites.push({ hostname, scanId: latestScanId, scannedAt: facts.collectedAt });

    const byTech = new Map<string, { name: string; categories: string[]; version?: string; confidence: number }>();
    for (const d of report.detections) {
      byTech.set(d.techId, { name: d.name, categories: d.categories, version: d.version?.value, confidence: d.confidence });
    }
    perSiteDetections.set(hostname, byTech);
  }

  const allTechIds = new Set<string>();
  for (const byTech of perSiteDetections.values()) for (const techId of byTech.keys()) allTechIds.add(techId);

  const technologies: CompareTechRow[] = [...allTechIds]
    .map((techId) => {
      const presentIn: Record<string, CompareSiteSnapshot | undefined> = {};
      let name = techId;
      let categories: string[] = [];
      for (const hostname of hostnames) {
        const detection = perSiteDetections.get(hostname)?.get(techId);
        if (detection) {
          name = detection.name;
          categories = detection.categories;
          presentIn[hostname] = { version: detection.version, confidence: detection.confidence };
        } else {
          presentIn[hostname] = undefined;
        }
      }
      return { techId, name, categories, presentIn };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { sites, technologies };
}
