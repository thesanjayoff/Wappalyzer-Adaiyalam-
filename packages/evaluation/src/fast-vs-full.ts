import { scanUrlFast, scanUrlBrowser } from "@adaiyalam/orchestrator";

export interface FastVsFullSiteResult {
  url: string;
  fastOnly: string[];
  browserOnly: string[];
  both: string[];
  error?: string;
}

export interface FastVsFullReport {
  sites: FastVsFullSiteResult[];
  /** Share of all detected technologies (across both modes) that fast mode alone also found. */
  fastModeRecallVsFull: number;
}

/**
 * Runs both fast (HTTP-only) and full (Playwright) mode against the same
 * URLs and diffs the detections — mainly useful for seeing what full mode's
 * JS-global/network-capture signals catch that fast mode's static HTML
 * parsing can't (and, less often, the reverse).
 */
export async function runFastVsFull(urls: string[]): Promise<FastVsFullReport> {
  const sites: FastVsFullSiteResult[] = [];
  let unionCount = 0;
  let fastHitCount = 0;

  for (const url of urls) {
    try {
      const [fast, full] = await Promise.all([scanUrlFast(url, { save: false }), scanUrlBrowser(url, { save: false })]);
      const fastSet = new Set(fast.detections.map((d) => d.techId));
      const fullSet = new Set(full.detections.map((d) => d.techId));
      const union = new Set([...fastSet, ...fullSet]);
      unionCount += union.size;
      fastHitCount += [...union].filter((t) => fastSet.has(t)).length;

      sites.push({
        url,
        fastOnly: [...fastSet].filter((t) => !fullSet.has(t)),
        browserOnly: [...fullSet].filter((t) => !fastSet.has(t)),
        both: [...fastSet].filter((t) => fullSet.has(t)),
      });
    } catch (err) {
      sites.push({ url, fastOnly: [], browserOnly: [], both: [], error: err instanceof Error ? err.message : String(err) });
    }
  }

  return { sites, fastModeRecallVsFull: unionCount > 0 ? fastHitCount / unionCount : 0 };
}
