import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GroundTruthFile } from "./ground-truth-types.js";

const DATA_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "ground-truth.json");

export function loadGroundTruth(): GroundTruthFile {
  return JSON.parse(readFileSync(DATA_PATH, "utf-8")) as GroundTruthFile;
}
