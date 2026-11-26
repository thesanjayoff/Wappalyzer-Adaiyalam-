import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "@adaiyalam/config";
import type { BulkJobRecord, BulkUrlResult } from "./bulk-types.js";

export type { BulkJobRecord, BulkUrlResult, BulkJobStatus, BulkUrlStatus } from "./bulk-types.js";

function jobPath(id: string): string {
  return join(PATHS.bulkJobs, `${id}.json`);
}

function ensureDir(): void {
  mkdirSync(PATHS.bulkJobs, { recursive: true });
}

export function createBulkJob(urls: string[], options: { concurrency: number; globalRps: number; perHostDelayMs: number }): BulkJobRecord {
  ensureDir();
  const deduped = [...new Set(urls.map((u) => u.trim()).filter(Boolean))];
  const now = new Date().toISOString();
  const job: BulkJobRecord = {
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "running",
    concurrency: options.concurrency,
    globalRps: options.globalRps,
    perHostDelayMs: options.perHostDelayMs,
    urls: deduped,
    results: Object.fromEntries(deduped.map((u) => [u, { status: "pending" } as BulkUrlResult])),
  };
  saveBulkJob(job);
  return job;
}

export function saveBulkJob(job: BulkJobRecord): void {
  ensureDir();
  job.updatedAt = new Date().toISOString();
  writeFileSync(jobPath(job.id), JSON.stringify(job, null, 2));
}

export function getBulkJob(id: string): BulkJobRecord | undefined {
  const path = jobPath(id);
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf-8")) as BulkJobRecord;
}

export function listBulkJobs(): BulkJobRecord[] {
  if (!existsSync(PATHS.bulkJobs)) return [];
  return readdirSync(PATHS.bulkJobs)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(PATHS.bulkJobs, f), "utf-8")) as BulkJobRecord)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function setBulkUrlResult(jobId: string, url: string, result: BulkUrlResult): void {
  const job = getBulkJob(jobId);
  if (!job) return;
  job.results[url] = result;
  saveBulkJob(job);
}

export function setBulkJobStatus(jobId: string, status: BulkJobRecord["status"]): BulkJobRecord | undefined {
  const job = getBulkJob(jobId);
  if (!job) return undefined;
  job.status = status;
  saveBulkJob(job);
  return job;
}

export function bulkJobProgress(job: BulkJobRecord): { total: number; done: number; ok: number; error: number; blocked: number; pending: number } {
  const values = Object.values(job.results);
  return {
    total: job.urls.length,
    done: values.filter((r) => r.status !== "pending" && r.status !== "running").length,
    ok: values.filter((r) => r.status === "ok").length,
    error: values.filter((r) => r.status === "error").length,
    blocked: values.filter((r) => r.status === "blocked").length,
    pending: values.filter((r) => r.status === "pending" || r.status === "running").length,
  };
}
