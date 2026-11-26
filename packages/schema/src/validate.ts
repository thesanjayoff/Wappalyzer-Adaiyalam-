import { fingerprintSchema, type FingerprintRule } from "./fingerprint.js";
import { assertSafeRegex } from "./safe-regex.js";

export interface ValidationIssue {
  ruleId: string;
  level: "error" | "warning";
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

/** Structural + schema validation only (no regex timing test). Fast, synchronous-ish. */
export function validateRuleShape(raw: unknown): { rule?: FingerprintRule; issues: ValidationIssue[] } {
  const parsed = fingerprintSchema.safeParse(raw);
  if (!parsed.success) {
    const ruleId = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : "<unknown>";
    return {
      issues: parsed.error.issues.map((issue) => ({
        ruleId,
        level: "error",
        message: `${issue.path.join(".")}: ${issue.message}`,
      })),
    };
  }
  const rule = parsed.data;
  const issues: ValidationIssue[] = [];

  if (rule.implies.some((i) => (typeof i === "string" ? i : i.id) === rule.id)) {
    issues.push({ ruleId: rule.id, level: "error", message: "a technology cannot imply itself" });
  }
  if (rule.excludes.includes(rule.id)) {
    issues.push({ ruleId: rule.id, level: "error", message: "a technology cannot exclude itself" });
  }
  for (const req of rule.requires) {
    if (rule.excludes.includes(req)) {
      issues.push({ ruleId: rule.id, level: "error", message: `"${req}" is both required and excluded` });
    }
  }
  if (rule.evidence.every((e) => e.negative)) {
    issues.push({ ruleId: rule.id, level: "error", message: "a rule must have at least one non-negative pattern" });
  }
  rule.evidence.forEach((e, i) => {
    if (e.type !== "domExists" && e.pattern.trim() === "") {
      issues.push({ ruleId: rule.id, level: "error", message: `evidence[${i}] (${e.type}) is missing a pattern` });
    }
  });
  if (rule.cpe && !rule.cpe.startsWith("cpe:2.3:")) {
    issues.push({ ruleId: rule.id, level: "warning", message: "cpe should be a CPE 2.3 formatted string" });
  }

  return { rule, issues };
}

/** Full validation including the ReDoS timing test for every pattern. Use in `rule lint` / CI. */
export async function validateRuleDeep(raw: unknown): Promise<ValidationReport> {
  const { rule, issues } = validateRuleShape(raw);
  if (!rule) return { ok: false, issues };

  const allIssues = [...issues];
  for (const [index, pattern] of rule.evidence.entries()) {
    if (pattern.type === "domExists") continue; // matches on presence only, no regex involved
    const result = await assertSafeRegex(pattern.pattern, pattern.flags);
    if (!result.safe) {
      allIssues.push({
        ruleId: rule.id,
        level: "error",
        message: `evidence[${index}] (${pattern.type}${pattern.key ? `:${pattern.key}` : ""}) unsafe regex: ${result.reason}`,
      });
    }
    if (pattern.version && !/^\$\d+(\.\$\d+)*$/.test(pattern.version) && !/^[\w.$-]+$/.test(pattern.version)) {
      allIssues.push({
        ruleId: rule.id,
        level: "warning",
        message: `evidence[${index}] version template "${pattern.version}" looks unusual (expected something like "$1" or "$1.$2")`,
      });
    }
  }

  return { ok: allIssues.every((i) => i.level !== "error"), issues: allIssues };
}

export async function validateRuleFile(raw: unknown[]): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  const seenIds = new Set<string>();
  for (const entry of raw) {
    const report = await validateRuleDeep(entry);
    issues.push(...report.issues);
    const id = typeof entry === "object" && entry && "id" in entry ? String((entry as { id: unknown }).id) : undefined;
    if (id) {
      if (seenIds.has(id)) {
        issues.push({ ruleId: id, level: "error", message: "duplicate technology id in ruleset" });
      }
      seenIds.add(id);
    }
  }
  return { ok: issues.every((i) => i.level !== "error"), issues };
}
