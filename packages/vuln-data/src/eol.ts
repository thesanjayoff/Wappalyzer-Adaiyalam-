import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "eol.json");

interface EolCycle {
  versionRange: string;
  activeSupportUntil: string;
  securitySupportUntil: string;
}

interface EolTechEntry {
  techId: string;
  source: string;
  cycles: EolCycle[];
}

interface EolDataFile {
  asOf: string;
  disclaimer: string;
  technologies: EolTechEntry[];
  noFixedScheduleNotes: { techId: string; note: string }[];
}

let cached: EolDataFile | undefined;

function load(): EolDataFile {
  if (!cached) cached = JSON.parse(readFileSync(DATA_PATH, "utf-8"));
  return cached as EolDataFile;
}

export interface EolResult {
  status: "active" | "security-only" | "end-of-life" | "unknown";
  activeSupportUntil?: string;
  securitySupportUntil?: string;
  source?: string;
  asOf: string;
  note?: string;
}

/** Minimal semver-ish range check supporting ">=x.y.z <a.b.c" (the only shape used in eol.json). */
function versionInRange(version: string, range: string): boolean {
  const parts = range.split(/\s+/);
  return parts.every((part) => {
    const match = /^(>=|<=|>|<)(.+)$/.exec(part);
    if (!match) return true;
    const [, op, bound] = match;
    const cmp = compareVersions(version, bound as string);
    switch (op) {
      case ">=":
        return cmp >= 0;
      case "<=":
        return cmp <= 0;
      case ">":
        return cmp > 0;
      case "<":
        return cmp < 0;
      default:
        return true;
    }
  });
}

function compareVersions(a: string, b: string): number {
  const partsA = a.split(".").map(Number);
  const partsB = b.split(".").map(Number);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsA[i] ?? 0) - (partsB[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export function lookupEol(techId: string, version: string | undefined, now: Date = new Date()): EolResult {
  const data = load();
  const fixedNote = data.noFixedScheduleNotes.find((n) => n.techId === techId);
  if (fixedNote) {
    return { status: "unknown", asOf: data.asOf, note: fixedNote.note };
  }

  const tech = data.technologies.find((t) => t.techId === techId);
  if (!tech || !version) return { status: "unknown", asOf: data.asOf };

  const cycle = tech.cycles.find((c) => versionInRange(version, c.versionRange));
  if (!cycle) return { status: "unknown", asOf: data.asOf, source: tech.source };

  const nowIso = now.toISOString().slice(0, 10);
  let status: EolResult["status"] = "active";
  if (nowIso > cycle.securitySupportUntil) status = "end-of-life";
  else if (nowIso > cycle.activeSupportUntil) status = "security-only";

  return {
    status,
    activeSupportUntil: cycle.activeSupportUntil,
    securitySupportUntil: cycle.securitySupportUntil,
    source: tech.source,
    asOf: data.asOf,
  };
}
