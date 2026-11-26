import type { SitePredictionResult } from "./ground-truth-eval.js";

export interface CalibrationBucket {
  /** e.g. "70-79" */
  range: string;
  samples: number;
  correct: number;
  accuracy: number;
}

/**
 * Buckets every confidence sample gathered during the ground-truth run
 * (true positives from labelled sites, false positives from negative
 * controls) into deciles and reports how often each bucket was actually
 * correct. With only a handful of ground-truth sites, this is a small,
 * preliminary signal, not a statistically solid reliability curve — call
 * out that caveat wherever this is reported.
 */
export function buildCalibrationReport(perSite: SitePredictionResult[]): CalibrationBucket[] {
  const buckets = new Map<number, { samples: number; correct: number }>();
  for (const site of perSite) {
    for (const sample of site.confidenceSamples) {
      const decile = Math.min(9, Math.floor(sample.confidence / 10));
      const bucket = buckets.get(decile) ?? { samples: 0, correct: 0 };
      bucket.samples++;
      if (sample.correct) bucket.correct++;
      buckets.set(decile, bucket);
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([decile, { samples, correct }]) => ({
      range: `${decile * 10}-${decile * 10 + 9}`,
      samples,
      correct,
      accuracy: samples > 0 ? correct / samples : 0,
    }));
}
