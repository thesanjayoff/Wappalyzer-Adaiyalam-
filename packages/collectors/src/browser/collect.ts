import { buildUserAgent } from "@adaiyalam/config";
import { emptyFacts, truncate, type DomQueryResult, type NetworkRequestFact, type SiteFacts } from "@adaiyalam/engine";
import { fetchRobots, APP_VERSION } from "../fast/collect.js";
import { isAllowedByRobots } from "../net/robots.js";
import { createRateLimiter, DEFAULT_RATE_LIMIT, type RateLimitConfig, type RateLimiter } from "../net/rate-limiter.js";
import { safeFetch } from "../net/http-client.js";
import { collectDnsRecords, collectTlsInfo, hashFavicon } from "../net/dns-tls.js";
import { parseHtml } from "../fast/html.js";
import type { SsrfOptions } from "../net/ssrf.js";

const MAX_HTML_CHARS = 2_000_000;
const CONSENT_ACCEPT_TEXT = /^(accept( all)?|i agree|allow all|agree( and close)?|got it)$/i;
const CONSENT_REJECT_TEXT = /^(reject( all)?|decline|necessary only|disagree)$/i;

export interface BrowserCollectOptions {
  rateLimiter?: RateLimiter;
  rateLimit?: RateLimitConfig;
  ssrf?: SsrfOptions;
  timeoutMs?: number;
  domSelectors?: Iterable<string>;
  domAttrsBySelector?: Map<string, Set<string>>;
  jsGlobalPaths?: Iterable<string>;
  /** Try to click through a cookie-consent banner before/after capturing trackers. Off by default. */
  consentAction?: "accept" | "reject" | "none";
  /** Reuses an already-launched Playwright browser instance (for bulk mode) instead of launching a fresh one per scan. */
  browser?: unknown;
}

export const BROWSER_COLLECTOR_VERSION = "1";

/**
 * Full (browser) mode: loads the page in an isolated, hardened Playwright
 * Chromium context — no filesystem/account access, downloads and
 * permissions disabled, service workers blocked — executes the ruleset's
 * jsGlobal/DOM/CSS signal collection in-page, and captures network
 * requests. Requires `playwright` and its Chromium binary to be installed
 * (`npx playwright install chromium`); throws a clear error if missing
 * rather than failing silently.
 */
export async function collectBrowser(targetUrl: string, options: BrowserCollectOptions = {}): Promise<SiteFacts> {
  const facts = emptyFacts(targetUrl, "browser");
  facts.collectorVersion = BROWSER_COLLECTOR_VERSION;
  facts.domCoverageComplete = true;

  let playwright: typeof import("playwright");
  try {
    playwright = await import("playwright");
  } catch {
    facts.errors.push('browser mode requires the "playwright" package and its Chromium binary — run "npx playwright install chromium"');
    return facts;
  }

  const rateLimiter = options.rateLimiter ?? createRateLimiter(options.rateLimit ?? DEFAULT_RATE_LIMIT);
  const userAgent = buildUserAgent(APP_VERSION);
  const uaToken = userAgent.split("/")[0] ?? "Adaiyalam";
  const timeoutMs = options.timeoutMs ?? 20_000;

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

  const browser = await playwright.chromium.launch({
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: true,
      acceptDownloads: false,
      ignoreHTTPSErrors: true,
      serviceWorkers: "block",
      permissions: [],
      bypassCSP: false,
    });
    context.setDefaultTimeout(timeoutMs);
    context.setDefaultNavigationTimeout(timeoutMs);

    let consentHappened = false;
    const networkRequests: NetworkRequestFact[] = [];
    const page = await context.newPage();
    page.on("request", (req) => {
      try {
        const url = new URL(req.url());
        networkRequests.push({ url: req.url(), domain: url.hostname, resourceType: req.resourceType(), beforeConsent: !consentHappened });
      } catch {
        // ignore malformed URLs
      }
    });

    let response;
    try {
      response = await page.goto(targetUrl, { waitUntil: "load", timeout: timeoutMs });
    } catch (err) {
      facts.errors.push(`navigation failed: ${(err as Error).message}`);
      await context.close();
      return facts;
    }

    if (response) {
      facts.statusCode = response.status();
      facts.finalUrl = response.url();
      const headers = await response.allHeaders();
      facts.headers = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));

      const chain: string[] = [];
      let redirected = response.request().redirectedFrom();
      while (redirected) {
        chain.unshift(redirected.url());
        redirected = redirected.redirectedFrom();
      }
      facts.redirectChain = chain;
    } else {
      facts.errors.push("no response received for navigation");
    }

    // Let lazy-loaded content settle.
    try {
      await page.evaluate(async () => {
        const step = Math.max(document.body?.scrollHeight ?? 0, 1) / 4;
        for (let i = 0; i < 4; i++) {
          window.scrollTo(0, step * (i + 1));
          await new Promise((r) => setTimeout(r, 150));
        }
      });
      await page.waitForTimeout(300);
    } catch {
      // best effort
    }

    // Optional, opt-in cookie-consent interaction.
    if (options.consentAction && options.consentAction !== "none") {
      const pattern = options.consentAction === "accept" ? CONSENT_ACCEPT_TEXT : CONSENT_REJECT_TEXT;
      try {
        const candidates = await page.$$("button, a, [role=button]");
        for (const el of candidates) {
          const text = ((await el.textContent()) ?? "").trim();
          if (pattern.test(text)) {
            await el.click({ timeout: 2000 });
            consentHappened = true;
            await page.waitForTimeout(500);
            break;
          }
        }
      } catch {
        // consent banner interaction is best-effort and never fatal
      }
    }
    facts.consentInteraction = consentHappened ? (options.consentAction === "accept" ? "accepted" : "rejected") : "none";

    const cookies = await context.cookies();
    facts.cookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: (c.sameSite as SiteFacts["cookies"][number]["sameSite"]) ?? "unspecified",
    }));

    const html = truncate(await page.content(), MAX_HTML_CHARS);
    facts.html = html;
    const parsedHtml = parseHtml(html, facts.finalUrl || targetUrl);
    facts.metaTags = parsedHtml.metaTags;
    facts.scriptSrcs = parsedHtml.scriptSrcs;
    facts.scriptInline = parsedHtml.scriptInline;
    facts.scriptTags = parsedHtml.scriptTags;
    facts.linkTags = parsedHtml.linkTags;
    facts.cssText = [...parsedHtml.inlineStyles];

    if (options.jsGlobalPaths) {
      const paths = [...options.jsGlobalPaths];
      facts.jsGlobals = await page.evaluate((globalPaths: string[]) => {
        const out: Record<string, { exists: boolean; valuePreview?: string; typeofValue?: string }> = {};
        for (const path of globalPaths) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const value = path.split(".").reduce((acc: any, key) => (acc === undefined || acc === null ? undefined : acc[key]), window as any);
            if (value === undefined) {
              out[path] = { exists: false };
              continue;
            }
            let preview: string;
            try {
              preview = typeof value === "string" ? value : JSON.stringify(value);
            } catch {
              preview = String(value);
            }
            out[path] = { exists: true, valuePreview: (preview ?? String(value)).slice(0, 300), typeofValue: typeof value };
          } catch {
            out[path] = { exists: false };
          }
        }
        return out;
      }, paths);
    }

    if (options.domSelectors) {
      const selectors = [...options.domSelectors];
      const attrsBySelector = Object.fromEntries([...(options.domAttrsBySelector ?? new Map()).entries()].map(([k, v]) => [k, [...v]]));
      facts.domQueries = await page.evaluate(
        ({ selectors: sels, attrsBySelector: attrs }: { selectors: string[]; attrsBySelector: Record<string, string[]> }) => {
          const out: Record<string, DomQueryResult> = {};
          for (const selector of sels) {
            try {
              const found = document.querySelectorAll(selector);
              const result: DomQueryResult = { exists: found.length > 0, count: found.length };
              if (found.length > 0) {
                const first = found[0] as Element;
                const text = (first.textContent ?? "").trim();
                if (text) result.firstText = text.slice(0, 500);
                const attrNames = attrs[selector];
                if (attrNames) {
                  result.attrs = {};
                  for (const attr of attrNames) result.attrs[attr] = first.getAttribute(attr) ?? undefined;
                }
              }
              out[selector] = result;
            } catch {
              out[selector] = { exists: false, count: 0 };
            }
          }
          return out;
        },
        { selectors, attrsBySelector }
      );
    }

    facts.networkRequests = networkRequests;
    await context.close();
  } finally {
    await browser.close();
  }

  // Favicon / DNS / TLS reuse the same pure helpers as fast mode.
  const finalUrlObj = new URL(facts.finalUrl || targetUrl);
  const iconLink = facts.linkTags.find((l) => /icon/i.test(l.rel));
  const faviconUrl = iconLink?.href ?? `${origin}/favicon.ico`;
  try {
    await rateLimiter.schedule(new URL(faviconUrl).hostname);
    const favicon = await safeFetch(faviconUrl, { headers: { "user-agent": userAgent }, timeoutMs: 6000, maxBodyBytes: 300_000, binary: true, ssrf: options.ssrf });
    if (favicon.statusCode === 200 && favicon.bodyBuffer && favicon.bodyBuffer.length > 0) {
      facts.faviconHash = hashFavicon(favicon.bodyBuffer);
    }
  } catch {
    // best effort
  }

  facts.dns = await collectDnsRecords(finalUrlObj.hostname).catch(() => undefined);
  if (finalUrlObj.protocol === "https:") {
    const tlsInfo = await collectTlsInfo(finalUrlObj.hostname, 443, options.ssrf);
    facts.tlsIssuer = tlsInfo.issuer;
    facts.tlsValid = tlsInfo.valid;
    facts.tlsProtocol = tlsInfo.protocol;
    if (tlsInfo.error) facts.errors.push(`TLS: ${tlsInfo.error}`);
  }

  return facts;
}
