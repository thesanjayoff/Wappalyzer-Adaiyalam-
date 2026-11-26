import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import { loadDefaultAppRuleset, resolveAppStack, type AppFacts } from "@adaiyalam/app-analysis";

const EXAMPLE_FACTS: AppFacts = {
  packageName: "com.example.shoppingapp",
  versionName: "4.2.0",
  permissions: ["android.permission.INTERNET", "android.permission.CAMERA"],
  classPrefixes: ["com/google/firebase/messaging/FirebaseMessagingService", "com/razorpay/Checkout", "io/flutter/embedding/android/FlutterActivity"],
  manifestMeta: [{ name: "com.google.android.gms.version", value: "12451000" }],
  nativeLibs: ["lib/arm64-v8a/libflutter.so"],
  strings: [],
  source: "example — replace with facts extracted by apktool/jadx/aapt or an agent's own binary-analysis tools",
};

function loadFacts(path: string): AppFacts {
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  return {
    packageName: raw.packageName,
    versionName: raw.versionName,
    permissions: raw.permissions ?? [],
    classPrefixes: raw.classPrefixes ?? [],
    manifestMeta: raw.manifestMeta ?? [],
    nativeLibs: raw.nativeLibs ?? [],
    strings: raw.strings ?? [],
    source: raw.source ?? "(unspecified — the facts file should set a \"source\" field describing how it was produced)",
  };
}

export function registerAppCommand(program: Command): void {
  const app = program.command("app").description('"App mode": an adapter for mobile-app technology fingerprinting — Adaiyalam does not decompile APK/IPA files itself, it matches a fixed set of known-SDK fingerprints against facts a reverse-engineering tool already extracted');

  app
    .command("schema")
    .description("Print (or save) the AppFacts JSON shape this tool expects, with a worked example")
    .option("--out <path>", "write the example to a file instead of printing it")
    .action((options) => {
      const json = JSON.stringify(EXAMPLE_FACTS, null, 2);
      if (options.out) {
        writeFileSync(options.out, json + "\n");
        console.log(`Wrote an example AppFacts file to ${options.out}. Fill in real permissions/classPrefixes/nativeLibs/strings from your own extraction (apktool, jadx, aapt dump, or an agent's binary-analysis tools) and run "adaiyalam app analyze ${options.out}".`);
      } else {
        console.log(json);
      }
    });

  app
    .command("analyze")
    .description("Match a pre-extracted AppFacts JSON file against the bundled Android SDK fingerprint ruleset")
    .argument("<factsFile>", 'path to a JSON file in the AppFacts shape (see "adaiyalam app schema")')
    .option("--json", "print the full JSON detection list instead of a human-readable summary")
    .action((factsFile: string, options) => {
      const facts = loadFacts(factsFile);
      const rules = loadDefaultAppRuleset();
      const detections = resolveAppStack(rules, facts);

      if (options.json) {
        console.log(JSON.stringify({ facts: { packageName: facts.packageName, versionName: facts.versionName, source: facts.source }, detections }, null, 2));
        return;
      }

      console.log(`\nApp analysis${facts.packageName ? ` of ${facts.packageName}` : ""}${facts.versionName ? ` v${facts.versionName}` : ""}`);
      console.log(`  facts source: ${facts.source}`);
      if (detections.length === 0) {
        console.log("\n  No known SDKs detected.");
        return;
      }
      console.log("");
      for (const d of detections) {
        const implied = d.impliedBy.length > 0 ? ` [implied by: ${d.impliedBy.join(", ")}]` : "";
        const version = d.version ? ` v${d.version}` : "";
        console.log(`  - ${d.name}${version} — confidence ${d.confidence}% (${d.categories.join(", ")})${implied}`);
      }
      console.log(`\n  ${detections.length} technology/technologies detected. This is pattern matching against pre-extracted facts, not a vulnerability scan — treat every result as a probabilistic hint.`);
    });

  app
    .command("rules")
    .description("List the bundled Android SDK fingerprint rules")
    .action(() => {
      const rules = loadDefaultAppRuleset();
      console.log(`${rules.length} app fingerprint rule(s):`);
      for (const rule of rules) console.log(`  ${rule.id.padEnd(28)} ${rule.name} (${rule.categories.join(", ")})`);
    });
}
