import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "@adaiyalam/config";

export const KEV_SOURCE_URL = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json";

export interface KevEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  knownRansomwareCampaignUse?: string;
}

interface KevCacheFile {
  source: string;
  fetchedAt: string;
  catalogVersion?: string;
  count: number;
  vulnerabilities: KevEntry[];
}

function kevCachePath(): string {
  return join(PATHS.vulnData, "kev.json");
}

/**
 * Downloads the (small, single-file, keyless) CISA Known Exploited
 * Vulnerabilities catalog and caches it locally. This is a maintenance
 * operation the user runs explicitly (`adaiyalam vuln-data update-kev`),
 * never during an ordinary site scan — scans only ever read the local
 * cache, so scanning stays offline-capable and doesn't hammer CISA.
 */
export async function fetchAndCacheKev(timeoutMs = 15_000): Promise<{ count: number; fetchedAt: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(KEV_SOURCE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`KEV fetch failed: HTTP ${response.status}`);
    const body = (await response.json()) as { catalogVersion?: string; count: number; vulnerabilities: KevEntry[] };
    const cache: KevCacheFile = {
      source: KEV_SOURCE_URL,
      fetchedAt: new Date().toISOString(),
      catalogVersion: body.catalogVersion,
      count: body.count,
      vulnerabilities: body.vulnerabilities,
    };
    mkdirSync(PATHS.vulnData, { recursive: true });
    writeFileSync(kevCachePath(), JSON.stringify(cache, null, 2));
    return { count: cache.count, fetchedAt: cache.fetchedAt };
  } finally {
    clearTimeout(timer);
  }
}

let kevIndexCache: Map<string, KevEntry> | undefined;
let kevMeta: { source: string; fetchedAt: string } | undefined;

function ensureKevLoaded(): void {
  if (kevIndexCache) return;
  const path = kevCachePath();
  kevIndexCache = new Map();
  if (!existsSync(path)) return;
  try {
    const cache: KevCacheFile = JSON.parse(readFileSync(path, "utf-8"));
    kevMeta = { source: cache.source, fetchedAt: cache.fetchedAt };
    for (const entry of cache.vulnerabilities) {
      kevIndexCache.set(entry.cveID.toUpperCase(), entry);
    }
  } catch {
    // corrupt cache — treat as empty, user can re-run update-kev
  }
}

export function findKevEntry(cveId: string): KevEntry | undefined {
  ensureKevLoaded();
  return kevIndexCache?.get(cveId.toUpperCase());
}

export function kevCacheMeta(): { source: string; fetchedAt: string } | undefined {
  ensureKevLoaded();
  return kevMeta;
}

/** Test/dev hook to reset the in-memory cache after writing a new file. */
export function invalidateKevCache(): void {
  kevIndexCache = undefined;
  kevMeta = undefined;
}
