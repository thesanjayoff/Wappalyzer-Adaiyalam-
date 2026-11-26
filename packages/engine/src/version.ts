export type VersionConfidence = "exact" | "inferred" | "range" | "unknown";

export interface VersionObservation {
  value: string;
  confidence: VersionConfidence;
  /** evidence index / description this came from, for the report. */
  source: string;
  weight: number;
}

/** Substitutes $1, $2, ... in a template with capture groups from a regex match. */
export function applyVersionTemplate(template: string, match: RegExpMatchArray): string | undefined {
  const value = template.replace(/\$(\d+)/g, (_, idx: string) => match[Number(idx)] ?? "");
  const trimmed = value.trim().replace(/^[.\s]+|[.\s]+$/g, "");
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * A signal type's inherent reliability for version extraction. Values read
 * directly from a library/runtime (jsGlobal, faviconHash) are trustworthy;
 * values scraped out of free-text HTML are not.
 */
const SIGNAL_VERSION_RELIABILITY: Record<string, VersionConfidence> = {
  jsGlobal: "exact",
  header: "exact",
  meta: "exact",
  domAttr: "exact",
  cookie: "inferred",
  scriptSrc: "inferred",
  scriptInline: "inferred",
  domText: "inferred",
  css: "inferred",
  html: "inferred",
  url: "range",
  robots: "range",
  dns: "range",
  tlsIssuer: "range",
  faviconHash: "exact",
  probe: "inferred",
};

export function reliabilityForSignal(signalType: string): VersionConfidence {
  return SIGNAL_VERSION_RELIABILITY[signalType] ?? "inferred";
}

/** Picks the best version string out of several observations made for one technology. */
export function reconcileVersions(observations: VersionObservation[]): { value?: string; confidence: VersionConfidence } {
  if (observations.length === 0) return { confidence: "unknown" };
  const rank: Record<VersionConfidence, number> = { exact: 3, inferred: 2, range: 1, unknown: 0 };
  const sorted = [...observations].sort((a, b) => rank[b.confidence] - rank[a.confidence] || b.weight - a.weight);
  const best = sorted[0];
  if (!best) return { confidence: "unknown" };
  const disagreement = sorted.some((o) => o.value !== best.value);
  return {
    value: best.value,
    confidence: disagreement && best.confidence === "exact" ? "inferred" : best.confidence,
  };
}
