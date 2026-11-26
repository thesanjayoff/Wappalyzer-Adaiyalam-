/**
 * Normalized facts about a single page/site, produced by either the HTTP
 * (fast mode) or Playwright (full mode) collector. The matcher only ever
 * reads this shape, which is what keeps it pure, deterministic and
 * replayable: snapshot a `SiteFacts` object to disk and you can re-run the
 * matcher against it later with a newer ruleset, with no network access.
 */
export interface CookieFact {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None" | "unspecified";
  /** Set before any consent-banner interaction happened (browser mode only). */
  setBeforeConsent?: boolean;
}

export interface MetaFact {
  name?: string;
  property?: string;
  content: string;
}

export interface LinkFact {
  rel: string;
  href: string;
}

export interface DomQueryResult {
  exists: boolean;
  count: number;
  firstText?: string;
  attrs?: Record<string, string | undefined>;
}

export interface JsGlobalFact {
  exists: boolean;
  /** Stringified preview of the value (JSON.stringify, capped), used for regex/version matching. */
  valuePreview?: string;
  typeofValue?: string;
}

export interface ProbeFact {
  path: string;
  status: number;
  bodySnippet?: string;
  justification: string;
}

export interface NetworkRequestFact {
  url: string;
  domain: string;
  resourceType: string;
  /** Only set in browser mode: whether this request fired before a consent-banner interaction. */
  beforeConsent?: boolean;
}

export interface SiteFacts {
  requestedUrl: string;
  finalUrl: string;
  redirectChain: string[];
  statusCode: number;
  /** Lowercased header names, multi-values joined with ", ". */
  headers: Record<string, string>;
  cookies: CookieFact[];
  /** Raw HTML, capped (see collector MAX_HTML_BYTES). */
  html: string;
  htmlTruncated: boolean;
  metaTags: MetaFact[];
  scriptSrcs: string[];
  scriptInline: string[];
  /** Same scripts as `scriptSrcs`, with their `integrity` attribute if present — used for supply-chain hygiene checks. */
  scriptTags: { src: string; integrity?: string }[];
  linkTags: LinkFact[];
  /** Inline <style> bodies + fetched linked stylesheet bodies, capped. */
  cssText: string[];
  robotsTxt?: string;
  sitemapUrls?: string[];
  dns?: {
    cname?: string[];
    mx?: string[];
    txt?: string[];
    ns?: string[];
  };
  tlsIssuer?: string;
  tlsValid?: boolean;
  tlsProtocol?: string;
  faviconHash?: string;
  probes: Record<string, ProbeFact>;
  networkRequests: NetworkRequestFact[];

  /** Precomputed results for every DOM/CSS selector the active ruleset referenced, keyed by selector string. */
  domQueries: Record<string, DomQueryResult>;
  /** Precomputed results for every jsGlobal path the active ruleset referenced, keyed by dotted path. */
  jsGlobals: Record<string, JsGlobalFact>;

  mode: "fast" | "browser";
  /** True if this facts object was produced against the full ruleset's selector/global set (browser mode); false means DOM/JS-global based rules may be under-evaluated. */
  domCoverageComplete: boolean;

  consentBannerDetected?: boolean;
  consentInteraction?: "accepted" | "rejected" | "none";

  collectedAt: string;
  collectorVersion: string;
  errors: string[];
}

export function emptyFacts(url: string, mode: "fast" | "browser"): SiteFacts {
  return {
    requestedUrl: url,
    finalUrl: url,
    redirectChain: [],
    statusCode: 0,
    headers: {},
    cookies: [],
    html: "",
    htmlTruncated: false,
    metaTags: [],
    scriptSrcs: [],
    scriptInline: [],
    scriptTags: [],
    linkTags: [],
    cssText: [],
    probes: {},
    networkRequests: [],
    domQueries: {},
    jsGlobals: {},
    mode,
    domCoverageComplete: false,
    collectedAt: new Date().toISOString(),
    collectorVersion: "0",
    errors: [],
  };
}
