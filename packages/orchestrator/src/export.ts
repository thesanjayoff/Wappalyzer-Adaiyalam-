import { categoryName } from "@adaiyalam/schema";
import type { ScanReport } from "./scan.js";

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/**
 * Flat, spreadsheet-friendly export: one row per detected technology.
 */
export function reportToCsv(report: ScanReport): string {
  const header = ["techId", "name", "categories", "confidence", "version", "versionConfidence", "impliedBy"];
  const rows = report.detections.map((d) => [
    d.techId,
    d.name,
    d.categories.map(categoryName).join("; "),
    String(d.confidence),
    d.version?.value ?? "",
    d.version ? String(d.version.confidence) : "",
    d.impliedBy.join("; "),
  ]);
  return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Self-contained, printable HTML report (no external assets) — open it in a
 * browser and use "Print to PDF" for a PDF copy; we don't bundle a PDF
 * renderer dependency just for this.
 */
export function reportToHtml(report: ScanReport): string {
  const byCategory = new Map<string, typeof report.detections>();
  for (const d of report.detections) {
    for (const category of d.categories) {
      const list = byCategory.get(category) ?? [];
      list.push(d);
      byCategory.set(category, list);
    }
  }

  const categorySections = [...byCategory.entries()]
    .map(([category, detections]) => {
      const rows = [...new Set(detections)]
        .map((d) => {
          const version = d.version?.value ? ` v${escapeHtml(d.version.value)} <span class="muted">(${d.version.confidence}% confident)</span>` : "";
          const implied = d.impliedBy.length > 0 ? ` <span class="muted">[implied by: ${d.impliedBy.map(escapeHtml).join(", ")}]</span>` : "";
          return `<li><strong>${escapeHtml(d.name)}</strong>${version} — confidence ${d.confidence}%${implied}</li>`;
        })
        .join("\n");
      return `<section><h2>${escapeHtml(categoryName(category))}</h2><ul>${rows}</ul></section>`;
    })
    .join("\n");

  const insightLines: string[] = [];
  const missingHeaders = report.insights.securityHeaders.filter((h) => !h.present);
  if (missingHeaders.length > 0) insightLines.push(`Missing security headers: ${missingHeaders.map((h) => h.header).join(", ")}`);
  for (const b of report.insights.exposedBanners) insightLines.push(`Exposed version banner: ${b.header}: ${b.value}`);
  for (const t of report.insights.tls) insightLines.push(`TLS issue: ${t.detail}`);
  if (report.insights.mixedContent.length > 0) insightLines.push(`Mixed content: ${report.insights.mixedContent.length} http:// resource(s) on an https page`);
  for (const c of report.insights.cookies) insightLines.push(`Cookie '${c.name}': ${c.issues.join("; ")}`);
  for (const s of report.insights.supplyChain.missingIntegrity) insightLines.push(`CDN script without integrity hash: ${s.src}`);
  for (const dm of report.insights.supplyChain.typosquattingLikeDomains) insightLines.push(`Domain '${dm.domain}' looks suspiciously close to '${dm.similarTo}'`);
  if (report.insights.privacy.trackers.length > 0) insightLines.push(`${report.insights.privacy.trackers.length} tracker(s): ${report.insights.privacy.trackers.map((t) => t.name).join(", ")}`);
  for (const v of report.insights.vulnerabilities) {
    const label = v.source === "osv" ? `${v.id} (${v.severity ?? "severity unknown"}${v.kev ? ", in CISA KEV" : ""})` : v.eolStatus;
    insightLines.push(`${v.name}${v.version ? ` v${v.version}` : ""}: ${label} — ${v.eolDetail ?? v.summary ?? ""}`);
  }

  const insightsSection =
    insightLines.length > 0
      ? `<section><h2>Security &amp; privacy notes</h2><p class="muted">Probabilistic hints, not confirmed findings.</p><ul>${insightLines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n")}</ul></section>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Adaiyalam report — ${escapeHtml(report.url)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; word-break: break-all; }
  h2 { font-size: 1.05rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; margin-top: 1.75rem; }
  ul { padding-left: 1.25rem; }
  li { margin: 0.3rem 0; }
  .muted { color: #666; font-size: 0.9em; }
  .meta { color: #444; font-size: 0.9rem; }
  @media print { body { margin: 0; } }
</style>
</head>
<body>
<h1>Adaiyalam scan report</h1>
<p class="meta">
  URL: ${escapeHtml(report.url)}<br>
  Scanned at: ${escapeHtml(report.scannedAt)} (mode: ${report.mode})<br>
  Final URL: ${escapeHtml(report.facts.finalUrl)}<br>
  Status: ${report.facts.statusCode}${report.facts.tlsValid === false ? " (TLS certificate invalid)" : ""}<br>
  Ruleset version: ${escapeHtml(report.rulesetVersion)}
</p>
${report.detections.length === 0 ? "<p>No technologies detected.</p>" : categorySections}
${insightsSection}
</body>
</html>
`;
}
