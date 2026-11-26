import { readFileSync } from "node:fs";
import { Command } from "commander";
import { createBulkJob, getBulkJob, listBulkJobs, setBulkJobStatus, bulkJobProgress } from "@adaiyalam/store";
import { runBulkScan, aggregateBulkJob } from "@adaiyalam/orchestrator";
import { ensureNoticeAcknowledged } from "../notice.js";

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function readUrlList(file: string): string[] {
  return readFileSync(file, "utf-8")
    .split(/\r?\n/)
    .map(normalizeUrl)
    .filter(Boolean);
}

function printProgress(jobId: string): void {
  const job = getBulkJob(jobId);
  if (!job) return;
  const p = bulkJobProgress(job);
  console.log(`[${jobId}] ${job.status} — ${p.done}/${p.total} done (ok ${p.ok}, error ${p.error}, blocked ${p.blocked})`);
}

export function registerBulkCommand(program: Command): void {
  const bulk = program.command("bulk").description("Scan many domains at once (fast mode), with shared rate limiting, pause/resume, and aggregate analytics");

  bulk
    .command("start")
    .description("Start a new bulk scan job from a file of one URL/domain per line")
    .requiredOption("--file <path>", "path to a text file with one URL or domain per line")
    .option("--concurrency <n>", "number of sites to scan in parallel", "5")
    .option("--global-rps <n>", "max requests/second across all hosts combined", "5")
    .option("--host-delay-ms <n>", "minimum delay between requests to the same host", "1500")
    .option("--yes", "accept the usage + bulk-scan notices non-interactively")
    .action(async (options) => {
      await ensureNoticeAcknowledged({ bulk: true, assumeYes: options.yes });
      const urls = readUrlList(options.file);
      if (urls.length === 0) {
        console.error("No URLs found in the given file.");
        process.exitCode = 1;
        return;
      }
      const job = createBulkJob(urls, {
        concurrency: Number(options.concurrency),
        globalRps: Number(options.globalRps),
        perHostDelayMs: Number(options.hostDelayMs),
      });
      console.log(`Started bulk job ${job.id} with ${job.urls.length} unique URL(s), concurrency ${job.concurrency}.`);
      await runJob(job.id);
    });

  bulk
    .command("resume")
    .description("Resume a paused or interrupted bulk job (skips URLs already scanned)")
    .argument("<jobId>")
    .action(async (jobId: string) => {
      const job = getBulkJob(jobId);
      if (!job) {
        console.error(`No bulk job with id ${jobId}`);
        process.exitCode = 1;
        return;
      }
      await runJob(jobId);
    });

  bulk
    .command("list")
    .description("List bulk jobs")
    .action(() => {
      const jobs = listBulkJobs();
      if (jobs.length === 0) {
        console.log("No bulk jobs yet.");
        return;
      }
      for (const job of jobs) {
        const p = bulkJobProgress(job);
        console.log(`${job.createdAt}  ${job.id}  ${job.status.padEnd(10)} ${p.done}/${p.total} done`);
      }
    });

  bulk
    .command("status")
    .description("Show progress for a bulk job")
    .argument("<jobId>")
    .action((jobId: string) => printProgress(jobId));

  bulk
    .command("cancel")
    .description("Mark a bulk job as cancelled (it will not be resumed)")
    .argument("<jobId>")
    .action((jobId: string) => {
      const job = setBulkJobStatus(jobId, "cancelled");
      if (!job) {
        console.error(`No bulk job with id ${jobId}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Cancelled bulk job ${jobId}.`);
    });

  bulk
    .command("export")
    .description("Export per-URL results for a bulk job as JSON or CSV")
    .argument("<jobId>")
    .option("--format <format>", "json or csv", "json")
    .action((jobId: string, options) => {
      const job = getBulkJob(jobId);
      if (!job) {
        console.error(`No bulk job with id ${jobId}`);
        process.exitCode = 1;
        return;
      }
      if (options.format === "csv") {
        console.log("url,status,techIds,error");
        for (const url of job.urls) {
          const r = job.results[url];
          const techIds = (r?.detections ?? []).map((d) => d.techId).join("|");
          const error = (r?.error ?? "").replace(/,/g, ";");
          console.log(`${url},${r?.status ?? "pending"},${techIds},${error}`);
        }
      } else {
        console.log(JSON.stringify(job, null, 2));
      }
    });

  bulk
    .command("aggregate")
    .description("Aggregate analytics for a completed/partial bulk job: market share, co-occurrence, version distribution, EOL share")
    .argument("<jobId>")
    .option("--json", "print as JSON")
    .action((jobId: string, options) => {
      const report = aggregateBulkJob(jobId);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Sites scanned: ${report.sitesScanned} (errors/blocked: ${report.sitesWithErrors})`);
      console.log("\nTechnology market share:");
      for (const t of report.techMarketShare.slice(0, 20)) {
        console.log(`  ${t.name.padEnd(28)} ${t.count} (${(t.share * 100).toFixed(1)}%)`);
      }
      if (report.eolShare.length > 0) {
        console.log("\nEnd-of-life / security-only share:");
        for (const e of report.eolShare) {
          console.log(`  ${e.name.padEnd(28)} EOL: ${e.eolCount}, security-only: ${e.securityOnlyCount} (of ${e.totalWithVersion} with a known version)`);
        }
      }
      if (report.topCoOccurrences.length > 0) {
        console.log("\nTop co-occurring technology pairs:");
        for (const c of report.topCoOccurrences.slice(0, 10)) {
          console.log(`  ${c.techA} + ${c.techB}: ${c.count}`);
        }
      }
    });
}

async function runJob(jobId: string): Promise<void> {
  const abortController = new AbortController();
  const onSigint = () => {
    console.log("\nStopping after in-flight requests finish (progress is already saved; resume anytime with 'adaiyalam bulk resume " + jobId + "')...");
    abortController.abort();
  };
  process.on("SIGINT", onSigint);

  let ticks = 0;
  try {
    await runBulkScan(jobId, {
      signal: abortController.signal,
      onProgress: (job) => {
        ticks++;
        const p = bulkJobProgress(job);
        if (ticks % 10 === 0 || p.pending === 0) printProgress(jobId);
      },
    });
  } finally {
    process.off("SIGINT", onSigint);
  }
  printProgress(jobId);
}
