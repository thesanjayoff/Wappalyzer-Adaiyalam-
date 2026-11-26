import { Command } from "commander";
import { APP_NAME } from "@adaiyalam/config";
import { scanUrlFast } from "@adaiyalam/orchestrator";
import { ensureNoticeAcknowledged } from "../notice.js";
import { categoryName } from "@adaiyalam/schema";

function printHuman(report: Awaited<ReturnType<typeof scanUrlFast>>): void {
  console.log(`\n${APP_NAME} scan of ${report.url}`);
  console.log(`  final URL: ${report.facts.finalUrl}`);
  if (report.facts.redirectChain.length > 0) console.log(`  redirects: ${report.facts.redirectChain.join(" -> ")}`);
  console.log(`  status: ${report.facts.statusCode}${report.facts.tlsValid === false ? " (TLS certificate invalid)" : ""}`);
  if (report.facts.errors.length > 0) console.log(`  notes: ${report.facts.errors.join("; ")}`);

  if (report.detections.length === 0) {
    console.log("\n  No technologies detected.");
    return;
  }

  const byCategory = new Map<string, typeof report.detections>();
  for (const detection of report.detections) {
    for (const category of detection.categories) {
      const list = byCategory.get(category) ?? [];
      list.push(detection);
      byCategory.set(category, list);
    }
  }

  console.log("");
  for (const [category, detections] of byCategory) {
    console.log(`  ${categoryName(category)}:`);
    for (const detection of [...new Set(detections)]) {
      const version = detection.version?.value ? ` v${detection.version.value} (${detection.version.confidence})` : "";
      const implied = detection.impliedBy.length > 0 ? ` [implied by: ${detection.impliedBy.join(", ")}]` : "";
      console.log(`    - ${detection.name}${version} — confidence ${detection.confidence}%${implied}`);
    }
  }
  console.log(`\n  ruleset version: ${report.rulesetVersion}`);
}

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan a single URL in fast (HTTP-only) mode")
    .argument("<url>", "URL to scan, e.g. https://example.com")
    .option("--json", "print the full JSON report instead of a human-readable summary")
    .option("--yes", "accept the usage notice non-interactively")
    .option("--global-rps <n>", "max requests/second across all hosts", "5")
    .option("--host-delay-ms <n>", "minimum delay between requests to the same host", "1500")
    .option("--allow-private-hosts", "allow scanning localhost/private IPs (for your own dev servers)")
    .option("--no-save", "do not persist this scan to local history")
    .action(async (url: string, options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const report = await scanUrlFast(url, {
        rateLimit: { globalRps: Number(options.globalRps), perHostDelayMs: Number(options.hostDelayMs) },
        ssrf: { allowPrivateHosts: Boolean(options.allowPrivateHosts) },
        save: options.save !== false,
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHuman(report);
        if (report.savedScanId) console.log(`  saved as scan ${report.savedScanId} (use "adaiyalam history" to list)`);
      }
    });
}
