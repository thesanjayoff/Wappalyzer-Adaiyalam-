import { describe, expect, it } from "vitest";
import { buildCalibrationReport } from "./calibration.js";
import type { SitePredictionResult } from "./ground-truth-eval.js";

function site(samples: { techId: string; confidence: number; correct: boolean }[]): SitePredictionResult {
  return { url: "https://example.test", expected: [], detected: [], truePositives: [], falsePositives: [], falseNegatives: [], confidenceSamples: samples };
}

describe("buildCalibrationReport", () => {
  it("buckets samples into confidence deciles and reports accuracy per bucket", () => {
    const buckets = buildCalibrationReport([
      site([
        { techId: "a", confidence: 92, correct: true },
        { techId: "b", confidence: 95, correct: true },
        { techId: "c", confidence: 45, correct: false },
      ]),
    ]);

    const high = buckets.find((b) => b.range === "90-99");
    expect(high).toEqual({ range: "90-99", samples: 2, correct: 2, accuracy: 1 });

    const mid = buckets.find((b) => b.range === "40-49");
    expect(mid).toEqual({ range: "40-49", samples: 1, correct: 0, accuracy: 0 });
  });

  it("returns an empty report when there are no confidence samples", () => {
    expect(buildCalibrationReport([site([])])).toEqual([]);
  });

  it("clamps a 100% confidence sample into the 90-99 bucket rather than a nonexistent 100-109 one", () => {
    const buckets = buildCalibrationReport([site([{ techId: "a", confidence: 100, correct: true }])]);
    expect(buckets).toEqual([{ range: "90-99", samples: 1, correct: 1, accuracy: 1 }]);
  });
});
