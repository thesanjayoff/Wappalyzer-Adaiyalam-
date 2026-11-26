import type { DetectionResult, SiteFacts } from "@adaiyalam/engine";

const PRIVACY_RELEVANT_CATEGORIES = new Set(["analytics", "advertising", "session-replay", "social", "tag-manager"]);

export interface ThirdPartyDomainFinding {
  domain: string;
  requestCount: number;
  firedBeforeConsent?: boolean;
}

export interface PrivacyInventory {
  trackers: { techId: string; name: string; categories: string[] }[];
  thirdPartyDomains: ThirdPartyDomainFinding[];
  consentBannerDetected: boolean;
  consentInteraction: SiteFacts["consentInteraction"];
  note: string;
}

export function analyzePrivacy(detections: DetectionResult[], facts: SiteFacts): PrivacyInventory {
  const trackers = detections
    .filter((d) => d.categories.some((c) => PRIVACY_RELEVANT_CATEGORIES.has(c)))
    .map((d) => ({ techId: d.techId, name: d.name, categories: d.categories }));

  let ownHost: string | undefined;
  try {
    ownHost = new URL(facts.finalUrl).hostname;
  } catch {
    ownHost = undefined;
  }

  const byDomain = new Map<string, { count: number; beforeConsentCount: number }>();
  for (const req of facts.networkRequests) {
    if (!req.domain || req.domain === ownHost) continue;
    const entry = byDomain.get(req.domain) ?? { count: 0, beforeConsentCount: 0 };
    entry.count++;
    if (req.beforeConsent) entry.beforeConsentCount++;
    byDomain.set(req.domain, entry);
  }
  // Fast mode has no network-request timeline, so fall back to third-party script hosts.
  if (byDomain.size === 0) {
    for (const src of facts.scriptSrcs) {
      try {
        const domain = new URL(src).hostname;
        if (domain === ownHost) continue;
        const entry = byDomain.get(domain) ?? { count: 0, beforeConsentCount: 0 };
        entry.count++;
        byDomain.set(domain, entry);
      } catch {
        // ignore
      }
    }
  }

  const thirdPartyDomains: ThirdPartyDomainFinding[] = [...byDomain.entries()]
    .map(([domain, { count, beforeConsentCount }]) => ({
      domain,
      requestCount: count,
      firedBeforeConsent: facts.mode === "browser" ? beforeConsentCount > 0 : undefined,
    }))
    .sort((a, b) => b.requestCount - a.requestCount);

  return {
    trackers,
    thirdPartyDomains,
    consentBannerDetected: facts.consentBannerDetected ?? false,
    consentInteraction: facts.consentInteraction,
    note:
      facts.mode === "fast"
        ? "Fast mode only sees script tags present in the initial HTML — it cannot observe requests that fire after JavaScript runs, or whether they preceded a consent interaction. Use browser mode for consent-timing analysis."
        : "Observation only — this is a factual list of what fired and when, not a legal conclusion about compliance.",
  };
}
