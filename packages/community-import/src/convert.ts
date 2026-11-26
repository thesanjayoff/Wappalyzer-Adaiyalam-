import type { CommunityPackFile, CommunityPackTechnology, ConversionResult, ConversionWarning } from "./types.js";

export interface ConvertOptions {
  /** Shown in every generated rule's `notes` field so provenance is never lost. Required — this is the whole point of "license-displayed". */
  sourceLabel: string;
  /** Default confidence (1-100) applied to every imported signal, since imported packs rarely carry Adaiyalam-comparable confidence numbers. Kept low on purpose. */
  defaultConfidence?: number;
}

const DEFAULT_CONFIDENCE = 50;

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "imported-unknown";
}

/**
 * Many community packs encode extra metadata inline in the pattern string
 * using a "\;key:value" suffix convention, e.g. "WordPress \\;version:\\1"
 * or "confidence:50". We split on that delimiter and treat the first
 * segment as the regex; any "confidence:" or "version:" segment overrides
 * the defaults. Anything else after "\;" is ignored (we don't guess at
 * fields we don't recognize).
 */
function parseVendorPattern(raw: string, defaultConfidence: number): { pattern: string; confidence: number; version?: string } {
  const segments = raw.split("\\;");
  const pattern = segments[0] ?? "";
  let confidence = defaultConfidence;
  let version: string | undefined;
  for (const segment of segments.slice(1)) {
    const [key, ...rest] = segment.split(":");
    const value = rest.join(":");
    if (key === "confidence") {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) confidence = parsed;
    } else if (key === "version") {
      version = value;
    }
  }
  return { pattern, confidence, version };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function convertOne(name: string, tech: CommunityPackTechnology, options: ConvertOptions, warnings: ConversionWarning[]): unknown {
  const id = slugify(name);
  const confidenceDefault = options.defaultConfidence ?? DEFAULT_CONFIDENCE;
  const evidence: Record<string, unknown>[] = [];

  for (const [header, raw] of Object.entries(tech.headers ?? {})) {
    const { pattern, confidence, version } = parseVendorPattern(raw, confidenceDefault);
    evidence.push({ type: "header", key: header.toLowerCase(), pattern, confidence, version });
  }
  for (const raw of toArray(tech.html)) {
    const { pattern, confidence, version } = parseVendorPattern(raw, confidenceDefault);
    evidence.push({ type: "html", pattern, confidence, version });
  }
  for (const raw of toArray(tech.scriptSrc)) {
    const { pattern, confidence, version } = parseVendorPattern(raw, confidenceDefault);
    evidence.push({ type: "scriptSrc", pattern, confidence, version });
  }
  for (const raw of toArray(tech.script)) {
    const { pattern, confidence, version } = parseVendorPattern(raw, confidenceDefault);
    evidence.push({ type: "scriptInline", pattern, confidence, version });
  }
  for (const [cookie, raw] of Object.entries(tech.cookies ?? {})) {
    const { pattern, confidence, version } = parseVendorPattern(raw || ".*", confidenceDefault);
    evidence.push({ type: "cookie", key: cookie, pattern, confidence, version });
  }
  for (const [metaName, rawValue] of Object.entries(tech.meta ?? {})) {
    for (const raw of toArray(rawValue)) {
      const { pattern, confidence, version } = parseVendorPattern(raw || ".*", confidenceDefault);
      evidence.push({ type: "meta", key: metaName, pattern, confidence, version });
    }
  }
  for (const [globalPath, raw] of Object.entries(tech.js ?? {})) {
    const { confidence } = parseVendorPattern(raw || ".*", confidenceDefault);
    evidence.push({ type: "jsGlobal", key: globalPath, pattern: ".*", confidence });
  }
  for (const raw of toArray(tech.url)) {
    const { pattern, confidence, version } = parseVendorPattern(raw, confidenceDefault);
    evidence.push({ type: "url", pattern, confidence, version });
  }

  if (tech.dom !== undefined) {
    warnings.push({ techName: name, message: "a `dom` selector field was present but is not converted (format too variable to convert confidently) — add DOM evidence by hand if needed" });
  }
  if (tech.cats?.length) {
    warnings.push({ techName: name, message: `numeric category ids ${JSON.stringify(tech.cats)} were not mapped (no stable public mapping) — defaulted to "miscellaneous", pick real categories by hand` });
  }

  let website = tech.website;
  if (!website || !/^https?:\/\//.test(website)) {
    warnings.push({ techName: name, message: "missing or invalid `website` — set to a placeholder, fill in the real one before trusting this rule" });
    website = "https://example.com";
  }

  return {
    schemaVersion: 1,
    id,
    name,
    description: tech.description?.slice(0, 400) || `Imported from a community fingerprint pack. Review and rewrite this description.`,
    website,
    categories: ["miscellaneous"],
    icon: tech.icon,
    implies: toArray(tech.implies).map(slugify),
    requires: toArray(tech.requires).map(slugify),
    excludes: toArray(tech.excludes).map(slugify),
    cpe: tech.cpe,
    evidence: evidence.length > 0 ? evidence : [{ type: "html", pattern: "$NEVER_MATCH_PLACEHOLDER$", confidence: 1, negative: false }],
    notes: `Imported, not hand-verified. Source: ${options.sourceLabel}. All confidence values are provisional defaults, not independently assessed — treat this rule as a draft and run "adaiyalam rule lint" plus real fixtures before trusting it.`,
  };
}

/**
 * Converts a community fingerprint pack into Adaiyalam's own rule shape.
 * This is a format converter, not a bundled ruleset: callers must provide
 * their own copy of the source file, under its own license, and
 * `options.sourceLabel` is required precisely so that provenance/license
 * attribution travels with every converted rule (see docs/COMMUNITY_IMPORT.md).
 * The caller is responsible for actually displaying/confirming the license
 * before calling this — see the CLI's `import community-pack` command.
 */
export function convertCommunityPack(file: CommunityPackFile, options: ConvertOptions): ConversionResult {
  const warnings: ConversionWarning[] = [];
  const skipped: { techName: string; reason: string }[] = [];
  const rules: { id: string; rule: unknown }[] = [];

  for (const [name, tech] of Object.entries(file)) {
    if (!tech || typeof tech !== "object") {
      skipped.push({ techName: name, reason: "not an object" });
      continue;
    }
    const hasAnySignal = tech.headers || tech.html || tech.scriptSrc || tech.script || tech.cookies || tech.meta || tech.js || tech.url;
    if (!hasAnySignal) {
      skipped.push({ techName: name, reason: "no convertible signal fields found (headers/html/scriptSrc/script/cookies/meta/js/url)" });
      continue;
    }
    rules.push({ id: slugify(name), rule: convertOne(name, tech, options, warnings) });
  }

  return { rules, warnings, skipped };
}
