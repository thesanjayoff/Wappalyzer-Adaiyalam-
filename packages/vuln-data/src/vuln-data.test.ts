import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adaiyalam-vulndata-test-"));
  process.env.ADAIYALAM_HOME = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ADAIYALAM_HOME;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("lookupEol", () => {
  it("reports end-of-life for an old PHP version", async () => {
    const { lookupEol } = await import("./eol.js");
    const result = lookupEol("php", "7.4.0", new Date("2026-01-01"));
    expect(result.status).toBe("end-of-life");
    expect(result.source).toContain("php.net");
  });

  it("reports active for a Node.js version within its active-LTS window", async () => {
    const { lookupEol } = await import("./eol.js");
    const result = lookupEol("nodejs", "22.1.0", new Date("2025-01-01"));
    expect(result.status).toBe("active");
  });

  it("reports security-only for a Node.js version past active support but before EOL", async () => {
    const { lookupEol } = await import("./eol.js");
    const result = lookupEol("nodejs", "22.1.0", new Date("2026-01-01"));
    expect(result.status).toBe("security-only");
  });

  it("returns a 'no fixed schedule' note for WordPress instead of a fabricated date", async () => {
    const { lookupEol } = await import("./eol.js");
    const result = lookupEol("wordpress", "6.0.0");
    expect(result.status).toBe("unknown");
    expect(result.note).toMatch(/does not publish/i);
  });

  it("returns unknown for an untracked technology", async () => {
    const { lookupEol } = await import("./eol.js");
    expect(lookupEol("some-random-tech", "1.0.0").status).toBe("unknown");
  });
});

describe("KEV cache", () => {
  it("returns undefined with no cache written yet", async () => {
    const { findKevEntry } = await import("./kev.js");
    expect(findKevEntry("CVE-2021-1234")).toBeUndefined();
  });
});

describe("OSV cache", () => {
  it("returns undefined for an uncached package/version", async () => {
    const { loadCachedOsv } = await import("./osv.js");
    expect(loadCachedOsv("npm", "jquery", "1.0.0")).toBeUndefined();
  });
});
