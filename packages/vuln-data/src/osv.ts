import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "@adaiyalam/config";

export const OSV_QUERY_URL = "https://api.osv.dev/v1/query";

export interface OsvVulnerability {
  id: string;
  summary?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  databaseSpecificSeverity?: string;
  affectedRanges?: { introduced?: string; fixed?: string }[];
  references?: string[];
}

interface OsvCacheFile {
  ecosystem: string;
  name: string;
  source: string;
  fetchedAt: string;
  byVersion: Record<string, OsvVulnerability[]>;
}

function osvDir(): string {
  return join(PATHS.vulnData, "osv");
}

function cacheFileName(ecosystem: string, name: string): string {
  return join(osvDir(), `${ecosystem}__${name.replace(/[/@]/g, "_")}.json`);
}

function normalizeOsvResult(raw: unknown): OsvVulnerability[] {
  const vulns = (raw as { vulns?: unknown[] }).vulns ?? [];
  return vulns.map((v) => {
    const vuln = v as Record<string, unknown>;
    const affected = (vuln.affected as Array<{ ranges?: Array<{ events?: Array<{ introduced?: string; fixed?: string }> }> }>) ?? [];
    const affectedRanges = affected.flatMap(
      (a) =>
        a.ranges?.flatMap((r) => {
          const introduced = r.events?.find((e) => e.introduced !== undefined)?.introduced;
          const fixed = r.events?.find((e) => e.fixed !== undefined)?.fixed;
          return fixed || introduced ? [{ introduced, fixed }] : [];
        }) ?? []
    );
    return {
      id: String(vuln.id),
      summary: vuln.summary as string | undefined,
      aliases: vuln.aliases as string[] | undefined,
      databaseSpecificSeverity: (vuln.database_specific as { severity?: string } | undefined)?.severity,
      affectedRanges,
      references: ((vuln.references as Array<{ url: string }> | undefined) ?? []).map((r) => r.url),
    };
  });
}

/**
 * Queries OSV.dev (free, keyless) for one package+version and merges the
 * result into that package's local cache file. Like KEV, this is a
 * maintenance action run explicitly via `adaiyalam vuln-data update-osv`,
 * never during a normal scan.
 */
export async function queryAndCacheOsv(ecosystem: string, name: string, version: string, timeoutMs = 10_000): Promise<OsvVulnerability[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let vulns: OsvVulnerability[];
  try {
    const response = await fetch(OSV_QUERY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ package: { name, ecosystem }, version }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`OSV query failed: HTTP ${response.status}`);
    vulns = normalizeOsvResult(await response.json());
  } finally {
    clearTimeout(timer);
  }

  mkdirSync(osvDir(), { recursive: true });
  const path = cacheFileName(ecosystem, name);
  const existing: OsvCacheFile = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8"))
    : { ecosystem, name, source: OSV_QUERY_URL, fetchedAt: new Date().toISOString(), byVersion: {} };
  existing.byVersion[version] = vulns;
  existing.fetchedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(existing, null, 2));
  return vulns;
}

export function loadCachedOsv(ecosystem: string, name: string, version: string): { vulns: OsvVulnerability[]; fetchedAt: string } | undefined {
  const path = cacheFileName(ecosystem, name);
  if (!existsSync(path)) return undefined;
  try {
    const cache: OsvCacheFile = JSON.parse(readFileSync(path, "utf-8"));
    const vulns = cache.byVersion[version];
    return vulns ? { vulns, fetchedAt: cache.fetchedAt } : undefined;
  } catch {
    return undefined;
  }
}
