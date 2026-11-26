import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { ruleFileSchema, validateRuleDeep, type FingerprintRule } from "@adaiyalam/schema";
import { compileRule, emptyFacts, matchRule, type SiteFacts } from "@adaiyalam/engine";
import { DATA_DIR, loadDefaultRuleset } from "@adaiyalam/rules";
import { buildRuleQualityReport } from "@adaiyalam/orchestrator";
import { getScan, reportFalsePositive } from "@adaiyalam/store";

const FIXTURES_DIR = join(DATA_DIR, "..", "fixtures");

function loadRuleFile(path: string): FingerprintRule[] {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return ruleFileSchema.parse(raw).technologies;
}

async function lintRules(rules: FingerprintRule[]): Promise<boolean> {
  let ok = true;
  for (const rule of rules) {
    const report = await validateRuleDeep(rule);
    if (!report.ok) ok = false;
    for (const issue of report.issues) {
      const marker = issue.level === "error" ? "ERROR" : "WARN ";
      console.log(`  [${marker}] ${issue.ruleId}: ${issue.message}`);
    }
    if (report.issues.length === 0) {
      console.log(`  [ OK  ] ${rule.id}`);
    }
  }
  return ok;
}

interface Fixture {
  expect: "positive" | "negative";
  facts: Partial<SiteFacts>;
  description?: string;
}

function runFixturesFor(techId: string, rule: FingerprintRule): { pass: number; fail: number } {
  const dir = join(FIXTURES_DIR, techId);
  let pass = 0;
  let fail = 0;
  if (!existsSync(dir)) {
    console.log(`  (no fixtures in ${dir} — add positive-*.json / negative-*.json to test this rule offline)`);
    return { pass, fail };
  }
  const compiled = compileRule(rule, "test");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const fixture: Fixture = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const facts: SiteFacts = { ...emptyFacts("https://fixture.test", "fast"), ...fixture.facts };
    const result = matchRule(compiled, facts);
    const expectedMatch = fixture.expect === "positive";
    if (result.matched === expectedMatch) {
      pass++;
      console.log(`  [ OK  ] ${file} (expected ${fixture.expect}, confidence ${result.confidence})`);
    } else {
      fail++;
      console.log(`  [FAIL ] ${file} (expected ${fixture.expect}, got confidence ${result.confidence}, matched=${result.matched})`);
    }
  }
  return { pass, fail };
}

export function registerRuleCommand(program: Command): void {
  const rule = program.command("rule").description("Fingerprint rule authoring tools");

  rule
    .command("lint")
    .description("Validate rule file(s): schema, dangling references, ReDoS safety")
    .argument("[file]", "a single rule JSON file; omit to lint the whole bundled ruleset")
    .action(async (file?: string) => {
      const rules = file ? loadRuleFile(file) : loadDefaultRuleset();
      console.log(`Linting ${rules.length} rule(s)...`);
      const ok = await lintRules(rules);
      if (!ok) process.exitCode = 1;
    });

  rule
    .command("test")
    .description("Run positive/negative fixtures for a rule id against the matcher")
    .argument("<techId>", "technology id to test")
    .action((techId: string) => {
      const match = loadDefaultRuleset().find((r) => r.id === techId);
      if (!match) {
        console.error(`No rule with id "${techId}" in the bundled ruleset.`);
        process.exitCode = 1;
        return;
      }
      console.log(`Testing fixtures for "${techId}"...`);
      const { pass, fail } = runFixturesFor(techId, match);
      console.log(`\n${pass} passed, ${fail} failed.`);
      if (fail > 0) process.exitCode = 1;
    });

  rule
    .command("new")
    .description("Scaffold a new fingerprint rule JSON file")
    .argument("<techId>", "kebab-case technology id, e.g. my-cool-cms")
    .option("--category <category>", "primary category id", "miscellaneous")
    .option("--out <dir>", "output directory for the draft file")
    .action((techId: string, options) => {
      const draft = {
        schemaVersion: 1,
        technologies: [
          {
            id: techId,
            name: techId,
            description: "TODO: one-sentence description",
            website: "https://example.com",
            categories: [options.category],
            pricing: [],
            implies: [],
            requires: [],
            excludes: [],
            evidence: [
              {
                type: "header",
                key: "x-example-header",
                pattern: "TODO-REPLACE-ME/([0-9.]+)",
                flags: "i",
                confidence: 80,
                version: "$1",
                negative: false,
              },
            ],
          },
        ],
      };
      const outDir = options.out ?? join(DATA_DIR, "_drafts");
      mkdirSync(outDir, { recursive: true });
      const outPath = join(outDir, `${techId}.json`);
      writeFileSync(outPath, JSON.stringify(draft, null, 2) + "\n");
      console.log(`Wrote draft rule to ${outPath}`);
      console.log(`Next: fill in real evidence, run "adaiyalam rule lint ${outPath}", add fixtures under rules/fixtures/${techId}/, then move it into rules/data/.`);
    });

  rule
    .command("quality")
    .description("Rule-quality signal built from THIS installation's own scan history and false-positive reports (local only, never sent anywhere)")
    .option("--json", "print as JSON")
    .option("--only-flagged", "only show rules with at least one false-positive report")
    .option("--all", "also show rules never detected in any saved scan (omitted by default to cut noise)")
    .action((options) => {
      const fullReport = buildRuleQualityReport();
      if (options.json) {
        console.log(JSON.stringify(options.onlyFlagged ? fullReport.filter((r) => r.falsePositiveReports > 0) : fullReport, null, 2));
        return;
      }
      let rows = fullReport;
      if (options.onlyFlagged) rows = rows.filter((r) => r.falsePositiveReports > 0);
      else if (!options.all) rows = rows.filter((r) => r.timesDetected > 0 || r.falsePositiveReports > 0);

      if (fullReport.length === 0 || fullReport[0] === undefined) {
        console.log("No data yet — scan some sites first.");
        return;
      }
      console.log(`${fullReport[0].totalScans} saved scan(s) considered.\n`);
      if (rows.length === 0) {
        console.log("Nothing to show (pass --all to include never-detected rules).");
        return;
      }
      console.log("techId".padEnd(28) + "hits".padEnd(8) + "hit rate".padEnd(12) + "false-positive reports");
      for (const entry of rows) {
        console.log(entry.techId.padEnd(28) + String(entry.timesDetected).padEnd(8) + `${(entry.hitRate * 100).toFixed(1)}%`.padEnd(12) + String(entry.falsePositiveReports));
      }
    });

  rule
    .command("report-false-positive")
    .description("Record locally that a detection on a saved scan was wrong — never sent anywhere, just feeds 'adaiyalam rule quality'")
    .argument("<scanId>", 'a saved scan id, from "adaiyalam history"')
    .argument("<techId>", "the technology id that was wrongly detected")
    .option("--note <text>", "optional free-text note on why")
    .action((scanId: string, techId: string, options) => {
      const scan = getScan(scanId);
      if (!scan) {
        console.error(`No saved scan found with id ${scanId}. Use "adaiyalam history" to list saved scans.`);
        process.exitCode = 1;
        return;
      }
      if (!scan.techIds.includes(techId)) {
        console.error(`Scan ${scanId} did not detect "${techId}" — nothing to report.`);
        process.exitCode = 1;
        return;
      }
      const report = reportFalsePositive({ scanId, techId, url: scan.url, note: options.note });
      console.log(`Recorded false-positive report ${report.id} for "${techId}" on ${scan.url}.`);
    });
}
