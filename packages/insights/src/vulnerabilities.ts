import type { DetectionResult } from "@adaiyalam/engine";
import { findKevEntry, loadCachedOsv, lookupEol } from "@adaiyalam/vuln-data";

export interface RuleVulnMeta {
  cpe?: string;
  osvPackage?: { ecosystem: string; name: string };
}

export interface VulnHint {
  techId: string;
  name: string;
  version?: string;
  source: "osv" | "eol";
  id?: string;
  summary?: string;
  severity?: string;
  kev?: boolean;
  kevDateAdded?: string;
  eolStatus?: string;
  eolDetail?: string;
  disclaimer: string;
}

const DISCLAIMER =
  "Based on a version inferred from passive signals, which can be wrong (outdated, backported patches, custom builds). This is a possible-exposure hint, not a confirmed finding.";

export function analyzeVulnerabilities(detections: DetectionResult[], ruleMeta: (techId: string) => RuleVulnMeta | undefined): VulnHint[] {
  const hints: VulnHint[] = [];

  for (const detection of detections) {
    const version = detection.version?.value;
    const meta = ruleMeta(detection.techId);

    if (version && meta?.osvPackage) {
      const cached = loadCachedOsv(meta.osvPackage.ecosystem, meta.osvPackage.name, version);
      for (const vuln of cached?.vulns ?? []) {
        const cveAlias = vuln.aliases?.find((a) => a.startsWith("CVE-"));
        const kevEntry = cveAlias ? findKevEntry(cveAlias) : undefined;
        hints.push({
          techId: detection.techId,
          name: detection.name,
          version,
          source: "osv",
          id: vuln.id,
          summary: vuln.summary,
          severity: vuln.databaseSpecificSeverity,
          kev: Boolean(kevEntry),
          kevDateAdded: kevEntry?.dateAdded,
          disclaimer: DISCLAIMER,
        });
      }
    }

    const eol = lookupEol(detection.techId, version);
    if (eol.status === "end-of-life" || eol.status === "security-only") {
      hints.push({
        techId: detection.techId,
        name: detection.name,
        version,
        source: "eol",
        eolStatus: eol.status,
        eolDetail: eol.source ? `Per ${eol.source} (schedule as of ${eol.asOf}).` : eol.note,
        disclaimer: "End-of-life status depends on the detected version being correct — verify independently before acting.",
      });
    } else if (eol.note) {
      // e.g. WordPress/jQuery's "no fixed schedule" explanatory notes — informational, not an alarm.
      hints.push({
        techId: detection.techId,
        name: detection.name,
        version,
        source: "eol",
        eolStatus: "unknown",
        eolDetail: eol.note,
        disclaimer: DISCLAIMER,
      });
    }
  }

  return hints;
}
