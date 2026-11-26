import { buildUserAgent } from "@adaiyalam/config";
import { emptyFacts, truncate, type SiteFacts } from "@adaiyalam/engine";
import { safeFetch } from "../net/http-client.js";
import { parseSetCookies } from "../net/cookies.js";
import { parseRobotsTxt, isAllowedByRobots, type RobotsRules } from "../net/robots.js";
import { createRateLimiter, type RateLimiter, DEFAULT_RATE_LIMIT, type RateLimitConfig } from "../net/rate-limiter.js";
import { collectDnsRecords, collectTlsInfo, hashFavicon } from "../net/dns-tls.js";
import { evaluateDomSelectors, parseHtml } from "./html.js";
import type { SsrfOptions } from "../net/ssrf.js";

export const COLLECTOR_VERSION = "1";
export const APP_VERSION = "0.1.0";

export interface ProbeSpec {
  path: string;
  justification: string;
}

export interface FastCollectOptions {
  rateLimiter?: RateLimiter;
  rateLimit?: RateLimitConfig;
  ssrf?: SsrfOptions;
  timeoutMs?: number;
  /** Selectors/attrs/jsGlobal paths the active ruleset references (from `collectBrowserTargets`). */
  domSelectors?: Iterable<string>;
  domAttrsBySelector?: Map<string, Set<string>>;
  jsGlobalCount?: number;
  maxStylesheets?: number;
  /** Minimal probe mode: opt-in, hard-capped, justified file requests. Off by default. */
  probes?: ProbeSpec[];
  maxProbes?: number;
}

const DEFAULT_MAX_STYLESHEETS = 5;
const DEFAULT_MAX_PROBES = 5;

async function fetchRobots(origin: string, rateLimiter: RateLimiter, ssrf?: SsrfOptions): Promise<RobotsRules> {
  const host = new URL(origin).hostname;
  await rateLimiter.schedule(host);
  const result = await safeFetch(`${origin}/robots.txt`, {
    headers: { "user-agent": buildUserAgent(APP_VERSION) },
    timeoutMs: 8000,
    ssrf,
  });
  if (result.statusCode !== 200) return { groups: [], sitemaps: [] };
  return parseRobotsTxt(result.body);
}

export async function collectFast(targetUrl: string, options: FastCollectOptions = {}): Promise<SiteFacts> {
  const facts = emptyFacts(targetUrl, "fast");
  facts.collectorVersion = COLLECTOR_VERSION;
  const rateLimiter = options.rateLimiter ?? createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);
  const userAgent = buildUserAgent(APP_VERSION);
  const uaToken = userAgent.split("/")[0] ?? "Adaiyalam";

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    facts.errors.push("invalid URL");
    return facts;
  }

  const origin = `${parsed.protocol}//${parsed.host}`;
  const robots = await fetchRobots(origin, rateLimiter, options.ssrf);
  facts.sitemapUrls = robots.sitemaps;

  if (!isAllowedByRobots(robots, uaToken, parsed.pathname + parsed.search)) {
    facts.errors.push("blocked by robots.txt — scan skipped for this path");
    return facts;
  }

  await rateLimiter.schedule(parsed.hostname);
  const mainResponse = await safeFetch(targetUrl, {
    headers: { "user-agent": userAgent },
    timeoutMs: options.timeoutMs ?? 12_000,
    ssrf: options.ssrf,
  });

  facts.finalUrl = mainResponse.finalUrl;
  facts.redirectChain = mainResponse.redirectChain;
  facts.statusCode = mainResponse.statusCode;
  facts.headers = mainResponse.headers;
  facts.cookies = parseSetCookies(mainResponse.setCookies);
  facts.htmlTruncated = mainResponse.bodyTruncated;

  if (mainResponse.error) {
    facts.errors.push(mainResponse.error);
    return facts;
  }
  if (mainResponse.statusCode === 0 || mainResponse.statusCode >= 500) {
    facts.errors.push(`server error or no response (status ${mainResponse.statusCode})`);
  }
  if (mainResponse.statusCode === 429 || mainResponse.statusCode === 403) {
    facts.errors.push(`rate-limited or blocked by the target (status ${mainResponse.statusCode}) — not retrying aggressively`);
  }

  facts.html = mainResponse.body;
  const finalUrlObj = new URL(facts.finalUrl);

  const htmlLooksLikeMarkup = /<html[\s>]/i.test(mainResponse.body) || /<!doctype html/i.test(mainResponse.body);
  if (htmlLooksLikeMarkup) {
    const parsedHtml = parseHtml(mainResponse.body, facts.finalUrl);
    facts.metaTags = parsedHtml.metaTags;
    facts.scriptSrcs = parsedHtml.scriptSrcs;
    facts.scriptInline = parsedHtml.scriptInline;
    facts.linkTags = parsedHtml.linkTags;
    facts.cssText = [...parsedHtml.inlineStyles];

    const stylesheetLinks = parsedHtml.linkTags.filter((l) => l.rel.toLowerCase() === "stylesheet").slice(0, options.maxStylesheets ?? DEFAULT_MAX_STYLESHEETS);
    for (const link of stylesheetLinks) {
      try {
        await rateLimiter.schedule(new URL(link.href).hostname);
        const css = await safeFetch(link.href, { headers: { "user-agent": userAgent }, timeoutMs: 6000, maxBodyBytes: 300_000, ssrf: options.ssrf });
        if (css.statusCode === 200) facts.cssText.push(truncate(css.body, 20_000));
      } catch {
        // best-effort only
      }
    }

    if (options.domSelectors) {
      facts.domQueries = evaluateDomSelectors(parsedHtml.$, options.domSelectors, options.domAttrsBySelector ?? new Map());
    }
  } else {
    facts.errors.push("response does not look like HTML — detection quality may be reduced");
  }

  facts.domCoverageComplete = (options.jsGlobalCount ?? 0) === 0;

  // Favicon.
  const iconLink = facts.linkTags.find((l) => /icon/i.test(l.rel));
  const faviconUrl = iconLink?.href ?? `${origin}/favicon.ico`;
  try {
    await rateLimiter.schedule(new URL(faviconUrl).hostname);
    const favicon = await safeFetch(faviconUrl, { headers: { "user-agent": userAgent }, timeoutMs: 6000, maxBodyBytes: 300_000, binary: true, ssrf: options.ssrf });
    if (favicon.statusCode === 200 && favicon.bodyBuffer && favicon.bodyBuffer.length > 0) {
      facts.faviconHash = hashFavicon(favicon.bodyBuffer);
    }
  } catch {
    // favicon is best-effort
  }

  // DNS + TLS on the final resolved host (after any cross-domain redirect).
  facts.dns = await collectDnsRecords(finalUrlObj.hostname).catch(() => undefined);
  if (finalUrlObj.protocol === "https:") {
    const tlsInfo = await collectTlsInfo(finalUrlObj.hostname, 443, options.ssrf);
    facts.tlsIssuer = tlsInfo.issuer;
    facts.tlsValid = tlsInfo.valid;
    if (tlsInfo.error) facts.errors.push(`TLS: ${tlsInfo.error}`);
  }

  // Minimal probe mode: opt-in, justified, hard-capped, robots-respecting.
  if (options.probes && options.probes.length > 0) {
    const capped = options.probes.slice(0, options.maxProbes ?? DEFAULT_MAX_PROBES);
    for (const probe of capped) {
      if (!isAllowedByRobots(robots, uaToken, probe.path)) continue;
      try {
        await rateLimiter.schedule(finalUrlObj.hostname);
        const probeUrl = new URL(probe.path, origin).toString();
        const response = await safeFetch(probeUrl, { headers: { "user-agent": userAgent }, timeoutMs: 6000, maxBodyBytes: 50_000, ssrf: options.ssrf });
        facts.probes[probe.path] = { path: probe.path, status: response.statusCode, bodySnippet: truncate(response.body, 2000), justification: probe.justification };
      } catch {
        // best-effort
      }
    }
  }

  return facts;
}
