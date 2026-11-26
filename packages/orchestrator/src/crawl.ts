import { collectBrowser, createRateLimiter, findCrawlCandidates, type BrowserCollectOptions } from "@adaiyalam/collectors";
import { collectBrowserTargets, resolveStack, truncate, type SiteFacts } from "@adaiyalam/engine";
import { recordScan, type ScanRecord } from "@adaiyalam/store";
import { buildReport, getRuleset, type ScanReport } from "./scan.js";

const MAX_MERGED_HTML_CHARS = 2_000_000;

function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * Merges several pages' facts (home page first = primary) into one
 * SiteFacts object so the existing single-facts matcher/stack-resolver can
 * run unchanged over a multi-page crawl. Single-valued navigation facts
 * (status code, redirect chain, TLS info) come from the primary page;
 * everything else is unioned/deduplicated across pages.
 */
export function mergeFacts(pages: SiteFacts[]): SiteFacts {
  const [primary, ...rest] = pages;
  if (!primary) throw new Error("mergeFacts requires at least one page");
  if (rest.length === 0) return primary;

  const merged: SiteFacts = { ...primary };

  merged.scriptSrcs = dedupe([...primary.scriptSrcs, ...rest.flatMap((p) => p.scriptSrcs)], (s) => s);
  merged.scriptInline = dedupe([...primary.scriptInline, ...rest.flatMap((p) => p.scriptInline)], (s) => s);
  merged.scriptTags = dedupe([...primary.scriptTags, ...rest.flatMap((p) => p.scriptTags)], (t) => t.src);
  merged.cookies = dedupe([...primary.cookies, ...rest.flatMap((p) => p.cookies)], (c) => `${c.name}|${c.domain ?? ""}`);
  merged.metaTags = dedupe([...primary.metaTags, ...rest.flatMap((p) => p.metaTags)], (m) => `${m.name ?? ""}|${m.property ?? ""}|${m.content}`);
  merged.linkTags = dedupe([...primary.linkTags, ...rest.flatMap((p) => p.linkTags)], (l) => `${l.rel}|${l.href}`);
  merged.cssText = dedupe([...primary.cssText, ...rest.flatMap((p) => p.cssText)], (s) => s);
  merged.networkRequests = [...primary.networkRequests, ...rest.flatMap((p) => p.networkRequests)];

  merged.html = truncate([primary.html, ...rest.map((p) => p.html)].join("\n"), MAX_MERGED_HTML_CHARS);
  merged.htmlTruncated = primary.htmlTruncated || rest.some((p) => p.htmlTruncated) || merged.html.length >= MAX_MERGED_HTML_CHARS;

  merged.domQueries = { ...primary.domQueries };
  for (const page of rest) {
    for (const [selector, result] of Object.entries(page.domQueries)) {
      const existing = merged.domQueries[selector];
      if (!existing) {
        merged.domQueries[selector] = result;
      } else if (result.exists && !existing.exists) {
        merged.domQueries[selector] = result;
      } else if (result.exists && existing.exists) {
        merged.domQueries[selector] = { ...existing, count: existing.count + result.count };
      }
    }
  }

  merged.jsGlobals = { ...primary.jsGlobals };
  for (const page of rest) {
    for (const [path, fact] of Object.entries(page.jsGlobals)) {
      const existing = merged.jsGlobals[path];
      if (!existing || (fact.exists && !existing.exists)) merged.jsGlobals[path] = fact;
    }
  }

  merged.errors = dedupe([...primary.errors, ...rest.flatMap((p) => p.errors)], (e) => e);
  return merged;
}

export interface ScanUrlCrawlOptions extends Partial<BrowserCollectOptions> {
  save?: boolean;
  /** How many extra pages beyond the homepage to visit (product/checkout/contact-style paths discovered from the homepage). Default 2. */
  maxExtraPages?: number;
}

/**
 * Multi-page browser-mode scan: collects the homepage, then discovers and
 * visits a few same-origin product/checkout/contact-style pages linked
 * from it (each a fresh, isolated browser context — simple and safe, at
 * the cost of relaunching Chromium per extra page), merges all pages'
 * facts, and resolves the stack once over the merged result. Opt-in: call
 * this instead of scanUrlBrowser when you want broader coverage than a
 * single page gives (e.g. a payment widget that only appears on /checkout).
 */
export async function scanUrlBrowserCrawl(url: string, options: ScanUrlCrawlOptions = {}): Promise<ScanReport> {
  const ruleset = getRuleset();
  const browserTargets = collectBrowserTargets(ruleset.rules);
  // Shared across every page in this crawl so the per-host delay is actually
  // enforced between the homepage and each extra page, not just within a
  // single collectBrowser call.
  const rateLimiter = options.rateLimiter ?? createRateLimiter(options.rateLimit);
  const collectOptions = {
    ...options,
    rateLimiter,
    domSelectors: browserTargets.selectors,
    domAttrsBySelector: browserTargets.attrsBySelector,
    jsGlobalPaths: browserTargets.jsGlobals,
  };

  const homeFacts = await collectBrowser(url, collectOptions);
  const maxExtraPages = options.maxExtraPages ?? 2;
  const candidates = maxExtraPages > 0 && homeFacts.html ? findCrawlCandidates(homeFacts.html, homeFacts.finalUrl || url, maxExtraPages) : [];

  const pages = [homeFacts];
  const crawledPages = [homeFacts.finalUrl || url];
  for (const candidateUrl of candidates) {
    const pageFacts = await collectBrowser(candidateUrl, collectOptions);
    if (pageFacts.statusCode > 0) {
      pages.push(pageFacts);
      crawledPages.push(pageFacts.finalUrl || candidateUrl);
    }
  }

  const facts = mergeFacts(pages);
  const stack = resolveStack(ruleset.rules, facts);
  const report = buildReport(url, facts, stack, ruleset.version);
  report.crawledPages = crawledPages;

  if (options.save !== false) {
    const record: ScanRecord = recordScan(
      {
        url,
        finalUrl: facts.finalUrl,
        mode: facts.mode,
        scannedAt: facts.collectedAt,
        statusCode: facts.statusCode,
        rulesetVersion: ruleset.version,
        techIds: stack.detections.map((d) => d.techId),
        errors: facts.errors,
      },
      facts
    );
    report.savedScanId = record.id;
  }

  return report;
}
