import type { SiteFacts } from "@adaiyalam/engine";

export interface CookieFinding {
  name: string;
  issues: string[];
}

const SENSITIVE_NAME_PATTERN = /sess|auth|token|login|csrf|xsrf/i;

/** Flags cookies missing Secure/HttpOnly/SameSite — loudest for cookies whose name suggests they carry session/auth state. */
export function analyzeCookies(facts: SiteFacts): CookieFinding[] {
  const isHttps = facts.finalUrl.startsWith("https:");
  const findings: CookieFinding[] = [];

  for (const cookie of facts.cookies) {
    const issues: string[] = [];
    const sensitive = SENSITIVE_NAME_PATTERN.test(cookie.name);
    if (isHttps && !cookie.secure) issues.push("missing Secure flag (sent over plain HTTP if ever offered)");
    if (sensitive && !cookie.httpOnly) issues.push("missing HttpOnly flag on a session/auth-looking cookie — readable by JavaScript, including any injected via XSS");
    if (!cookie.sameSite || cookie.sameSite === "unspecified" || cookie.sameSite === "None") {
      issues.push(`SameSite is ${cookie.sameSite ?? "unspecified"} — offers little/no CSRF protection`);
    }
    if (issues.length > 0) findings.push({ name: cookie.name, issues });
  }

  return findings;
}
