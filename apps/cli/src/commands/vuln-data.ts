import { Command } from "commander";
import { fetchAndCacheKev, queryAndCacheOsv } from "@adaiyalam/vuln-data";
import { listScans, getFacts } from "@adaiyalam/store";
import { getRuleset } from "@adaiyalam/orchestrator";

export function registerVulnDataCommands(program: Command): void {
  const vulnData = program.command("vuln-data").description("Maintain the local vulnerability-hint cache (never fetched during an ordinary scan)");

  vulnData
    .command("update-kev")
    .description("Download and cache the CISA Known Exploited Vulnerabilities catalog")
    .action(async () => {
      const { count, fetchedAt } = await fetchAndCacheKev();
      console.log(`Cached ${count} KEV entries (fetched ${fetchedAt}).`);
    });

  vulnData
    .command("update-osv")
    .description("Query OSV.dev for every unique (technology, version) pair seen in saved scan history and cache the results")
    .action(async () => {
      const ruleset = getRuleset();
      const seen = new Set<string>();
      let queried = 0;

      for (const scanRecord of listScans()) {
        const facts = getFacts(scanRecord.id);
        if (!facts) continue;
        for (const techId of scanRecord.techIds) {
          const rule = ruleset.byId.get(techId);
          if (!rule?.osvPackage) continue;
          // Re-derive the version the same way the matcher would, from the saved facts snapshot.
          const { resolveStack } = await import("@adaiyalam/engine");
          const { detections } = resolveStack(ruleset.rules, facts);
          const detection = detections.find((d) => d.techId === techId);
          const version = detection?.version?.value;
          if (!version) continue;
          const key = `${rule.osvPackage.ecosystem}:${rule.osvPackage.name}:${version}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`Querying OSV for ${rule.osvPackage.name}@${version}...`);
          await queryAndCacheOsv(rule.osvPackage.ecosystem, rule.osvPackage.name, version);
          queried++;
        }
      }
      console.log(`Done. Queried and cached ${queried} (package, version) pair(s).`);
    });
}
