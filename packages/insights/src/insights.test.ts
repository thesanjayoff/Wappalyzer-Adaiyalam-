import { describe, expect, it } from "vitest";
import { emptyFacts } from "@adaiyalam/engine";
import { analyzeSecurityHeaders, analyzeExposedBanners, analyzeMixedContent } from "./headers.js";
import { analyzeCookies } from "./cookies.js";
import { findScriptsMissingIntegrity, findTyposquattingLikeDomains } from "./supply-chain.js";
import { analyzePrivacy } from "./privacy.js";

describe("analyzeSecurityHeaders", () => {
  it("flags all checked headers as missing when none are present", () => {
    const facts = emptyFacts("https://example.com", "fast");
    const findings = analyzeSecurityHeaders(facts);
    expect(findings.every((f) => !f.present)).toBe(true);
    expect(findings.length).toBeGreaterThanOrEqual(6);
  });

  it("recognizes frame-ancestors in CSP as equivalent frame protection", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.headers["content-security-policy"] = "frame-ancestors 'self'";
    const findings = analyzeSecurityHeaders(facts);
    const frameFinding = findings.find((f) => f.header === "x-frame-options");
    expect(frameFinding?.present).toBe(true);
  });
});

describe("analyzeExposedBanners", () => {
  it("flags a versioned Server header", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.headers["server"] = "Apache/2.4.41";
    expect(analyzeExposedBanners(facts)).toHaveLength(1);
  });

  it("does not flag a generic Server header with no version", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.headers["server"] = "cloudflare";
    expect(analyzeExposedBanners(facts)).toHaveLength(0);
  });
});

describe("analyzeMixedContent", () => {
  it("flags http:// scripts on an https page", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptSrcs = ["http://example.com/legacy.js", "https://example.com/modern.js"];
    expect(analyzeMixedContent(facts)).toEqual([{ url: "http://example.com/legacy.js" }]);
  });

  it("does nothing on an http page (nothing to mix)", () => {
    const facts = emptyFacts("http://example.com", "fast");
    facts.scriptSrcs = ["http://example.com/a.js"];
    expect(analyzeMixedContent(facts)).toHaveLength(0);
  });
});

describe("analyzeCookies", () => {
  it("flags a session cookie missing Secure/HttpOnly/SameSite on an https site", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.cookies = [{ name: "session_id", value: "abc" }];
    const findings = analyzeCookies(facts);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.issues.length).toBeGreaterThanOrEqual(2);
  });

  it("does not flag a correctly-configured cookie", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.cookies = [{ name: "session_id", value: "abc", secure: true, httpOnly: true, sameSite: "Strict" }];
    expect(analyzeCookies(facts)).toHaveLength(0);
  });
});

describe("findScriptsMissingIntegrity", () => {
  it("flags a known CDN script with no integrity attribute", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptTags = [{ src: "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js" }];
    expect(findScriptsMissingIntegrity(facts)).toHaveLength(1);
  });

  it("does not flag a script that has an integrity hash", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptTags = [{ src: "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js", integrity: "sha384-abc" }];
    expect(findScriptsMissingIntegrity(facts)).toHaveLength(0);
  });
});

describe("findTyposquattingLikeDomains", () => {
  it("flags a one-character-off lookalike of a watched brand domain", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptSrcs = ["https://googie-analytics.com/evil.js"];
    const findings = findTyposquattingLikeDomains(facts);
    expect(findings.length).toBeGreaterThan(0);
  });

  it("does not flag the real domain", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptSrcs = ["https://www.google-analytics.com/analytics.js"];
    expect(findTyposquattingLikeDomains(facts)).toHaveLength(0);
  });
});

describe("analyzePrivacy", () => {
  it("lists trackers and third-party domains", () => {
    const facts = emptyFacts("https://example.com", "fast");
    facts.scriptSrcs = ["https://www.google-analytics.com/analytics.js"];
    const inventory = analyzePrivacy(
      [{ techId: "google-analytics", name: "Google Analytics", categories: ["analytics"], confidence: 90, evidence: [], impliedBy: [], directlyMatched: true, ruleContentHash: "x" }],
      facts
    );
    expect(inventory.trackers).toHaveLength(1);
    expect(inventory.thirdPartyDomains.some((d) => d.domain === "www.google-analytics.com")).toBe(true);
  });
});
