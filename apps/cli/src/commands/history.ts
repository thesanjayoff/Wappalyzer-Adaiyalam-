import { Command } from "commander";
import { deleteSite, getFacts, getScan, listScans, listSites } from "@adaiyalam/store";
import { replayScan } from "@adaiyalam/orchestrator";

export function registerHistoryCommands(program: Command): void {
  program
    .command("history")
    .description("List previously saved scans")
    .option("--host <hostname>", "filter by hostname")
    .option("--json", "print as JSON")
    .action((options) => {
      const scans = listScans(options.host ? { hostname: options.host } : undefined);
      if (options.json) {
        console.log(JSON.stringify(scans, null, 2));
        return;
      }
      if (scans.length === 0) {
        console.log("No saved scans yet.");
        return;
      }
      for (const scan of scans) {
        console.log(`${scan.scannedAt}  ${scan.id}  ${scan.hostname.padEnd(30)} ${scan.detectionCount} tech(es)  status ${scan.statusCode}`);
      }
    });

  program
    .command("sites")
    .description("List distinct sites with saved scans")
    .action(() => {
      const sites = listSites();
      if (sites.length === 0) {
        console.log("No saved sites yet.");
        return;
      }
      for (const site of sites) {
        console.log(`${site.hostname.padEnd(30)} ${site.scanIds.length} scan(s)${site.tags.length ? `  tags: ${site.tags.join(", ")}` : ""}`);
      }
    });

  program
    .command("replay")
    .description("Re-run the matcher against a saved scan's facts snapshot with the current ruleset (no network access)")
    .argument("<scanId>")
    .option("--json", "print as JSON")
    .action((scanId: string, options) => {
      const scan = getScan(scanId);
      const facts = getFacts(scanId);
      if (!scan || !facts) {
        console.error(`No saved scan with id "${scanId}"`);
        process.exitCode = 1;
        return;
      }
      const report = replayScan(facts);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Replayed ${scan.hostname} (originally scanned ${scan.scannedAt}) against the current ruleset:`);
      for (const detection of report.detections) {
        console.log(`  - ${detection.name} (${detection.confidence}%)`);
      }
    });

  program
    .command("forget")
    .description("Permanently delete all saved scans for a site")
    .argument("<hostname>")
    .action((hostname: string) => {
      deleteSite(hostname);
      console.log(`Deleted all saved data for "${hostname}".`);
    });
}
