import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDefaultRuleset } from "@adaiyalam/rules";

// Runs at BUILD time (via tsx, with full Node fs access) and writes a plain
// JSON array the browser bundle can `import` directly — the extension
// itself never touches the filesystem, so @adaiyalam/rules' Node-only
// loader never ships to the browser.
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const rules = loadDefaultRuleset();
writeFileSync(join(outDir, "rules-bundle.json"), JSON.stringify(rules));
console.log(`Wrote ${rules.length} rules to src/rules-bundle.json`);
