import { getBulkJob, type BulkJobRecord } from "@adaiyalam/store";
import { lookupEol } from "@adaiyalam/vuln-data";
import { getRuleset } from "./scan.js";

export interface AggregateReport {
  sitesScanned: number;
  sitesWithErrors: number;
  /** Share of successfully-scanned sites running each technology. */
  techMarketShare: { techId: string; name: string; count: number; share: number }[];
  categoryShare: { categoryId: string; count: number; share: number }[];
  versionDistribution: { techId: string; name: string; versions: { version: string; count: number }[] }[];
  /** How often each pair of technologies co-occurs on the same site. */
  topCoOccurrences: { techA: string; techB: string; count: number }[];
  eolShare: { techId: string; name: string; eolCount: number; securityOnlyCount: number; totalWithVersion: number }[];
}

export function aggregateBulkJob(jobId: string): AggregateReport {
  const job = getBulkJob(jobId);
  if (!job) throw new Error(`No bulk job found with id ${jobId}`);
  return aggregateJobRecord(job);
}

export function aggregateJobRecord(job: BulkJobRecord): AggregateReport {
  const ruleset = getRuleset();
  const results = Object.values(job.results).filter((r) => r.status === "ok" && r.detections);
  const sitesScanned = results.length;
  const sitesWithErrors = Object.values(job.results).filter((r) => r.status === "error" || r.status === "blocked").length;

  const techCount = new Map<string, number>();
  const categoryCount = new Map<string, number>();
  const versionCount = new Map<string, Map<string, number>>();
  const coOccurrence = new Map<string, number>();
  const eolCount = new Map<string, { eol: number; securityOnly: number; withVersion: number }>();

  for (const result of results) {
    const detections = result.detections ?? [];
    const techIds = detections.map((d) => d.techId).sort();

    for (const d of detections) {
      techCount.set(d.techId, (techCount.get(d.techId) ?? 0) + 1);
      for (const cat of d.categories) categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1);

      if (d.version) {
        const versions = versionCount.get(d.techId) ?? new Map<string, number>();
        versions.set(d.version, (versions.get(d.version) ?? 0) + 1);
        versionCount.set(d.techId, versions);

        const eol = lookupEol(d.techId, d.version);
        const entry = eolCount.get(d.techId) ?? { eol: 0, securityOnly: 0, withVersion: 0 };
        entry.withVersion++;
        if (eol.status === "end-of-life") entry.eol++;
        if (eol.status === "security-only") entry.securityOnly++;
        eolCount.set(d.techId, entry);
      }
    }

    for (let i = 0; i < techIds.length; i++) {
      for (let j = i + 1; j < techIds.length; j++) {
        const key = `${techIds[i]}|${techIds[j]}`;
        coOccurrence.set(key, (coOccurrence.get(key) ?? 0) + 1);
      }
    }
  }

  const techName = (id: string) => ruleset.byId.get(id)?.name ?? id;

  return {
    sitesScanned,
    sitesWithErrors,
    techMarketShare: [...techCount.entries()]
      .map(([techId, count]) => ({ techId, name: techName(techId), count, share: sitesScanned > 0 ? count / sitesScanned : 0 }))
      .sort((a, b) => b.count - a.count),
    categoryShare: [...categoryCount.entries()]
      .map(([categoryId, count]) => ({ categoryId, count, share: sitesScanned > 0 ? count / sitesScanned : 0 }))
      .sort((a, b) => b.count - a.count),
    versionDistribution: [...versionCount.entries()].map(([techId, versions]) => ({
      techId,
      name: techName(techId),
      versions: [...versions.entries()].map(([version, count]) => ({ version, count })).sort((a, b) => b.count - a.count),
    })),
    topCoOccurrences: [...coOccurrence.entries()]
      .map(([key, count]) => {
        const [techA, techB] = key.split("|") as [string, string];
        return { techA, techB, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 50),
    eolShare: [...eolCount.entries()]
      .map(([techId, { eol, securityOnly, withVersion }]) => ({ techId, name: techName(techId), eolCount: eol, securityOnlyCount: securityOnly, totalWithVersion: withVersion }))
      .filter((e) => e.eolCount > 0 || e.securityOnlyCount > 0)
      .sort((a, b) => b.eolCount - a.eolCount),
  };
}
