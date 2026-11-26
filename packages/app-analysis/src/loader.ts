import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appRuleFileSchema, type AppFingerprintRule } from "./types.js";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

export function loadDefaultAppRuleset(): AppFingerprintRule[] {
  const files = readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => join(DATA_DIR, f));
  const rules: AppFingerprintRule[] = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    rules.push(...appRuleFileSchema.parse(raw).technologies);
  }
  return rules;
}

export { DATA_DIR };
