import { describe, expect, it } from "vitest";
import { validateRuleShape, validateRuleDeep } from "./validate.js";
import { staticRedFlags, assertSafeRegex } from "./safe-regex.js";

const baseRule = {
  id: "example-tech",
  name: "Example Tech",
  description: "An example technology for tests",
  website: "https://example.com",
  categories: ["cms"],
  evidence: [{ type: "header", key: "server", pattern: "Example/([0-9.]+)", version: "$1", confidence: 90 }],
};

describe("validateRuleShape", () => {
  it("accepts a well-formed rule", () => {
    const { rule, issues } = validateRuleShape(baseRule);
    expect(rule).toBeDefined();
    expect(issues).toHaveLength(0);
  });

  it("rejects an unknown category", () => {
    const { issues } = validateRuleShape({ ...baseRule, categories: ["not-a-real-category"] });
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects a rule that implies itself", () => {
    const { issues } = validateRuleShape({ ...baseRule, implies: ["example-tech"] });
    expect(issues.some((i) => i.message.includes("imply itself"))).toBe(true);
  });

  it("rejects requires/excludes overlap", () => {
    const { issues } = validateRuleShape({ ...baseRule, requires: ["x"], excludes: ["x"] });
    expect(issues.some((i) => i.message.includes("required and excluded"))).toBe(true);
  });
});

describe("staticRedFlags", () => {
  it("flags nested quantifiers", () => {
    expect(staticRedFlags("(a+)+")).not.toHaveLength(0);
  });

  it("does not flag a normal pattern", () => {
    expect(staticRedFlags("WordPress/([0-9.]+)")).toHaveLength(0);
  });
});

describe("assertSafeRegex", () => {
  it("accepts a simple safe pattern", async () => {
    const result = await assertSafeRegex("WordPress/([0-9.]+)");
    expect(result.safe).toBe(true);
  }, 10000);

  it("rejects a catastrophic-backtracking pattern", async () => {
    const result = await assertSafeRegex("(a+)+$");
    expect(result.safe).toBe(false);
  }, 10000);
});

describe("validateRuleDeep", () => {
  it("flags an unsafe regex inside a full rule", async () => {
    const report = await validateRuleDeep({
      ...baseRule,
      evidence: [{ type: "html", pattern: "(a+)+$", confidence: 50 }],
    });
    expect(report.ok).toBe(false);
  }, 10000);
});
