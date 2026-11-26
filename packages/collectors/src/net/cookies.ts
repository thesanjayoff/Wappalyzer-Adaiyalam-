import type { CookieFact } from "@adaiyalam/engine";

export function parseSetCookieHeader(line: string): CookieFact | undefined {
  const parts = line.split(";").map((p) => p.trim());
  const first = parts[0];
  if (!first) return undefined;
  const eq = first.indexOf("=");
  if (eq === -1) return undefined;
  const name = first.slice(0, eq).trim();
  const value = first.slice(eq + 1).trim();
  if (!name) return undefined;

  const cookie: CookieFact = { name, value };
  for (const attr of parts.slice(1)) {
    const [rawKey, rawVal] = attr.split("=").map((s) => s.trim());
    const key = rawKey?.toLowerCase();
    if (key === "domain") cookie.domain = rawVal;
    else if (key === "path") cookie.path = rawVal;
    else if (key === "secure") cookie.secure = true;
    else if (key === "httponly") cookie.httpOnly = true;
    else if (key === "samesite") cookie.sameSite = (rawVal as CookieFact["sameSite"]) ?? "unspecified";
  }
  return cookie;
}

export function parseSetCookies(lines: string[]): CookieFact[] {
  return lines.map(parseSetCookieHeader).filter((c): c is CookieFact => c !== undefined);
}
