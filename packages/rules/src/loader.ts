import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ruleFileSchema, type FingerprintRule } from "@adaiyalam/schema";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export function listRuleFiles(): string[] {
  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(DATA_DIR, f));
}

export function loadDefaultRuleset(): FingerprintRule[] {
  const technologies: FingerprintRule[] = [];
  for (const file of listRuleFiles()) {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    const parsed = ruleFileSchema.parse(raw);
    technologies.push(...parsed.technologies);
  }
  return technologies;
}

export { DATA_DIR };
