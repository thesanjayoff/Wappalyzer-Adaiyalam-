import { describe, expect, it } from "vitest";
import { matchAppRule } from "./matcher.js";
import { resolveAppStack } from "./stack.js";
import { loadDefaultAppRuleset } from "./loader.js";
import type { AppFacts } from "./types.js";

function emptyAppFacts(overrides: Partial<AppFacts> = {}): AppFacts {
  return { permissions: [], classPrefixes: [], manifestMeta: [], nativeLibs: [], strings: [], source: "test fixture", ...overrides };
}

describe("matchAppRule", () => {
  const rules = loadDefaultAppRuleset();
  const byId = new Map(rules.map((r) => [r.id, r]));

  it("matches Firebase from a classPrefix hit", () => {
    const rule = byId.get("firebase")!;
    const result = matchAppRule(rule, emptyAppFacts({ classPrefixes: ["com/google/firebase/messaging/FirebaseMessagingService"] }));
    expect(result.matched).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("does not match when no relevant classPrefix is present", () => {
    const rule = byId.get("firebase")!;
    const result = matchAppRule(rule, emptyAppFacts({ classPrefixes: ["com/example/myapp/MainActivity"] }));
    expect(result.matched).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it("matches Flutter from a native library filename", () => {
    const rule = byId.get("flutter")!;
    const result = matchAppRule(rule, emptyAppFacts({ nativeLibs: ["lib/arm64-v8a/libflutter.so"] }));
    expect(result.matched).toBe(true);
  });

  it("matches React Native from an embedded bundle string", () => {
    const rule = byId.get("react-native")!;
    const result = matchAppRule(rule, emptyAppFacts({ strings: ["assets/index.android.bundle"] }));
    expect(result.matched).toBe(true);
  });
});

describe("resolveAppStack", () => {
  const rules = loadDefaultAppRuleset();

  it("adds an implied technology (google-play-services) when AdMob matches", () => {
    const facts = emptyAppFacts({ classPrefixes: ["com/google/android/gms/ads/AdView"] });
    const detections = resolveAppStack(rules, facts);
    const ids = detections.map((d) => d.techId);
    expect(ids).toContain("google-admob");
    expect(ids).toContain("google-play-services");
    const implied = detections.find((d) => d.techId === "google-play-services");
    expect(implied?.impliedBy).toContain("google-admob");
  });

  it("returns an empty stack for facts with no recognizable signals", () => {
    expect(resolveAppStack(rules, emptyAppFacts())).toEqual([]);
  });
});
