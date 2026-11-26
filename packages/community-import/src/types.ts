/**
 * The input shape this converter understands: a best-effort subset of the
 * long-standing, widely-documented "apps.json"-style community fingerprint
 * format (technology name -> signal object). Adaiyalam does not bundle or
 * ship any file in this format — the caller supplies their own copy of a
 * third-party pack, under that pack's own license, and this converter turns
 * it into Adaiyalam's own rule schema (see @adaiyalam/schema). Fields this
 * converter isn't confident it understands correctly (notably the newer,
 * more complex `dom` selector object) are deliberately left unsupported
 * rather than guessed at.
 */
export interface CommunityPackTechnology {
  cats?: number[];
  icon?: string;
  website?: string;
  description?: string;
  headers?: Record<string, string>;
  html?: string | string[];
  scriptSrc?: string | string[];
  script?: string | string[];
  cookies?: Record<string, string>;
  meta?: Record<string, string | string[]>;
  js?: Record<string, string>;
  url?: string | string[];
  implies?: string | string[];
  requires?: string | string[];
  excludes?: string | string[];
  cpe?: string;
  /** Present in some packs; deliberately not converted (format too variable to convert confidently). */
  dom?: unknown;
}

export type CommunityPackFile = Record<string, CommunityPackTechnology>;

export interface ConvertedRule {
  id: string;
  rule: unknown;
}

export interface ConversionWarning {
  techName: string;
  message: string;
}

export interface ConversionResult {
  rules: ConvertedRule[];
  warnings: ConversionWarning[];
  skipped: { techName: string; reason: string }[];
}
