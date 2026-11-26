import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command } from "commander";
import { convertCommunityPack, type CommunityPackFile } from "@adaiyalam/community-import";
import { fingerprintSchema, validateRuleDeep } from "@adaiyalam/schema";

export function registerImportCommand(program: Command): void {
  const importCmd = program.command("import").description("Convert third-party fingerprint data into Adaiyalam's own rule format (off by default; never run automatically)");

  importCmd
    .command("community-pack")
    .description(
      "Convert a community fingerprint pack (an apps.json-style technology-name -> signals file YOU supply) into draft Adaiyalam rules. " +
        "Adaiyalam does not bundle or redistribute any such file — you must already have your own legally-obtained copy, under its own license.",
    )
    .argument("<file>", "path to the community pack JSON file you supply")
    .requiredOption("--license <name>", "the source pack's license (e.g. \"MIT\", \"CC-BY-SA-4.0\", \"proprietary - internal use only\") — required so it's always displayed, never silently assumed")
    .requiredOption("--source <description>", "where this file came from (repo URL, vendor name, internal doc, etc.) — recorded in every converted rule's notes")
    .option("--out-dir <dir>", "output directory for draft rule files (kept separate from the bundled ruleset)", "./imported-rules")
    .option("--default-confidence <n>", "confidence (1-100) to assign to signals that don't specify their own", "50")
    .action(async (file: string, options) => {
      console.log("=".repeat(72));
      console.log("THIRD-PARTY FINGERPRINT IMPORT");
      console.log(`Source:  ${options.source}`);
      console.log(`License: ${options.license}`);
      console.log(
        "Adaiyalam does not bundle, ship, or claim any rights to this data.\n" +
          "You are responsible for complying with the above license. Converted\n" +
          "rules are written as DRAFTS to a separate directory below and are NOT\n" +
          "added to the bundled ruleset automatically.",
      );
      console.log("=".repeat(72));

      const defaultConfidence = Number.parseInt(options.defaultConfidence, 10);
      if (!Number.isFinite(defaultConfidence) || defaultConfidence < 1 || defaultConfidence > 100) {
        console.error("--default-confidence must be an integer between 1 and 100.");
        process.exitCode = 1;
        return;
      }

      let pack: CommunityPackFile;
      try {
        pack = JSON.parse(readFileSync(file, "utf-8"));
      } catch (err) {
        console.error(`Could not read/parse ${file}: ${(err as Error).message}`);
        process.exitCode = 1;
        return;
      }

      const sourceLabel = `${options.source} (license: ${options.license})`;
      const { rules, warnings, skipped } = convertCommunityPack(pack, { sourceLabel, defaultConfidence });

      mkdirSync(options.outDir, { recursive: true });
      let written = 0;
      let failedValidation = 0;
      for (const { id, rule } of rules) {
        const parsed = fingerprintSchema.safeParse(rule);
        if (!parsed.success) {
          failedValidation++;
          console.log(`  [SKIP ] ${id}: failed schema validation (${parsed.error.issues[0]?.message ?? "unknown error"})`);
          continue;
        }
        const report = await validateRuleDeep(parsed.data);
        if (!report.ok) {
          failedValidation++;
          console.log(`  [SKIP ] ${id}: ${report.issues.find((i) => i.level === "error")?.message ?? "validation failed"}`);
          continue;
        }
        const outPath = join(options.outDir, `${id}.json`);
        writeFileSync(outPath, JSON.stringify({ schemaVersion: 1, technologies: [parsed.data] }, null, 2) + "\n");
        written++;
      }

      console.log(`\n${written} draft rule(s) written to ${options.outDir}/.`);
      if (failedValidation > 0) console.log(`${failedValidation} rule(s) skipped — failed Adaiyalam's own schema/ReDoS validation after conversion.`);
      if (skipped.length > 0) console.log(`${skipped.length} technology/technologies skipped from the source file (no convertible signal fields).`);
      if (warnings.length > 0) {
        console.log(`\n${warnings.length} warning(s):`);
        for (const w of warnings.slice(0, 20)) console.log(`  - ${w.techName}: ${w.message}`);
        if (warnings.length > 20) console.log(`  ... and ${warnings.length - 20} more`);
      }
      console.log(
        `\nThese are drafts, not verified rules: every confidence value is a provisional default, not an independent assessment.\n` +
          `Review each file, add fixtures, run "adaiyalam rule lint <file>", and only then manually copy the ones you trust into\n` +
          `packages/rules/data/ — nothing here is added to the bundled ruleset automatically.`,
      );
    });
}
