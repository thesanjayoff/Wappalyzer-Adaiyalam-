import { describe, expect, it } from "vitest";
import { findCrawlCandidates } from "./links.js";

describe("findCrawlCandidates", () => {
  const html = `
    <a href="/product/shoes">Shoes</a>
    <a href="/blog/2024/update">Blog post</a>
    <a href="https://other-site.test/product/x">Off-origin product</a>
    <a href="/contact">Contact us</a>
    <a href="/checkout">Checkout</a>
    <a href="#top">Back to top</a>
  `;

  it("picks same-origin links matching interesting path keywords, capped at maxCandidates", () => {
    const candidates = findCrawlCandidates(html, "https://example.com/", 2);
    expect(candidates).toHaveLength(2);
    for (const url of candidates) expect(url.startsWith("https://example.com/")).toBe(true);
  });

  it("excludes off-origin links even if the path matches", () => {
    const candidates = findCrawlCandidates(html, "https://example.com/", 10);
    expect(candidates.some((c) => c.includes("other-site.test"))).toBe(false);
  });

  it("excludes links that don't match any interesting path keyword", () => {
    const candidates = findCrawlCandidates(html, "https://example.com/", 10);
    expect(candidates.some((c) => c.includes("/blog/"))).toBe(false);
  });

  it("returns an empty array for a page with no matching links", () => {
    expect(findCrawlCandidates("<a href=\"/blog/post\">x</a>", "https://example.com/", 5)).toEqual([]);
  });
});
