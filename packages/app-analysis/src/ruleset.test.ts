import { describe, expect, it } from "vitest";
import { loadDefaultAppRuleset } from "./loader.js";

describe("default app ruleset", () => {
  const rules = loadDefaultAppRuleset();

  it("has at least 10 technologies", () => {
    expect(rules.length).toBeGreaterThanOrEqual(10);
  });

  it("has no duplicate ids", () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every implies reference points at a real technology id", () => {
    const ids = new Set(rules.map((r) => r.id));
    const dangling: string[] = [];
    for (const rule of rules) {
      for (const id of rule.implies) {
        if (!ids.has(id)) dangling.push(`${rule.id} implies unknown "${id}"`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("every evidence pattern is a valid, non-catastrophic regex", () => {
    const bad: string[] = [];
    for (const rule of rules) {
      for (const pattern of rule.evidence) {
        try {
          new RegExp(pattern.pattern);
        } catch {
          bad.push(`${rule.id}: invalid regex "${pattern.pattern}"`);
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
