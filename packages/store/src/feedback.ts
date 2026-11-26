import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PATHS } from "@adaiyalam/config";

export interface FalsePositiveReport {
  id: string;
  scanId: string;
  techId: string;
  url: string;
  reportedAt: string;
  note?: string;
}

interface FeedbackFile {
  reports: FalsePositiveReport[];
}

function loadFeedback(): FeedbackFile {
  if (!existsSync(PATHS.feedback)) return { reports: [] };
  try {
    return JSON.parse(readFileSync(PATHS.feedback, "utf-8")) as FeedbackFile;
  } catch {
    return { reports: [] };
  }
}

function saveFeedback(file: FeedbackFile): void {
  mkdirSync(PATHS.home, { recursive: true });
  writeFileSync(PATHS.feedback, JSON.stringify(file, null, 2));
}

/**
 * Purely local record of "this detection was wrong" — never sent anywhere.
 * Feeds the rule-quality dashboard's false-positive counts; it does not
 * change the ruleset or matcher behavior on its own (a human reviews these
 * and edits the rule if warranted).
 */
export function reportFalsePositive(input: { scanId: string; techId: string; url: string; note?: string }): FalsePositiveReport {
  const file = loadFeedback();
  const report: FalsePositiveReport = { id: randomUUID(), scanId: input.scanId, techId: input.techId, url: input.url, reportedAt: new Date().toISOString(), note: input.note };
  file.reports.push(report);
  saveFeedback(file);
  return report;
}

export function listFalsePositiveReports(filter?: { techId?: string }): FalsePositiveReport[] {
  const reports = loadFeedback().reports;
  return filter?.techId ? reports.filter((r) => r.techId === filter.techId) : reports;
}

export function deleteFalsePositiveReport(id: string): void {
  const file = loadFeedback();
  file.reports = file.reports.filter((r) => r.id !== id);
  saveFeedback(file);
}
