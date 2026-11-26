import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "adaiyalam-bulk-test-"));
  process.env.ADAIYALAM_HOME = tempDir;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.ADAIYALAM_HOME;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("bulk job store", () => {
  it("creates a job, dedupes URLs, and marks every URL pending", async () => {
    const { createBulkJob, getBulkJob } = await import("./bulk.js");
    const job = createBulkJob(["https://a.example", "https://b.example", "https://a.example"], { concurrency: 2, globalRps: 5, perHostDelayMs: 1000 });

    expect(job.urls).toEqual(["https://a.example", "https://b.example"]);
    expect(Object.values(job.results).every((r) => r.status === "pending")).toBe(true);
    expect(getBulkJob(job.id)?.id).toBe(job.id);
  });

  it("persists per-URL results and computes progress", async () => {
    const { createBulkJob, setBulkUrlResult, getBulkJob, bulkJobProgress } = await import("./bulk.js");
    const job = createBulkJob(["https://a.example", "https://b.example"], { concurrency: 2, globalRps: 5, perHostDelayMs: 1000 });

    setBulkUrlResult(job.id, "https://a.example", { status: "ok", scanId: "s1", detections: [{ techId: "nginx", categories: ["web-server"] }] });
    setBulkUrlResult(job.id, "https://b.example", { status: "error", error: "timeout" });

    const reloaded = getBulkJob(job.id)!;
    const progress = bulkJobProgress(reloaded);
    expect(progress).toEqual({ total: 2, done: 2, ok: 1, error: 1, blocked: 0, pending: 0 });
  });

  it("lists jobs newest first", async () => {
    const { createBulkJob, listBulkJobs } = await import("./bulk.js");
    const job1 = createBulkJob(["https://a.example"], { concurrency: 1, globalRps: 5, perHostDelayMs: 1000 });
    await new Promise((r) => setTimeout(r, 2));
    const job2 = createBulkJob(["https://b.example"], { concurrency: 1, globalRps: 5, perHostDelayMs: 1000 });

    const jobs = listBulkJobs();
    expect(jobs[0]?.id).toBe(job2.id);
    expect(jobs[1]?.id).toBe(job1.id);
  });

  it("setBulkJobStatus updates and returns the job, or undefined for an unknown id", async () => {
    const { createBulkJob, setBulkJobStatus } = await import("./bulk.js");
    const job = createBulkJob(["https://a.example"], { concurrency: 1, globalRps: 5, perHostDelayMs: 1000 });

    expect(setBulkJobStatus(job.id, "cancelled")?.status).toBe("cancelled");
    expect(setBulkJobStatus("not-a-real-id", "cancelled")).toBeUndefined();
  });
});
