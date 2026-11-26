import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "adaiyalam-store-test-"));
  process.env.ADAIYALAM_HOME = tempDir;
  // @adaiyalam/config computes PATHS.home at import time from the env var,
  // so each test gets a fresh module graph pointed at its own temp dir.
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ADAIYALAM_HOME;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("store", () => {
  it("records a scan and reads it back with its snapshot", async () => {
    const { recordScan, getScan, getFacts, listScans } = await import("./store.js");
    const { emptyFacts } = await import("@adaiyalam/engine");
    const facts = emptyFacts("https://example.com", "fast");

    const record = recordScan(
      {
        url: "https://example.com",
        finalUrl: "https://example.com",
        mode: "fast",
        scannedAt: new Date().toISOString(),
        statusCode: 200,
        rulesetVersion: "abc123",
        techIds: ["nginx"],
        errors: [],
      },
      facts
    );

    expect(getScan(record.id)?.hostname).toBe("example.com");
    expect(getFacts(record.id)?.finalUrl).toBe("https://example.com");
    expect(listScans({ hostname: "example.com" })).toHaveLength(1);
  });

  it("deletes a site and its snapshots", async () => {
    const { recordScan, deleteSite, listScans, getFacts } = await import("./store.js");
    const { emptyFacts } = await import("@adaiyalam/engine");
    const record = recordScan(
      {
        url: "https://example.com",
        finalUrl: "https://example.com",
        mode: "fast",
        scannedAt: new Date().toISOString(),
        statusCode: 200,
        rulesetVersion: "abc123",
        techIds: [],
        errors: [],
      },
      emptyFacts("https://example.com", "fast")
    );

    deleteSite("example.com");
    expect(listScans({ hostname: "example.com" })).toHaveLength(0);
    expect(getFacts(record.id)).toBeUndefined();
  });
});
