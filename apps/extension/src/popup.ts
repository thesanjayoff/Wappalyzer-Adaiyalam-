import { compileRuleset, resolveStack, collectBrowserTargets, emptyFacts, type SiteFacts } from "@adaiyalam/engine";
import { categoryName } from "@adaiyalam/schema/categories";
import type { FingerprintRule } from "@adaiyalam/schema/fingerprint";
import rulesData from "./rules-bundle.json" with { type: "json" };
import { collectPageSignals, type PageSignals } from "./collector.js";

const rules = rulesData as unknown as FingerprintRule[];

const DASHBOARD_URL = "http://127.0.0.1:4848";

const statusEl = document.getElementById("status")!;
const resultsEl = document.getElementById("results")!;
const openReportLink = document.getElementById("open-report") as HTMLAnchorElement;

async function main(): Promise<void> {
  const ruleset = compileRuleset(rules);
  const targets = collectBrowserTargets(ruleset.rules);
  const attrsBySelector = Object.fromEntries([...targets.attrsBySelector.entries()].map(([k, v]) => [k, [...v]]));

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    statusEl.textContent = "Open a regular http(s) page to scan it.";
    return;
  }

  let signals: PageSignals;
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageSignals,
      args: [[...targets.jsGlobals], [...targets.selectors], attrsBySelector],
    });
    signals = injection!.result as PageSignals;
  } catch {
    statusEl.textContent = "Couldn't read this page (browser internal pages and the extension gallery can't be scanned).";
    return;
  }

  const facts: SiteFacts = emptyFacts(tab.url, "browser");
  facts.finalUrl = signals.finalUrl;
  facts.statusCode = 200;
  facts.html = signals.html;
  facts.htmlTruncated = signals.htmlTruncated;
  facts.cookies = signals.cookies;
  facts.metaTags = signals.metaTags;
  facts.scriptSrcs = signals.scriptSrcs;
  facts.scriptTags = signals.scriptTags;
  facts.scriptInline = signals.scriptInline;
  facts.linkTags = signals.linkTags;
  facts.cssText = signals.cssText;
  facts.jsGlobals = signals.jsGlobals;
  facts.domQueries = signals.domQueries;
  facts.domCoverageComplete = true;
  facts.errors.push(
    "Extension mode cannot read HTTP response headers, DNS records, or TLS certificate details (no host permissions requested) — run a full scan from the dashboard or CLI for those signals."
  );

  const stack = resolveStack(ruleset.rules, facts);
  render(stack.detections, tab.url);
}

function render(detections: ReturnType<typeof resolveStack>["detections"], url: string): void {
  statusEl.textContent = `${detections.length} technolog${detections.length === 1 ? "y" : "ies"} detected`;
  resultsEl.innerHTML = "";

  const byCategory = new Map<string, typeof detections>();
  for (const detection of detections) {
    for (const category of detection.categories) {
      const list = byCategory.get(category) ?? [];
      list.push(detection);
      byCategory.set(category, list);
    }
  }

  for (const [categoryId, items] of byCategory) {
    const section = document.createElement("div");
    section.className = "category";
    const heading = document.createElement("h3");
    heading.textContent = categoryName(categoryId);
    section.appendChild(heading);

    for (const detection of items) {
      const row = document.createElement("div");
      row.className = "tech-row";
      const name = document.createElement("span");
      name.className = "tech-name";
      name.textContent = detection.version?.value ? `${detection.name} v${detection.version.value}` : detection.name;
      const pill = document.createElement("span");
      pill.className = "confidence-pill";
      pill.textContent = `${detection.confidence}%`;
      row.append(name, pill);
      section.appendChild(row);
    }
    resultsEl.appendChild(section);
  }

  openReportLink.href = `${DASHBOARD_URL}/?url=${encodeURIComponent(url)}`;
}

main().catch((err) => {
  statusEl.textContent = `Error: ${(err as Error).message}`;
});
