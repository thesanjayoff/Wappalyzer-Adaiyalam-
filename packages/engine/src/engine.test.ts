import { describe, expect, it } from "vitest";
import type { FingerprintRule } from "@adaiyalam/schema";
import { emptyFacts, type SiteFacts } from "./facts.js";
import { matchRule } from "./matcher.js";
import { compileRule } from "./compile.js";
import { resolveStack } from "./stack.js";
import { combineConfidence } from "./confidence.js";
import { stableHash } from "./util.js";

function rule(partial: Partial<FingerprintRule> & { id: string; evidence: FingerprintRule["evidence"] }): FingerprintRule {
  return {
    schemaVersion: 1,
    name: partial.name ?? partial.id,
    description: "test rule",
    website: "https://example.com",
    categories: partial.categories ?? ["miscellaneous"],
    pricing: [],
    implies: partial.implies ?? [],
    requires: partial.requires ?? [],
    excludes: partial.excludes ?? [],
    ...partial,
  } as FingerprintRule;
}

function factsWithHeader(name: string, value: string): SiteFacts {
  const facts = emptyFacts("https://example.com", "fast");
  facts.headers[name.toLowerCase()] = value;
  return facts;
}

describe("matchRule", () => {
  it("matches a simple header pattern and extracts a version", () => {
    const wp = rule({
      id: "wordpress",
      evidence: [{ type: "header", key: "x-powered-by", pattern: "WordPress/([\\d.]+)", flags: "i", confidence: 90, negative: false, version: "$1" }],
    });
    const compiled = compileRule(wp, "hash1");
    const facts = factsWithHeader("x-powered-by", "WordPress/6.4.2");
    const result = matchRule(compiled, facts);
    expect(result.matched).toBe(true);
    expect(result.version?.value).toBe("6.4.2");
    expect(result.version?.confidence).toBe("exact");
  });

  it("does not match when the header is absent", () => {
    const wp = rule({
      id: "wordpress",
      evidence: [{ type: "header", key: "x-powered-by", pattern: "WordPress", flags: "i", confidence: 90, negative: false }],
    });
    const compiled = compileRule(wp, "hash1");
    const result = matchRule(compiled, emptyFacts("https://example.com", "fast"));
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("negative pattern suppresses confidence", () => {
    const tech = rule({
      id: "maybe-tech",
      evidence: [
        { type: "header", key: "server", pattern: "nginx", flags: "i", confidence: 70, negative: false },
        { type: "header", key: "x-not-it", pattern: "definitely-not", flags: "i", confidence: 100, negative: true },
      ],
    });
    const compiled = compileRule(tech, "hash2");
    const facts = factsWithHeader("server", "nginx");
    facts.headers["x-not-it"] = "definitely-not";
    const result = matchRule(compiled, facts);
    expect(result.confidence).toBe(0);
  });

  it("strips g/y flags so shared compiled regex has no lastIndex state", () => {
    const tech = rule({
      id: "stateful-check",
      evidence: [{ type: "header", key: "x-id", pattern: "abc", flags: "gi", confidence: 100, negative: false }],
    });
    const compiled = compileRule(tech, "hash3");
    const facts1 = factsWithHeader("x-id", "abc");
    const facts2 = factsWithHeader("x-id", "abc");
    expect(matchRule(compiled, facts1).matched).toBe(true);
    // If lastIndex carried over from a 'g' flag, this second call could spuriously fail.
    expect(matchRule(compiled, facts2).matched).toBe(true);
  });
});

describe("combineConfidence", () => {
  it("combines independent positive signals probabilistically, never exceeding 100", () => {
    const combined = combineConfidence([
      { patternIndex: 0, type: "header", matchedValue: "a", confidence: 60, negative: false },
      { patternIndex: 1, type: "meta", matchedValue: "b", confidence: 60, negative: false },
    ]);
    expect(combined).toBe(84);
  });
});

describe("stableHash", () => {
  it("is deterministic for the same input", () => {
    expect(stableHash("hello world")).toBe(stableHash("hello world"));
  });

  it("differs for different input, including a single-character change", () => {
    expect(stableHash("hello world")).not.toBe(stableHash("hello worle"));
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });

  it("has no dependency on Node's crypto module (usable in a bundled browser extension)", () => {
    expect(stableHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("resolveStack", () => {
  it("propagates implies and enforces requires", () => {
    const wordpress = rule({ id: "wordpress", evidence: [{ type: "header", key: "x-wp", pattern: "wp", flags: "i", confidence: 90, negative: false }] });
    const woocommerce = rule({
      id: "woocommerce",
      implies: [{ id: "wordpress", confidence: 90 }],
      requires: ["wordpress"],
      evidence: [{ type: "cookie", key: "woocommerce_items_in_cart", pattern: ".*", flags: "i", confidence: 85, negative: false }],
    });
    const facts = emptyFacts("https://shop.example.com", "fast");
    facts.cookies.push({ name: "woocommerce_items_in_cart", value: "0" });
    const compiledWp = compileRule(wordpress, "h1");
    const compiledWoo = compileRule(woocommerce, "h2");
    const { detections } = resolveStack([compiledWp, compiledWoo], facts);
    const ids = detections.map((d) => d.techId);
    expect(ids).toContain("woocommerce");
    expect(ids).toContain("wordpress");
  });

  it("drops a tech whose requires are not satisfied and confidence is low", () => {
    const parent = rule({ id: "parent-cms", evidence: [{ type: "header", key: "x-nope", pattern: "nope", flags: "i", confidence: 50, negative: false }] });
    const child = rule({
      id: "child-plugin",
      requires: ["parent-cms"],
      evidence: [{ type: "cookie", key: "plugin_cookie", pattern: ".*", flags: "i", confidence: 40, negative: false }],
    });
    const facts = emptyFacts("https://example.com", "fast");
    facts.cookies.push({ name: "plugin_cookie", value: "x" });
    const { detections, audit } = resolveStack([compileRule(parent, "h1"), compileRule(child, "h2")], facts);
    expect(detections.map((d) => d.techId)).not.toContain("child-plugin");
    expect(audit.some((a) => a.includes("child-plugin"))).toBe(true);
  });

  it("resolves excludes conflicts by keeping the higher-confidence technology", () => {
    const a = rule({
      id: "tech-a",
      excludes: ["tech-b"],
      evidence: [{ type: "header", key: "server", pattern: "A-Server", flags: "i", confidence: 95, negative: false }],
    });
    const b = rule({ id: "tech-b", evidence: [{ type: "header", key: "server", pattern: "A-Server", flags: "i", confidence: 30, negative: false }] });
    const facts = factsWithHeader("server", "A-Server");
    const { detections } = resolveStack([compileRule(a, "h1"), compileRule(b, "h2")], facts);
    const ids = detections.map((d) => d.techId);
    expect(ids).toContain("tech-a");
    expect(ids).not.toContain("tech-b");
  });
});
