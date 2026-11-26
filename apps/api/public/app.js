const scanForm = document.getElementById("scan-form");
const scanUrlInput = document.getElementById("scan-url");
const scanSubmit = document.getElementById("scan-submit");
const scanStatus = document.getElementById("scan-status");
const siteList = document.getElementById("site-list");
const emptyState = document.getElementById("empty-state");
const report = document.getElementById("report");
const reportTitle = document.getElementById("report-title");
const reportMeta = document.getElementById("report-meta");
const reportErrors = document.getElementById("report-errors");
const stackGraph = document.getElementById("stack-graph");
const categoriesEl = document.getElementById("categories");
const themeToggle = document.getElementById("theme-toggle");

let categoryLabels = {};

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("adaiyalam-theme", theme);
}

(function initTheme() {
  const saved = localStorage.getItem("adaiyalam-theme");
  const preferred = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(preferred);
})();

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? `request failed (${response.status})`);
  return body;
}

function confidenceClass(confidence) {
  if (confidence >= 75) return "confidence-high";
  if (confidence >= 40) return "confidence-medium";
  return "confidence-low";
}

async function loadCategories() {
  try {
    const categories = await fetchJson("/api/categories");
    categoryLabels = Object.fromEntries(categories.map((c) => [c.id, c.label]));
  } catch {
    categoryLabels = {};
  }
}

async function loadSites() {
  try {
    const sites = await fetchJson("/api/sites");
    siteList.innerHTML = "";
    for (const site of sites) {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.textContent = `${site.hostname} (${site.scanIds.length})`;
      button.addEventListener("click", () => openSite(site.hostname));
      li.appendChild(button);
      siteList.appendChild(li);
    }
  } catch (err) {
    console.error("Failed to load sites", err);
  }
}

async function openSite(hostname) {
  try {
    const site = await fetchJson(`/api/sites/${encodeURIComponent(hostname)}`);
    const latestScanId = site.scanIds[0];
    if (!latestScanId) return;
    const replayed = await fetchJson(`/api/scans/${latestScanId}/replay`);
    renderReport(replayed);
  } catch (err) {
    scanStatus.textContent = `Could not open ${hostname}: ${err.message}`;
  }
}

function renderReport(reportData) {
  emptyState.classList.add("hidden");
  report.classList.remove("hidden");

  reportTitle.textContent = reportData.url;
  reportMeta.innerHTML = "";
  const metaParts = [
    `Final URL: ${reportData.facts.finalUrl}`,
    `Status: ${reportData.facts.statusCode}`,
    `Mode: ${reportData.mode}`,
    `Scanned: ${new Date(reportData.scannedAt).toLocaleString()}`,
    `Ruleset: ${reportData.rulesetVersion}`,
  ];
  for (const part of metaParts) {
    const span = document.createElement("span");
    span.textContent = part;
    reportMeta.appendChild(span);
  }

  if (reportData.facts.errors && reportData.facts.errors.length > 0) {
    reportErrors.classList.remove("hidden");
    reportErrors.textContent = reportData.facts.errors.join(" · ");
  } else {
    reportErrors.classList.add("hidden");
  }

  stackGraph.innerHTML = "";
  for (const detection of reportData.detections) {
    const node = document.createElement("span");
    node.className = "stack-node";
    node.textContent = detection.name;
    stackGraph.appendChild(node);
  }

  const byCategory = new Map();
  for (const detection of reportData.detections) {
    for (const category of detection.categories) {
      const list = byCategory.get(category) ?? [];
      list.push(detection);
      byCategory.set(category, list);
    }
  }

  categoriesEl.innerHTML = "";
  if (byCategory.size === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No technologies detected.";
    categoriesEl.appendChild(empty);
    return;
  }

  for (const [categoryId, detections] of byCategory) {
    const card = document.createElement("div");
    card.className = "category-card";
    const heading = document.createElement("h3");
    heading.textContent = categoryLabels[categoryId] ?? categoryId;
    card.appendChild(heading);

    for (const detection of detections) {
      const row = document.createElement("div");
      row.className = "tech-row";

      const details = document.createElement("details");
      details.className = "tech-details";
      const summary = document.createElement("summary");

      const nameSpan = document.createElement("span");
      nameSpan.className = "tech-name";
      nameSpan.textContent = detection.name;
      if (detection.version?.value) {
        const versionSpan = document.createElement("span");
        versionSpan.className = "tech-version";
        versionSpan.textContent = `v${detection.version.value} (${detection.version.confidence})`;
        nameSpan.appendChild(versionSpan);
      }
      summary.appendChild(nameSpan);
      details.appendChild(summary);

      if (detection.impliedBy?.length) {
        const impliedNote = document.createElement("div");
        impliedNote.className = "tech-version";
        impliedNote.textContent = `implied by: ${detection.impliedBy.join(", ")}`;
        details.appendChild(impliedNote);
      }

      if (detection.evidence?.length) {
        const list = document.createElement("ul");
        list.className = "evidence-list";
        for (const ev of detection.evidence) {
          const li = document.createElement("li");
          li.textContent = `${ev.type}${ev.key ? ` (${ev.key})` : ""}: "${ev.matchedValue}" — ${ev.confidence}%`;
          list.appendChild(li);
        }
        details.appendChild(list);
      }

      row.appendChild(details);
      const pill = document.createElement("span");
      pill.className = `confidence-pill ${confidenceClass(detection.confidence)}`;
      pill.textContent = `${detection.confidence}%`;
      row.appendChild(pill);

      card.appendChild(row);
    }

    categoriesEl.appendChild(card);
  }
}

scanForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = scanUrlInput.value.trim();
  if (!url) return;

  scanSubmit.disabled = true;
  scanStatus.textContent = "Scanning (respecting robots.txt and rate limits)…";
  try {
    const result = await fetchJson("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    renderReport(result);
    scanStatus.textContent = "Done.";
    await loadSites();
  } catch (err) {
    scanStatus.textContent = `Error: ${err.message}`;
  } finally {
    scanSubmit.disabled = false;
  }
});

loadCategories();
loadSites();
