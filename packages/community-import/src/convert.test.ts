import { describe, expect, it } from "vitest";
import { convertCommunityPack } from "./convert.js";
import type { CommunityPackFile } from "./types.js";

describe("convertCommunityPack", () => {
  it("converts headers/html/scriptSrc/cookies/meta/js/url into Adaiyalam evidence types", () => {
    const pack: CommunityPackFile = {
      "My Totally Fake CMS": {
        website: "https://example.com/fakecms",
        headers: { "X-Powered-By": "FakeCMS\\;confidence:90" },
        html: ["<meta name=\"generator\" content=\"FakeCMS ([0-9.]+)\""],
        scriptSrc: ["fakecms-core\\.js"],
        cookies: { fakecms_session: "" },
        meta: { generator: "FakeCMS" },
        js: { FakeCMS: "" },
        url: ["/fakecms-admin/"],
        implies: "jQuery",
      },
    };

    const result = convertCommunityPack(pack, { sourceLabel: "unit test fixture, MIT" });
    expect(result.rules).toHaveLength(1);
    const rule = result.rules[0]!.rule as Record<string, unknown>;
    expect(rule.id).toBe("my-totally-fake-cms");
    expect(rule.implies).toEqual(["jquery"]);
    const evidence = rule.evidence as Record<string, unknown>[];
    const types = evidence.map((e) => e.type);
    expect(types).toContain("header");
    expect(types).toContain("html");
    expect(types).toContain("scriptSrc");
    expect(types).toContain("cookie");
    expect(types).toContain("meta");
    expect(types).toContain("jsGlobal");
    expect(types).toContain("url");

    const headerEvidence = evidence.find((e) => e.type === "header")!;
    expect(headerEvidence.confidence).toBe(90);

    const jsGlobalEvidence = evidence.find((e) => e.type === "jsGlobal")!;
    expect(jsGlobalEvidence.pattern).toBe(".*");

    expect((rule.notes as string)).toContain("unit test fixture, MIT");
  });

  it("warns and defaults when website is missing, and skips techs with no convertible signal", () => {
    const pack: CommunityPackFile = {
      "No Website Tech": { headers: { "X-Thing": "yes" } },
      "Empty Tech": {},
    };
    const result = convertCommunityPack(pack, { sourceLabel: "test" });
    expect(result.rules).toHaveLength(1);
    expect(result.skipped).toEqual([{ techName: "Empty Tech", reason: expect.stringContaining("no convertible signal") }]);
    expect(result.warnings.some((w) => w.techName === "No Website Tech" && w.message.includes("website"))).toBe(true);
  });

  it("warns about unmapped numeric categories and unsupported dom field, without throwing", () => {
    const pack: CommunityPackFile = {
      "Weird Format Tech": {
        website: "https://example.com",
        headers: { "X-Tech": "yes" },
        cats: [1, 11],
        dom: { "a.selector": { exists: "" } },
      },
    };
    const result = convertCommunityPack(pack, { sourceLabel: "test" });
    expect(result.rules).toHaveLength(1);
    const rule = result.rules[0]!.rule as Record<string, unknown>;
    expect(rule.categories).toEqual(["miscellaneous"]);
    expect(result.warnings.some((w) => w.message.includes("dom"))).toBe(true);
    expect(result.warnings.some((w) => w.message.includes("category"))).toBe(true);
  });

  it("applies the default confidence to signals that don't embed their own", () => {
    const pack: CommunityPackFile = {
      "Plain Tech": { website: "https://example.com", html: ["plain-marker"] },
    };
    const result = convertCommunityPack(pack, { sourceLabel: "test", defaultConfidence: 33 });
    const rule = result.rules[0]!.rule as Record<string, unknown>;
    const evidence = rule.evidence as Record<string, unknown>[];
    expect(evidence[0]!.confidence).toBe(33);
  });
});
