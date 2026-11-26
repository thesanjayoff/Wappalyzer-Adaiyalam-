import { createRateLimiter, SsrfBlockedError } from "@adaiyalam/collectors";
import { getBulkJob, saveBulkJob, setBulkUrlResult, bulkJobProgress, type BulkJobRecord } from "@adaiyalam/store";
import { scanUrlFast } from "./scan.js";

export interface BulkRunOptions {
  /** Aborting stops launching new work; URLs already in flight are allowed to finish. */
  signal?: AbortSignal;
  allowPrivateHosts?: boolean;
  onProgress?: (job: BulkJobRecord) => void;
}

/**
 * Runs (or resumes) a bulk scan job: a worker pool of `job.concurrency`
 * fast-mode scans sharing ONE rate limiter, so the configured global RPS
 * and per-host delay are enforced across the whole job, not per worker.
 * Each URL's result is written to disk as soon as it finishes, so killing
 * the process (or an aborted signal) loses at most the in-flight requests —
 * a later `resume` call picks up every URL still marked pending/running.
 */
export async function runBulkScan(jobId: string, options: BulkRunOptions = {}): Promise<BulkJobRecord> {
  const job = getBulkJob(jobId);
  if (!job) throw new Error(`No bulk job found with id ${jobId}`);

  // Any URL left "running" from a previous interrupted run gets re-queued.
  for (const url of job.urls) {
    if (job.results[url]?.status === "running") job.results[url] = { status: "pending" };
  }
  job.status = "running";
  saveBulkJob(job);

  const rateLimiter = createRateLimiter({ globalRps: job.globalRps, perHostDelayMs: job.perHostDelayMs });
  let cursor = 0;
  const pending = job.urls.filter((u) => job.results[u]?.status === "pending" || job.results[u]?.status === "error");

  async function worker(): Promise<void> {
    while (cursor < pending.length) {
      if (options.signal?.aborted) return;
      const url = pending[cursor++];
      if (!url) continue;

      setBulkUrlResult(jobId, url, { status: "running" });
      try {
        const report = await scanUrlFast(url, {
          rateLimiter,
          ssrf: { allowPrivateHosts: options.allowPrivateHosts },
          save: true,
        });
        setBulkUrlResult(jobId, url, {
          status: "ok",
          scanId: report.savedScanId,
          detections: report.detections.map((d) => ({ techId: d.techId, categories: d.categories, version: d.version?.value })),
          finishedAt: new Date().toISOString(),
        });
      } catch (err) {
        const blocked = err instanceof SsrfBlockedError;
        setBulkUrlResult(jobId, url, {
          status: blocked ? "blocked" : "error",
          error: err instanceof Error ? err.message : String(err),
          finishedAt: new Date().toISOString(),
        });
      }
      options.onProgress?.(getBulkJob(jobId)!);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, job.concurrency) }, () => worker()));

  const finalJob = getBulkJob(jobId)!;
  const progress = bulkJobProgress(finalJob);
  finalJob.status = options.signal?.aborted ? "paused" : progress.pending > 0 ? "paused" : "completed";
  saveBulkJob(finalJob);
  return finalJob;
}
