export interface RobotsGroup {
  userAgents: string[];
  rules: { path: string; allow: boolean }[];
  crawlDelaySeconds?: number;
}

export interface RobotsRules {
  groups: RobotsGroup[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;
  let sawRuleSinceAgent = true;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;
    const field = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();

    if (field === "user-agent") {
      if (!current || sawRuleSinceAgent) {
        current = { userAgents: [], rules: [] };
        groups.push(current);
        sawRuleSinceAgent = false;
      }
      current.userAgents.push(value);
    } else if (field === "disallow" && current) {
      sawRuleSinceAgent = true;
      if (value !== "") current.rules.push({ path: value, allow: false });
    } else if (field === "allow" && current) {
      sawRuleSinceAgent = true;
      if (value !== "") current.rules.push({ path: value, allow: true });
    } else if (field === "crawl-delay" && current) {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) current.crawlDelaySeconds = seconds;
    } else if (field === "sitemap") {
      sitemaps.push(value);
    }
  }

  return { groups, sitemaps };
}

function globToRegex(pattern: string): RegExp {
  let out = "^";
  for (const char of pattern) {
    if (char === "*") out += ".*";
    else if (char === "$") out += "$";
    else out += char.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out);
}

function matchesPath(rulePath: string, requestPath: string): boolean {
  if (!rulePath.includes("*") && !rulePath.endsWith("$")) {
    return requestPath.startsWith(rulePath);
  }
  return globToRegex(rulePath).test(requestPath);
}

function selectGroup(rules: RobotsRules, userAgentToken: string): RobotsGroup | undefined {
  const tokenLower = userAgentToken.toLowerCase();
  const specific = rules.groups.find((g) => g.userAgents.some((ua) => ua.toLowerCase() === tokenLower));
  if (specific) return specific;
  return rules.groups.find((g) => g.userAgents.some((ua) => ua === "*"));
}

export function isAllowedByRobots(rules: RobotsRules, userAgentToken: string, pathWithQuery: string): boolean {
  const group = selectGroup(rules, userAgentToken);
  if (!group) return true;
  const matches = group.rules.filter((r) => matchesPath(r.path, pathWithQuery));
  if (matches.length === 0) return true;
  // Longest matching path wins; ties favor Allow (matches common crawler behavior / Google's spec).
  matches.sort((a, b) => b.path.length - a.path.length || (a.allow === b.allow ? 0 : a.allow ? -1 : 1));
  return matches[0]?.allow ?? true;
}

export function crawlDelayFor(rules: RobotsRules, userAgentToken: string): number | undefined {
  return selectGroup(rules, userAgentToken)?.crawlDelaySeconds;
}
