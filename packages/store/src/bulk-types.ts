export type BulkJobStatus = "running" | "paused" | "completed" | "cancelled";
export type BulkUrlStatus = "pending" | "running" | "ok" | "error" | "blocked";

export interface BulkDetectionSummary {
  techId: string;
  categories: string[];
  version?: string;
}

export interface BulkUrlResult {
  status: BulkUrlStatus;
  scanId?: string;
  detections?: BulkDetectionSummary[];
  error?: string;
  finishedAt?: string;
}

export interface BulkJobRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: BulkJobStatus;
  concurrency: number;
  globalRps: number;
  perHostDelayMs: number;
  /** Deduplicated, in the order they'll be (or were) processed. */
  urls: string[];
  results: Record<string, BulkUrlResult>;
}
