import { z } from "zod";
import { CATEGORY_IDS } from "./categories.js";

/**
 * Fingerprint rule schema, version 1.
 *
 * This is Adaiyalam's own format: written from scratch, not copied from any
 * third-party ruleset. See docs/RULE_SCHEMA.md for the authoring guide.
 */
export const SCHEMA_VERSION = 1;

export const SIGNAL_TYPES = [
  "header",
  "cookie",
  "meta",
  "scriptSrc",
  "scriptInline",
  "domExists",
  "domAttr",
  "domText",
  "jsGlobal",
  "css",
  "url",
  "robots",
  "dns",
  "tlsIssuer",
  "faviconHash",
  "html",
  "probe",
] as const;

export type SignalType = (typeof SIGNAL_TYPES)[number];

/** Signal types that are only observable in browser (Playwright) mode. */
export const BROWSER_ONLY_SIGNALS = new Set<SignalType>(["domExists", "domAttr", "domText", "jsGlobal", "css"]);

const confidenceSchema = z.number().int().min(1).max(100);

/**
 * A single pattern that can match against a fact of the given `type`.
 *
 * - `pattern` is a regex source (no literal-string shortcut) so authors are
 *   explicit about anchoring; use `escapeRegex()` from the engine for exact
 *   literal matches.
 * - `version` is an optional template like "$1" / "$1.$2" referencing regex
 *   capture groups, used for version extraction.
 * - `negative: true` means "if this matches, suppress/penalize the rule"
 *   rather than confirm it (used to cut down false positives from a
 *   near-identical competing technology).
 */
export const evidencePatternSchema = z.object({
  type: z.enum(SIGNAL_TYPES),
  /** Header name, cookie name, meta name/property, DOM selector, JS global path, DNS record type ("CNAME"|"MX"|"TXT"|"NS"), probe path. Not used for html/url/tlsIssuer. */
  key: z.string().optional(),
  /** For domAttr: which attribute to read. */
  attr: z.string().optional(),
  pattern: z.string(),
  flags: z.string().regex(/^[gimsuy]*$/).default("i"),
  confidence: confidenceSchema.default(100),
  version: z.string().optional(),
  negative: z.boolean().default(false),
  /** Free-text note on why this pattern is safe/selective, shown in `rule lint`. */
  note: z.string().optional(),
});

export type EvidencePattern = z.infer<typeof evidencePatternSchema>;

const impliesEntrySchema = z.union([
  z.string(),
  z.object({ id: z.string(), confidence: confidenceSchema.default(100) }),
]);

export type ImpliesEntry = z.infer<typeof impliesEntrySchema>;

export const fingerprintSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "id must be a lowercase kebab-case slug"),
  name: z.string().min(1),
  description: z.string().min(1).max(400),
  website: z.string().url(),
  categories: z.array(z.string().refine((c) => CATEGORY_IDS.has(c), "unknown category id")).min(1),
  icon: z.string().optional(),
  pricing: z.array(z.enum(["free", "freemium", "paid", "open-source"])).default([]),
  openSource: z.boolean().optional(),
  saas: z.boolean().optional(),
  /** CPE 2.3 template, e.g. "cpe:2.3:a:wordpress:wordpress:{version}:*:*:*:*:*:*:*". */
  cpe: z.string().optional(),
  implies: z.array(impliesEntrySchema).default([]),
  requires: z.array(z.string()).default([]),
  excludes: z.array(z.string()).default([]),
  evidence: z.array(evidencePatternSchema).min(1),
  /** Rule author notes, changelog pointer, etc. Not shown to end users. */
  notes: z.string().optional(),
});

export type FingerprintRule = z.infer<typeof fingerprintSchema>;

export const ruleFileSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  technologies: z.array(fingerprintSchema),
});

export type RuleFile = z.infer<typeof ruleFileSchema>;
