/**
 * Minimal, already-sanitized input to the summary prompt — deliberately NOT
 * the full ScanReport. Only structured, mostly-controlled fields (tech
 * names/categories from Adaiyalam's own rule database) plus a few short,
 * pre-formatted free-text lines go in; raw HTML/scripts/header blobs never
 * do. See prompt.ts for why this boundary matters.
 */
export interface SummaryDetection {
  name: string;
  categories: string[];
  confidence: number;
  version?: string;
}

export interface SummaryInput {
  url: string;
  detections: SummaryDetection[];
  /** Short, pre-formatted lines from the insights report (e.g. "missing security headers: ..."). May contain text copied from the scanned page (header values, cookie names) — treated as untrusted in the prompt. */
  insightLines: string[];
}

export interface AiSummaryConfig {
  provider: "anthropic" | "openai-compatible";
  apiKey: string;
  model?: string;
  /** openai-compatible only: base URL of the chat-completions-compatible endpoint. */
  baseUrl?: string;
}

export class AiSummaryConfigError extends Error {}
