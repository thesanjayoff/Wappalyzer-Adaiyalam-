import { z } from "zod";

/**
 * "App mode" is an adapter, not an APK decompiler: Adaiyalam does not parse
 * APK/IPA binaries itself. Point it at facts already extracted by a
 * reverse-engineering tool (apktool, jadx, aapt, or an agent's own binary-
 * analysis tools) in this shape, and it runs the same kind of
 * probabilistic, evidence-based fingerprint matching used for websites.
 */
export const APP_CATEGORIES = [
  "analytics",
  "advertising",
  "push-notifications",
  "payment",
  "attribution",
  "crash-reporting",
  "backend",
  "cross-platform-framework",
  "authentication",
  "social",
  "miscellaneous",
] as const;

export type AppCategory = (typeof APP_CATEGORIES)[number];

export interface ManifestMetaFact {
  name: string;
  value?: string;
}

/**
 * Facts about one app package, supplied by the caller (not collected by
 * Adaiyalam). Every field is something a reverse-engineering tool can
 * produce without executing the app: declared permissions and <meta-data>
 * entries from AndroidManifest.xml, the slash-separated class-name prefixes
 * observed in the dex string pool or decompiled class list, native library
 * filenames from the APK's lib/ directory, and any other extracted
 * human-readable strings (SDK version banners, embedded URLs).
 */
export interface AppFacts {
  packageName?: string;
  versionName?: string;
  permissions: string[];
  classPrefixes: string[];
  manifestMeta: ManifestMetaFact[];
  nativeLibs: string[];
  strings: string[];
  /** Free-text provenance, e.g. "jadx 1.5.0 decompile" or "aapt dump + strings classes.dex" — required so a report never implies Adaiyalam did the extraction itself. */
  source: string;
}

export const APP_SIGNAL_TYPES = ["permission", "classPrefix", "manifestMeta", "nativeLib", "string"] as const;
export type AppSignalType = (typeof APP_SIGNAL_TYPES)[number];

const confidenceSchema = z.number().int().min(1).max(100);

export const appEvidencePatternSchema = z.object({
  type: z.enum(APP_SIGNAL_TYPES),
  /** <meta-data> name, required for manifestMeta; unused for other types. */
  key: z.string().optional(),
  pattern: z.string().min(1),
  flags: z.string().regex(/^[gimsuy]*$/).default("i"),
  confidence: confidenceSchema.default(100),
  version: z.string().optional(),
  negative: z.boolean().default(false),
  note: z.string().optional(),
});
export type AppEvidencePattern = z.infer<typeof appEvidencePatternSchema>;

export const appFingerprintSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "id must be a lowercase kebab-case slug"),
  name: z.string().min(1),
  description: z.string().min(1).max(400),
  website: z.string().url(),
  categories: z.array(z.enum(APP_CATEGORIES)).min(1),
  implies: z.array(z.string()).default([]),
  evidence: z.array(appEvidencePatternSchema).min(1),
  notes: z.string().optional(),
});
export type AppFingerprintRule = z.infer<typeof appFingerprintSchema>;

export const appRuleFileSchema = z.object({
  technologies: z.array(appFingerprintSchema),
});

export interface AppEvidenceHit {
  patternIndex: number;
  matchedValue: string;
  confidence: number;
  negative: boolean;
  version?: string;
}

export interface AppDetectionResult {
  techId: string;
  name: string;
  categories: AppCategory[];
  confidence: number;
  version?: string;
  impliedBy: string[];
  hits: AppEvidenceHit[];
}
