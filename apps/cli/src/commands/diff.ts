import { spawn } from "node:child_process";
import { Command } from "commander";
import { diffScans, diffSiteLatest, compareSites, hasMeaningfulChange, scanUrlFast } from "@adaiyalam/orchestrator";
import type { ScanDiff } from "@adaiyalam/orchestrator";
import { ensureNoticeAcknowledged } from "../notice.js";

function printDiff(diff: ScanDiff): void {
  console.log(`${diff.hostname}: ${diff.before.scannedAt} -> ${diff.after.scannedAt}`);
  console.log(`  added ${diff.summary.added}, removed ${diff.summary.removed}, version changed ${diff.summary.versionChanged}, confidence changed ${diff.summary.confidenceChanged}`);
  for (const entry of diff.entries) {
    if (entry.change === "unchanged") continue;
    if (entry.change === "added") console.log(`  + ${entry.name}${entry.after?.version ? ` v${entry.after.version}` : ""}`);
    else if (entry.change === "removed") console.log(`  - ${entry.name}${entry.before?.version ? ` v${entry.before.version}` : ""}`);
    else if (entry.change === "version-changed") console.log(`  ~ ${entry.name}: v${entry.before?.version ?? "?"} -> v${entry.after?.version ?? "?"}`);
    else console.log(`  ~ ${entry.name}: confidence ${entry.before?.confidence}% -> ${entry.after?.confidence}%`);
  }
}

export function registerDiffCommand(program: Command): void {
  program
    .command("diff")
    .description("Diff two saved scans (by default, a site's two most recent) — a possible platform migration or stack change")
    .argument("[hostname]", "diff this site's two most recent saved scans")
    .option("--scans <ids...>", "diff two specific scan IDs instead of a hostname's latest two: --scans <beforeId> <afterId>")
    .option("--json", "print as JSON")
    .action((hostname: string | undefined, options) => {
      const [scanA, scanB] = (options.scans as [string, string] | undefined) ?? [];
      let diff: ScanDiff | undefined;
      if (scanA && scanB) {
        diff = diffScans(scanA, scanB);
      } else if (hostname) {
        diff = diffSiteLatest(hostname);
        if (!diff) {
          console.error(`"${hostname}" has fewer than two saved scans — nothing to diff yet.`);
          process.exitCode = 1;
          return;
        }
      } else {
        console.error("Pass a hostname, or --scans <a> <b>.");
        process.exitCode = 1;
        return;
      }

      if (options.json) console.log(JSON.stringify(diff, null, 2));
      else printDiff(diff);
    });

  program
    .command("compare")
    .description("Compare 2+ sites' most recent scans side by side")
    .argument("<hostnames...>", "hostnames with at least one saved scan each")
    .option("--json", "print as JSON")
    .action((hostnames: string[], options) => {
      if (hostnames.length < 2) {
        console.error("Pass at least two hostnames to compare.");
        process.exitCode = 1;
        return;
      }
      let result;
      try {
        result = compareSites(hostnames);
      } catch (err) {
        console.error((err as Error).message);
        process.exitCode = 1;
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      console.log(`Comparing: ${result.sites.map((s) => s.hostname).join(", ")}`);
      for (const tech of result.technologies) {
        const cells = result.sites.map((s) => {
          const snap = tech.presentIn[s.hostname];
          return snap ? `${s.hostname}: v${snap.version ?? "?"} (${snap.confidence}%)` : `${s.hostname}: —`;
        });
        console.log(`  ${tech.name.padEnd(28)} ${cells.join("  |  ")}`);
      }
    });

  program
    .command("watch")
    .description("Periodically re-scan a URL, diffing each run against the previous one (Ctrl+C to stop)")
    .argument("<url>")
    .option("--interval-minutes <n>", "minutes between scans", "60")
    .option("--once", "scan once and exit instead of looping")
    .option("--notify-cmd <command>", "shell command to run when a meaningful change is detected (the diff JSON is piped to its stdin)")
    .option("--yes", "accept the usage notice non-interactively")
    .action(async (url: string, options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const hostname = new URL(url).hostname;
      const intervalMs = Math.max(1, Number(options.intervalMinutes)) * 60_000;

      let keepGoing = true;
      process.on("SIGINT", () => {
        console.log("\nStopping watch...");
        keepGoing = false;
      });

      while (keepGoing) {
        const report = await scanUrlFast(url, { save: true });
        console.log(`[${report.scannedAt}] scanned ${hostname}: ${report.detections.length} technologies`);

        const diff = diffSiteLatest(hostname);
        if (diff && hasMeaningfulChange(diff)) {
          printDiff(diff);
          if (options.notifyCmd) {
            const child = spawn(options.notifyCmd, { shell: true, stdio: ["pipe", "inherit", "inherit"] });
            child.stdin.write(JSON.stringify(diff));
            child.stdin.end();
          }
        } else if (diff) {
          console.log("  no change since the previous scan.");
        }

        if (options.once || !keepGoing) break;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    });
}
