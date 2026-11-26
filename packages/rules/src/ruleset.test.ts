import { describe, expect, it } from "vitest";
import { loadDefaultRuleset } from "./loader.js";
import { validateRuleDeep } from "@adaiyalam/schema";

describe("default ruleset", () => {
  const rules = loadDefaultRuleset();

  it("has at least 30 technologies for the first milestone", () => {
    expect(rules.length).toBeGreaterThanOrEqual(30);
  });

  it("has no duplicate ids", () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every implies/requires/excludes reference points at a real technology id", () => {
    const ids = new Set(rules.map((r) => r.id));
    const dangling: string[] = [];
    for (const rule of rules) {
      for (const entry of rule.implies) {
        const id = typeof entry === "string" ? entry : entry.id;
        if (!ids.has(id)) dangling.push(`${rule.id} implies unknown "${id}"`);
      }
      for (const id of [...rule.requires, ...rule.excludes]) {
        if (!ids.has(id)) dangling.push(`${rule.id} references unknown "${id}"`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("every rule passes deep validation (schema + ReDoS safety)", async () => {
    const failures: string[] = [];
    for (const rule of rules) {
      const report = await validateRuleDeep(rule);
      if (!report.ok) {
        failures.push(`${rule.id}: ${report.issues.map((i) => i.message).join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it("covers a healthy spread of categories", () => {
    const categories = new Set(rules.flatMap((r) => r.categories));
    expect(categories.size).toBeGreaterThanOrEqual(10);
  });
});
