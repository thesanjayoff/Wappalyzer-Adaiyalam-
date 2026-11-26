import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { ruleFileSchema, validateRuleDeep, type FingerprintRule } from "@adaiyalam/schema";
import { compileRule, emptyFacts, matchRule, type SiteFacts } from "@adaiyalam/engine";
import { DATA_DIR, loadDefaultRuleset } from "@adaiyalam/rules";

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
}
