import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "@adaiyalam/config";
import type { SiteFacts } from "@adaiyalam/engine";
import type { ScanRecord, ScanReportInput, SiteRecord, StoreIndex } from "./types.js";

const INDEX_FILE = join(PATHS.home, "scans.json");

function ensureDirs(): void {
  mkdirSync(PATHS.home, { recursive: true });
  mkdirSync(PATHS.snapshots, { recursive: true });
}

function loadIndex(): StoreIndex {
  if (!existsSync(INDEX_FILE)) return { scans: [], sites: {} };
  try {
    return JSON.parse(readFileSync(INDEX_FILE, "utf-8")) as StoreIndex;
  } catch {
    return { scans: [], sites: {} };
  }
}

function saveIndex(index: StoreIndex): void {
  ensureDirs();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

function snapshotPath(id: string): string {
  return join(PATHS.snapshots, `${id}.json`);
}

/**
 * Persists one scan's raw facts (for offline replay against a future
 * ruleset — see `replayScan`) plus a lightweight index record used by the
 * dashboard and change detection. Single-process, last-write-wins: fine for
 * a local single-user tool, not safe for multiple processes writing
 * concurrently (documented limitation).
 */
export function recordScan(report: ScanReportInput, facts: SiteFacts): ScanRecord {
  ensureDirs();
  const id = randomUUID();
  writeFileSync(snapshotPath(id), JSON.stringify(facts, null, 2));

  const hostname = safeHostname(report.finalUrl) ?? safeHostname(report.url) ?? report.url;
  const record: ScanRecord = {
    id,
    url: report.url,
    finalUrl: report.finalUrl,
    hostname,
    mode: report.mode,
    scannedAt: report.scannedAt,
    statusCode: report.statusCode,
    rulesetVersion: report.rulesetVersion,
    techIds: report.techIds,
    detectionCount: report.techIds.length,
    errors: report.errors,
  };

  const index = loadIndex();
  index.scans.unshift(record);
  const site = index.sites[hostname] ?? { hostname, tags: [], notes: "", scanIds: [] };
  site.scanIds.unshift(id);
  index.sites[hostname] = site;
  saveIndex(index);

  return record;
}

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

export function listScans(filter?: { hostname?: string }): ScanRecord[] {
  const index = loadIndex();
  if (filter?.hostname) return index.scans.filter((s) => s.hostname === filter.hostname);
  return index.scans;
}

export function getScan(id: string): ScanRecord | undefined {
  return loadIndex().scans.find((s) => s.id === id);
}

export function getFacts(id: string): SiteFacts | undefined {
  const path = snapshotPath(id);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as SiteFacts;
}

export function listSites(): SiteRecord[] {
  return Object.values(loadIndex().sites);
}

export function getSite(hostname: string): SiteRecord | undefined {
  return loadIndex().sites[hostname];
}

export function tagSite(hostname: string, tags: string[]): void {
  const index = loadIndex();
  const site = index.sites[hostname];
  if (!site) return;
  site.tags = tags;
  saveIndex(index);
}

export function noteSite(hostname: string, notes: string): void {
  const index = loadIndex();
  const site = index.sites[hostname];
  if (!site) return;
  site.notes = notes;
  saveIndex(index);
}

/** Deletes one scan's snapshot and index entry. Does not touch other scans of the same site. */
export function deleteScan(id: string): void {
  const index = loadIndex();
  index.scans = index.scans.filter((s) => s.id !== id);
  for (const site of Object.values(index.sites)) {
    site.scanIds = site.scanIds.filter((s) => s !== id);
  }
  saveIndex(index);
  const path = snapshotPath(id);
  if (existsSync(path)) rmSync(path);
}

/** Deletes a whole site's scan history and snapshots (per-site deletion, see README privacy notes). */
export function deleteSite(hostname: string): void {
  const index = loadIndex();
  const site = index.sites[hostname];
  if (!site) return;
  for (const id of site.scanIds) {
    const path = snapshotPath(id);
    if (existsSync(path)) rmSync(path);
  }
  index.scans = index.scans.filter((s) => s.hostname !== hostname);
  delete index.sites[hostname];
  saveIndex(index);
}

export function storeDiagnostics(): { home: string; scanCount: number; siteCount: number; snapshotFileCount: number } {
  const index = loadIndex();
  const snapshotFileCount = existsSync(PATHS.snapshots) ? readdirSync(PATHS.snapshots).length : 0;
  return { home: PATHS.home, scanCount: index.scans.length, siteCount: Object.keys(index.sites).length, snapshotFileCount };
}
