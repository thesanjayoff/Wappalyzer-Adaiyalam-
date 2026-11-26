import * as cheerio from "cheerio";

/** Path keywords that tend to surface technologies the homepage alone misses (checkout widgets, contact forms, product-page review widgets). */
const INTERESTING_PATH_PATTERN = /\/(product|products|shop|store|item|p)\b|\/(checkout|cart|basket)\b|\/(contact|contact-us)\b|\/(about|about-us)\b|\/(pricing|plans)\b/i;

/**
 * Finds same-origin links on a page worth visiting for a deeper, multi-page
 * scan — product/checkout/contact-style paths rather than every link on the
 * page (blog posts, pagination, etc. would blow the page budget for little
 * extra signal). Pure function: given HTML + the page's own URL, no I/O.
 */
export function findCrawlCandidates(html: string, pageUrl: string, maxCandidates: number): string[] {
  const $ = cheerio.load(html);
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return [];
  }

  const seen = new Set<string>([pageUrl]);
  const candidates: string[] = [];

  $("a[href]").each((_, el) => {
    if (candidates.length >= maxCandidates) return;
    const href = $(el).attr("href");
    if (!href) return;
    let absolute: URL;
    try {
      absolute = new URL(href, pageUrl);
    } catch {
      return;
    }
    absolute.hash = "";
    if (absolute.origin !== origin) return;
    const normalized = absolute.toString();
    if (seen.has(normalized)) return;
    if (!INTERESTING_PATH_PATTERN.test(absolute.pathname)) return;
    seen.add(normalized);
    candidates.push(normalized);
  });

  return candidates;
}
