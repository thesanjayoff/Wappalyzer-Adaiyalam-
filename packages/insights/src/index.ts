import type { DetectionResult, SiteFacts } from "@adaiyalam/engine";
import { analyzeCookies, type CookieFinding } from "./cookies.js";
import { analyzeExposedBanners, analyzeMixedContent, analyzeSecurityHeaders, analyzeTls, type ExposedBannerFinding, type MixedContentFinding, type SecurityHeaderFinding, type TlsFinding } from "./headers.js";
import { analyzePrivacy, type PrivacyInventory } from "./privacy.js";
import { findScriptsMissingIntegrity, findTyposquattingLikeDomains, type MissingIntegrityFinding, type TyposquattingFinding } from "./supply-chain.js";
import { analyzeVulnerabilities, type RuleVulnMeta, type VulnHint } from "./vulnerabilities.js";

export * from "./cookies.js";
export * from "./headers.js";
export * from "./privacy.js";
export * from "./supply-chain.js";
export * from "./vulnerabilities.js";

export interface InsightsReport {
  securityHeaders: SecurityHeaderFinding[];
  exposedBanners: ExposedBannerFinding[];
  tls: TlsFinding[];
  mixedContent: MixedContentFinding[];
  cookies: CookieFinding[];
  supplyChain: { missingIntegrity: MissingIntegrityFinding[]; typosquattingLikeDomains: TyposquattingFinding[] };
  privacy: PrivacyInventory;
  vulnerabilities: VulnHint[];
}

export function buildInsightsReport(detections: DetectionResult[], facts: SiteFacts, ruleMeta: (techId: string) => RuleVulnMeta | undefined): InsightsReport {
  return {
    securityHeaders: analyzeSecurityHeaders(facts),
    exposedBanners: analyzeExposedBanners(facts),
    tls: analyzeTls(facts),
    mixedContent: analyzeMixedContent(facts),
    cookies: analyzeCookies(facts),
    supplyChain: {
      missingIntegrity: findScriptsMissingIntegrity(facts),
      typosquattingLikeDomains: findTyposquattingLikeDomains(facts),
    },
    privacy: analyzePrivacy(detections, facts),
    vulnerabilities: analyzeVulnerabilities(detections, ruleMeta),
  };
}
