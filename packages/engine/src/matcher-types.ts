import type { SignalType } from "@adaiyalam/schema";
import type { VersionConfidence } from "./version.js";

export interface EvidenceHit {
  patternIndex: number;
  type: SignalType;
  key?: string;
  attr?: string;
  matchedValue: string;
  confidence: number;
  negative: boolean;
  version?: string;
}

export interface RuleMatchResult {
  ruleId: string;
  matched: boolean;
  confidence: number;
  hits: EvidenceHit[];
  version?: { value?: string; confidence: VersionConfidence };
  timedOut: boolean;
}

export const MIN_MATCH_CONFIDENCE = 10;
