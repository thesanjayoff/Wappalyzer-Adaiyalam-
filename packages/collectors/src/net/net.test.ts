import { describe, expect, it } from "vitest";
import { isPrivateOrReservedIp, assertAllowedScheme, SsrfBlockedError } from "./ssrf.js";
import { parseRobotsTxt, isAllowedByRobots, crawlDelayFor } from "./robots.js";
import { RateLimiter } from "./rate-limiter.js";
import { parseSetCookies } from "./cookies.js";
import { safeFetch } from "./http-client.js";

describe("isPrivateOrReservedIp", () => {
  it("flags loopback, link-local, and private ranges", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
    expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.5.5")).toBe(true);
    expect(isPrivateOrReservedIp("169.254.1.1")).toBe(true);
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
  });

  it("allows public addresses", () => {
    expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
    expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
  });
});

describe("assertAllowedScheme", () => {
  it("allows http/https", () => {
    expect(() => assertAllowedScheme(new URL("https://example.com"))).not.toThrow();
    expect(() => assertAllowedScheme(new URL("http://example.com"))).not.toThrow();
  });

  it("blocks file:// and other schemes", () => {
    expect(() => assertAllowedScheme(new URL("file:///etc/passwd"))).toThrow(SsrfBlockedError);
    expect(() => assertAllowedScheme(new URL("ftp://example.com"))).toThrow(SsrfBlockedError);
  });
});

describe("robots.txt", () => {
  const robotsTxt = `
User-agent: *
Disallow: /admin
Allow: /admin/public
Crawl-delay: 2

User-agent: Adaiyalam
Disallow: /no-bots-of-this-kind
Sitemap: https://example.com/sitemap.xml
`;

  it("parses groups and sitemaps", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(rules.sitemaps).toContain("https://example.com/sitemap.xml");
    expect(rules.groups.length).toBe(2);
  });

  it("disallows a path under a disallowed prefix for the wildcard agent", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(isAllowedByRobots(rules, "OtherBot", "/admin/secret")).toBe(false);
  });

  it("longest match wins: a more specific Allow overrides a shorter Disallow", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(isAllowedByRobots(rules, "OtherBot", "/admin/public/page")).toBe(true);
  });

  it("uses the agent-specific group when present", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(isAllowedByRobots(rules, "Adaiyalam", "/no-bots-of-this-kind")).toBe(false);
    expect(isAllowedByRobots(rules, "Adaiyalam", "/admin")).toBe(true); // Adaiyalam's own group has no /admin rule
  });

  it("reads crawl-delay", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(crawlDelayFor(rules, "OtherBot")).toBe(2);
  });

  it("defaults to allow when nothing matches", () => {
    const rules = parseRobotsTxt(robotsTxt);
    expect(isAllowedByRobots(rules, "OtherBot", "/totally/unrelated")).toBe(true);
  });
});

describe("RateLimiter", () => {
  it("enforces a minimum per-host delay", async () => {
    const limiter = new RateLimiter(0, 50);
    const start = Date.now();
    await limiter.schedule("example.com");
    await limiter.schedule("example.com");
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("does not delay requests to different hosts for the per-host rule", async () => {
    const limiter = new RateLimiter(0, 10_000);
    const start = Date.now();
    await limiter.schedule("a.example.com");
    await limiter.schedule("b.example.com");
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("safeFetch SSRF protection", () => {
  it("blocks a literal private IP even though no DNS lookup is needed to reach it", async () => {
    // Regression test: Node only invokes a custom `lookup` hook when the
    // host is a hostname, never when it's already an IP literal, so this
    // case must be caught by an explicit pre-flight check instead.
    const result = await safeFetch("http://127.0.0.1:1/some-path", { timeoutMs: 1000 });
    expect(result.error).toMatch(/private|reserved/);
    expect(result.statusCode).toBe(0);
  });

  it("blocks disallowed schemes", async () => {
    const result = await safeFetch("file:///etc/passwd", { timeoutMs: 1000 });
    expect(result.error).toMatch(/scheme/);
  });
});

describe("parseSetCookies", () => {
  it("parses name/value and attributes, tolerating commas in Expires", () => {
    const [cookie] = parseSetCookies(["session=abc123; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=Wed, 09 Jun 2027 10:18:14 GMT"]);
    expect(cookie?.name).toBe("session");
    expect(cookie?.value).toBe("abc123");
    expect(cookie?.secure).toBe(true);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
  });
});
