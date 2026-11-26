import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compileRule, emptyFacts, matchRule, type SiteFacts } from "@adaiyalam/engine";
import { DATA_DIR } from "./loader.js";
import { loadDefaultRuleset } from "./loader.js";

const FIXTURES_DIR = join(DATA_DIR, "..", "fixtures");

interface Fixture {
  expect: "positive" | "negative";
  facts: Partial<SiteFacts>;
  description?: string;
}

describe("rule fixtures", () => {
  if (!existsSync(FIXTURES_DIR)) return;

  const rules = loadDefaultRuleset();
  const rulesById = new Map(rules.map((r) => [r.id, r]));
  const techIds = readdirSync(FIXTURES_DIR).filter((f) => existsSync(join(FIXTURES_DIR, f)) && !f.startsWith("_"));

  it("every fixture directory corresponds to a real rule id", () => {
    const unknown = techIds.filter((id) => !rulesById.has(id));
    expect(unknown).toEqual([]);
  });

  for (const techId of techIds) {
    const rule = rulesById.get(techId);
    if (!rule) continue;
    const compiled = compileRule(rule, "fixture-test");
    const dir = join(FIXTURES_DIR, techId);

    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      it(`${techId}/${file} matches as expected`, () => {
        const fixture: Fixture = JSON.parse(readFileSync(join(dir, file), "utf-8"));
        const facts: SiteFacts = { ...emptyFacts("https://fixture.test", "fast"), ...fixture.facts };
        const result = matchRule(compiled, facts);
        const expectedMatch = fixture.expect === "positive";
        expect(result.matched, `expected ${fixture.expect} (confidence ${result.confidence})`).toBe(expectedMatch);
      });
    }
  }
});
