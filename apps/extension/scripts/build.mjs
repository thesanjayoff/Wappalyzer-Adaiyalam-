import { existsSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");

if (!existsSync(join(root, "src", "rules-bundle.json"))) {
  console.error("src/rules-bundle.json is missing — run `tsx scripts/build-rules-bundle.ts` first (the npm `build` script does this automatically).");
  process.exit(1);
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

await esbuild.build({
  entryPoints: [join(root, "src", "popup.ts")],
  bundle: true,
  outfile: join(distDir, "popup.js"),
  format: "iife",
  platform: "browser",
  target: "chrome102",
  minify: false,
  sourcemap: true,
  logLevel: "info",
});

copyFileSync(join(root, "manifest.json"), join(distDir, "manifest.json"));
copyFileSync(join(root, "src", "popup.html"), join(distDir, "popup.html"));
copyFileSync(join(root, "src", "popup.css"), join(distDir, "popup.css"));

console.log(`Extension built to ${distDir}`);
console.log(`Load it in Chrome via chrome://extensions -> "Load unpacked" -> select that folder.`);
