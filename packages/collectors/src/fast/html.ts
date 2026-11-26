import * as cheerio from "cheerio";
import type { DomQueryResult, LinkFact, MetaFact } from "@adaiyalam/engine";
import { truncate } from "@adaiyalam/engine";

const MAX_INLINE_SCRIPT_CHARS = 20_000;
const MAX_INLINE_SCRIPTS = 25;
const MAX_CSS_CHARS = 20_000;

export interface ParsedHtml {
  $: cheerio.CheerioAPI;
  metaTags: MetaFact[];
  scriptSrcs: string[];
  scriptInline: string[];
  linkTags: LinkFact[];
  inlineStyles: string[];
}

export function parseHtml(html: string, baseUrl: string): ParsedHtml {
  const $ = cheerio.load(html);
  const metaTags: MetaFact[] = [];
  $("meta").each((_, el) => {
    const attribs = el.attribs ?? {};
    const content = attribs.content;
    if (content === undefined) return;
    metaTags.push({ name: attribs.name, property: attribs.property, content });
  });

  const scriptSrcs: string[] = [];
  const scriptInline: string[] = [];
  $("script").each((_, el) => {
    const src = el.attribs?.src;
    if (src) {
      try {
        scriptSrcs.push(new URL(src, baseUrl).toString());
      } catch {
        scriptSrcs.push(src);
      }
    } else if (scriptInline.length < MAX_INLINE_SCRIPTS) {
      const body = $(el).text();
      if (body.trim()) scriptInline.push(truncate(body, MAX_INLINE_SCRIPT_CHARS));
    }
  });

  const linkTags: LinkFact[] = [];
  $("link").each((_, el) => {
    const rel = el.attribs?.rel;
    const href = el.attribs?.href;
    if (rel && href) {
      try {
        linkTags.push({ rel, href: new URL(href, baseUrl).toString() });
      } catch {
        linkTags.push({ rel, href });
      }
    }
  });

  const inlineStyles: string[] = [];
  $("style").each((_, el) => {
    const body = $(el).text();
    if (body.trim()) inlineStyles.push(truncate(body, MAX_CSS_CHARS));
  });

  return { $, metaTags, scriptSrcs, scriptInline, linkTags, inlineStyles };
}

/**
 * Evaluates the DOM-based signal selectors (domExists/domAttr/domText)
 * against a statically-parsed (pre-JavaScript) DOM. This is weaker than
 * browser mode for JS-rendered content but still catches a lot of
 * server-rendered markup without needing Playwright.
 */
export function evaluateDomSelectors(
  $: cheerio.CheerioAPI,
  selectors: Iterable<string>,
  attrsBySelector: Map<string, Set<string>>
): Record<string, DomQueryResult> {
  const results: Record<string, DomQueryResult> = {};
  for (const selector of selectors) {
    try {
      const found = $(selector);
      const result: DomQueryResult = { exists: found.length > 0, count: found.length };
      if (found.length > 0) {
        const text = found.first().text().trim();
        if (text) result.firstText = truncate(text, 500);
        const attrNames = attrsBySelector.get(selector);
        if (attrNames) {
          result.attrs = {};
          for (const attr of attrNames) {
            result.attrs[attr] = found.first().attr(attr);
          }
        }
      }
      results[selector] = result;
    } catch {
      results[selector] = { exists: false, count: 0 };
    }
  }
  return results;
}
