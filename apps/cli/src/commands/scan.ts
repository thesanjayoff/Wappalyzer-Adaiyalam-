import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { APP_NAME } from "@adaiyalam/config";
import { scanUrlFast, reportToCsv, reportToHtml, type ScanReport } from "@adaiyalam/orchestrator";
import { ensureNoticeAcknowledged } from "../notice.js";
import { categoryName } from "@adaiyalam/schema";

function writeExtraFormats(report: ScanReport, options: { html?: string; csv?: string }): void {
  if (options.html) {
    writeFileSync(options.html, reportToHtml(report));
    console.log(`  wrote HTML report to ${options.html} (open in a browser; use "Print to PDF" for a PDF copy)`);
  }
  if (options.csv) {
    writeFileSync(options.csv, reportToCsv(report));
    console.log(`  wrote CSV report to ${options.csv}`);
  }
}

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
  printInsights(report.insights);
}

function printInsights(insights: Awaited<ReturnType<typeof scanUrlFast>>["insights"]): void {
  const missingHeaders = insights.securityHeaders.filter((h) => !h.present);
  const lines: string[] = [];

  if (missingHeaders.length > 0) lines.push(`missing security headers: ${missingHeaders.map((h) => h.header).join(", ")}`);
  for (const banner of insights.exposedBanners) lines.push(`exposed version banner: ${banner.header}: ${banner.value}`);
  for (const tls of insights.tls) lines.push(`TLS issue: ${tls.detail}`);
  if (insights.mixedContent.length > 0) lines.push(`mixed content: ${insights.mixedContent.length} http:// resource(s) on an https page`);
  for (const cookie of insights.cookies) lines.push(`cookie '${cookie.name}': ${cookie.issues.join("; ")}`);
  for (const script of insights.supplyChain.missingIntegrity) lines.push(`CDN script without integrity hash: ${script.src}`);
  for (const domain of insights.supplyChain.typosquattingLikeDomains) lines.push(`domain '${domain.domain}' looks suspiciously close to '${domain.similarTo}'`);
  if (insights.privacy.trackers.length > 0) lines.push(`${insights.privacy.trackers.length} tracker(s): ${insights.privacy.trackers.map((t) => t.name).join(", ")}`);
  for (const vuln of insights.vulnerabilities) {
    const label = vuln.source === "osv" ? `${vuln.id} (${vuln.severity ?? "severity unknown"}${vuln.kev ? ", in CISA KEV" : ""})` : `${vuln.eolStatus}`;
    lines.push(`${vuln.name}${vuln.version ? ` v${vuln.version}` : ""}: ${label} — ${vuln.eolDetail ?? vuln.summary ?? ""}`);
  }

  if (lines.length === 0) return;
  console.log("\n  security & privacy notes (probabilistic hints, not confirmed findings):");
  for (const line of lines) console.log(`    - ${line}`);
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
    .option("--html <path>", "also write a self-contained HTML report to this path")
    .option("--csv <path>", "also write a CSV (one row per detected technology) to this path")
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
      writeExtraFormats(report, options);
    });

  program
    .command("scan-browser")
    .description("Scan a single URL in full (Playwright browser) mode")
    .argument("<url>", "URL to scan, e.g. https://example.com")
    .option("--json", "print the full JSON report instead of a human-readable summary")
    .option("--yes", "accept the usage notice non-interactively")
    .option("--allow-private-hosts", "allow scanning localhost/private IPs (for your own dev servers)")
    .option("--consent <action>", "try to click through a cookie-consent banner: accept, reject, or none", "none")
    .option("--html <path>", "also write a self-contained HTML report to this path")
    .option("--csv <path>", "also write a CSV (one row per detected technology) to this path")
    .action(async (url: string, options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const { scanUrlBrowser } = await import("@adaiyalam/orchestrator");
      const report = await scanUrlBrowser(url, {
        ssrf: { allowPrivateHosts: Boolean(options.allowPrivateHosts) },
        consentAction: options.consent,
      });
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        printHuman(report);
        if (report.savedScanId) console.log(`  saved as scan ${report.savedScanId} (use "adaiyalam history" to list)`);
      }
      writeExtraFormats(report, options);
    });

  program
    .command("export")
    .description("Re-render a previously saved scan (by id, from 'adaiyalam history') as JSON, HTML, or CSV without re-scanning the network")
    .argument("<scanId>")
    .option("--html <path>", "write a self-contained HTML report to this path")
    .option("--csv <path>", "write a CSV (one row per detected technology) to this path")
    .option("--json <path>", "write the full JSON report to this path")
    .action(async (scanId: string, options) => {
      const { getFacts } = await import("@adaiyalam/store");
      const { replayScan } = await import("@adaiyalam/orchestrator");
      const facts = getFacts(scanId);
      if (!facts) {
        console.error(`No saved scan found with id ${scanId}. Use "adaiyalam history" to list saved scans.`);
        process.exitCode = 1;
        return;
      }
      const report = replayScan(facts) as ScanReport;
      if (!options.html && !options.csv && !options.json) {
        console.error("Pass at least one of --html, --csv, --json.");
        process.exitCode = 1;
        return;
      }
      if (options.json) writeFileSync(options.json, JSON.stringify(report, null, 2));
      writeExtraFormats(report, options);
    });
}
