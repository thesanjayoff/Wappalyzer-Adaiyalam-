export interface ScanRecord {
  id: string;
  url: string;
  finalUrl: string;
  hostname: string;
  mode: "fast" | "browser";
  scannedAt: string;
  statusCode: number;
  rulesetVersion: string;
  techIds: string[];
  detectionCount: number;
  errors: string[];
}

export interface SiteRecord {
  hostname: string;
  tags: string[];
  notes: string;
  scanIds: string[];
}

export interface ScanReportInput {
  url: string;
  finalUrl: string;
  mode: "fast" | "browser";
  scannedAt: string;
  statusCode: number;
  rulesetVersion: string;
  techIds: string[];
  errors: string[];
}

export interface StoreIndex {
  scans: ScanRecord[];
  sites: Record<string, SiteRecord>;
}
