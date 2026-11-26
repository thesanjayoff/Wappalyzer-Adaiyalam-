import type { SiteFacts } from "@adaiyalam/engine";

const KNOWN_LIBRARY_CDN_HOSTS = [
  "cdnjs.cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "ajax.googleapis.com",
  "code.jquery.com",
  "stackpath.bootstrapcdn.com",
  "maxcdn.bootstrapcdn.com",
];

export interface MissingIntegrityFinding {
  src: string;
}

/** CDN-hosted library scripts without a Subresource Integrity (SRI) hash — if the CDN is compromised, the script runs unmodified-looking. */
export function findScriptsMissingIntegrity(facts: SiteFacts): MissingIntegrityFinding[] {
  const findings: MissingIntegrityFinding[] = [];
  for (const tag of facts.scriptTags) {
    try {
      const host = new URL(tag.src).hostname;
      if (KNOWN_LIBRARY_CDN_HOSTS.includes(host) && !tag.integrity) {
        findings.push({ src: tag.src });
      }
    } catch {
      // ignore unparsable script URLs
    }
  }
  return findings;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i]![0] = i;
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[a.length]![b.length]!;
}

const WATCHED_BRAND_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "cloudflare.com",
  "facebook.net",
  "jquery.com",
  "bootstrapcdn.com",
  "stripe.com",
  "paypal.com",
];

export interface TyposquattingFinding {
  domain: string;
  similarTo: string;
  distance: number;
}

/** Flags third-party script domains that are suspiciously close (edit distance 1–2) to a well-known brand domain without being an exact match. */
export function findTyposquattingLikeDomains(facts: SiteFacts): TyposquattingFinding[] {
  const domains = new Set<string>();
  for (const src of facts.scriptSrcs) {
    try {
      domains.add(new URL(src).hostname);
    } catch {
      // ignore
    }
  }

  const findings: TyposquattingFinding[] = [];
  for (const domain of domains) {
    if (WATCHED_BRAND_DOMAINS.includes(domain) || domain.endsWith(`.${WATCHED_BRAND_DOMAINS.find((b) => domain.endsWith(b)) ?? "\0"}`)) continue;
    for (const brand of WATCHED_BRAND_DOMAINS) {
      const distance = levenshtein(domain, brand);
      if (distance > 0 && distance <= 2 && Math.abs(domain.length - brand.length) <= 3) {
        findings.push({ domain, similarTo: brand, distance });
        break;
      }
    }
  }
  return findings;
}
