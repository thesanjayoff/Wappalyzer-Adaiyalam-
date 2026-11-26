import type { EvidenceHit } from "./matcher-types.js";

/**
 * Combines several independent positive signals with a probabilistic-OR:
 * combined = 1 - Π(1 - c_i). Two 60%-confidence signals together produce
 * 84%, not 120% (simple addition would blow past 100 almost immediately
 * and make the score meaningless). Each matched negative pattern then
 * multiplies the result down — a strong negative signal (confidence 100)
 * can crush an otherwise-confident match towards zero.
 */
export function combineConfidence(hits: EvidenceHit[]): number {
  const positives = hits.filter((h) => !h.negative);
  const negatives = hits.filter((h) => h.negative);
  if (positives.length === 0) return 0;

  let survivalProduct = 1;
  for (const hit of positives) {
    survivalProduct *= 1 - Math.min(hit.confidence, 100) / 100;
  }
  let combined = (1 - survivalProduct) * 100;

  for (const hit of negatives) {
    combined *= 1 - Math.min(hit.confidence, 100) / 100;
  }

  return Math.round(Math.min(100, Math.max(0, combined)));
}
