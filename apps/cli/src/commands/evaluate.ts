import { writeFileSync } from "node:fs";
import { Command } from "commander";
import { runGroundTruthEval, buildCalibrationReport, runRedosReport, runFastVsFull } from "@adaiyalam/evaluation";
import { ensureNoticeAcknowledged } from "../notice.js";

export function registerEvaluateCommand(program: Command): void {
  const evaluate = program.command("evaluate").description("Run the evaluation harness: precision/recall against a small verified ground-truth set, ReDoS/rule-quality report, fast-vs-full comparison");

  evaluate
    .command("ground-truth")
    .description("Scan the bundled ground-truth sites and report precision/recall/F1 plus confidence calibration (hits the real network)")
    .option("--json", "print as JSON")
    .option("--yes", "accept the usage notice non-interactively")
    .action(async (options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const report = await runGroundTruthEval();
      const calibration = buildCalibrationReport(report.perSite);

      if (options.json) {
        console.log(JSON.stringify({ ...report, calibration }, null, 2));
        return;
      }

      console.log(`Ground truth verified as of ${report.verifiedAsOf}. Evaluated ${report.sitesEvaluated} site(s), ${report.sitesErrored.length} error(s).`);
      console.log(`\nNOTE: ${report.note}`);
      console.log(`\nOverall: precision ${(report.overall.precision * 100).toFixed(1)}%, recall ${(report.overall.recall * 100).toFixed(1)}%, F1 ${(report.overall.f1 * 100).toFixed(1)}%`);
      console.log(`  (TP ${report.overall.truePositives}, FP ${report.overall.falsePositives}, FN ${report.overall.falseNegatives})`);

      console.log("\nPer technology:");
      for (const t of report.perTechnology) {
        console.log(`  ${t.techId.padEnd(16)} precision ${(t.precision * 100).toFixed(0)}%  recall ${(t.recall * 100).toFixed(0)}%  (tp ${t.truePositives}, fp ${t.falsePositives}, fn ${t.falseNegatives})`);
      }

      if (calibration.length > 0) {
        console.log("\nConfidence calibration (small sample — see caveat in docs):");
        for (const bucket of calibration) {
          console.log(`  ${bucket.range}%: ${(bucket.accuracy * 100).toFixed(0)}% correct (n=${bucket.samples})`);
        }
      }

      for (const err of report.sitesErrored) console.log(`\nERROR scanning ${err.url}: ${err.error}`);
    });

  evaluate
    .command("redos")
    .description("Report ReDoS-timing results for every pattern in the default ruleset")
    .option("--json", "print as JSON")
    .action(async (options) => {
      const report = await runRedosReport();
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Checked ${report.patternsChecked} pattern(s) across ${report.rulesChecked} rule(s) in ${report.totalElapsedMs}ms. Unsafe: ${report.unsafeCount}.`);
      if (report.unsafePatterns.length > 0) {
        console.log("\nUnsafe patterns:");
        for (const p of report.unsafePatterns) console.log(`  ${p.techId}[${p.patternIndex}]: ${p.reason}`);
      }
      console.log("\nSlowest patterns:");
      for (const p of report.slowestPatterns) console.log(`  ${p.techId}[${p.patternIndex}]: ${p.elapsedMs}ms`);
    });

  evaluate
    .command("fast-vs-full")
    .description("Scan the given URLs in both fast and full mode and diff the detections")
    .argument("<urls...>")
    .option("--json", "print as JSON")
    .option("--yes", "accept the usage notice non-interactively")
    .action(async (urls: string[], options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const report = await runFastVsFull(urls);
      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      console.log(`Fast mode found ${(report.fastModeRecallVsFull * 100).toFixed(0)}% of all technologies either mode found.`);
      for (const site of report.sites) {
        if (site.error) {
          console.log(`\n${site.url}: ERROR ${site.error}`);
          continue;
        }
        console.log(`\n${site.url}`);
        console.log(`  both: ${site.both.join(", ") || "(none)"}`);
        if (site.fastOnly.length) console.log(`  fast-only: ${site.fastOnly.join(", ")}`);
        if (site.browserOnly.length) console.log(`  browser-only: ${site.browserOnly.join(", ")}`);
      }
    });

  evaluate
    .command("report")
    .description("Run ground-truth + ReDoS checks and write a combined JSON report to a file")
    .option("-o, --out <path>", "output file path", "evaluation-report.json")
    .option("--yes", "accept the usage notice non-interactively")
    .action(async (options) => {
      await ensureNoticeAcknowledged({ assumeYes: options.yes });
      const groundTruth = await runGroundTruthEval();
      const calibration = buildCalibrationReport(groundTruth.perSite);
      const redos = await runRedosReport();
      const combined = { generatedAt: new Date().toISOString(), groundTruth: { ...groundTruth, calibration }, redos };
      writeFileSync(options.out, JSON.stringify(combined, null, 2));
      console.log(`Wrote evaluation report to ${options.out}`);
    });
}
