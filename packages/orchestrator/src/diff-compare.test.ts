import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adaiyalam-diff-test-"));
  process.env.ADAIYALAM_HOME = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ADAIYALAM_HOME;
  rmSync(tempDir, { recursive: true, force: true });
});

function factsWithHeaders(url: string, headers: Record<string, string>) {
  return async () => {
    const { emptyFacts } = await import("@adaiyalam/engine");
    const facts = emptyFacts(url, "fast");
    facts.finalUrl = url;
    facts.headers = headers;
    return facts;
  };
}

describe("diffScans / diffSiteLatest", () => {
  it("detects an added technology between two scans of the same site", async () => {
    const { recordScan } = await import("@adaiyalam/store");
    const makeBefore = factsWithHeaders("https://example.com", {});
    const makeAfter = factsWithHeaders("https://example.com", { server: "cloudflare" });

    const before = recordScan(
      { url: "https://example.com", finalUrl: "https://example.com", mode: "fast", scannedAt: "2026-01-01T00:00:00Z", statusCode: 200, rulesetVersion: "x", techIds: [], errors: [] },
      await makeBefore()
    );
    const after = recordScan(
      { url: "https://example.com", finalUrl: "https://example.com", mode: "fast", scannedAt: "2026-02-01T00:00:00Z", statusCode: 200, rulesetVersion: "x", techIds: ["cloudflare"], errors: [] },
      await makeAfter()
    );

    const { diffScans, diffSiteLatest, hasMeaningfulChange } = await import("./diff.js");
    const diff = diffScans(before.id, after.id);
    expect(diff.summary.added).toBe(1);
    expect(diff.entries.find((e) => e.techId === "cloudflare")?.change).toBe("added");
    expect(hasMeaningfulChange(diff)).toBe(true);

    const latest = diffSiteLatest("example.com");
    expect(latest?.summary.added).toBe(1);
  });

  it("returns undefined when a site has fewer than two scans", async () => {
    const { recordScan } = await import("@adaiyalam/store");
    const { emptyFacts } = await import("@adaiyalam/engine");
    recordScan(
      { url: "https://example.com", finalUrl: "https://example.com", mode: "fast", scannedAt: "2026-01-01T00:00:00Z", statusCode: 200, rulesetVersion: "x", techIds: [], errors: [] },
      emptyFacts("https://example.com", "fast")
    );
    const { diffSiteLatest } = await import("./diff.js");
    expect(diffSiteLatest("example.com")).toBeUndefined();
  });
});

describe("compareSites", () => {
  it("compares two sites' latest scans, including technologies only one of them has", async () => {
    const { recordScan } = await import("@adaiyalam/store");

    recordScan(
      { url: "https://a.example", finalUrl: "https://a.example", mode: "fast", scannedAt: "2026-01-01T00:00:00Z", statusCode: 200, rulesetVersion: "x", techIds: ["cloudflare"], errors: [] },
      await factsWithHeaders("https://a.example", { server: "cloudflare" })()
    );
    recordScan(
      { url: "https://b.example", finalUrl: "https://b.example", mode: "fast", scannedAt: "2026-01-01T00:00:00Z", statusCode: 200, rulesetVersion: "x", techIds: [], errors: [] },
      await factsWithHeaders("https://b.example", {})()
    );

    const { compareSites } = await import("./compare.js");
    const result = compareSites(["a.example", "b.example"]);
    const cloudflareRow = result.technologies.find((t) => t.techId === "cloudflare");
    expect(cloudflareRow?.presentIn["a.example"]).toBeDefined();
    expect(cloudflareRow?.presentIn["b.example"]).toBeUndefined();
  });

  it("throws a clear error for a hostname with no saved scan", async () => {
    const { compareSites } = await import("./compare.js");
    expect(() => compareSites(["never-scanned.example", "also-never.example"])).toThrow(/No saved scan/);
  });
});
