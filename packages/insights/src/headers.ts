import type { SiteFacts } from "@adaiyalam/engine";

export interface SecurityHeaderFinding {
  header: string;
  present: boolean;
  value?: string;
  note: string;
}

const CHECKED_HEADERS: { header: string; note: string }[] = [
  { header: "content-security-policy", note: "Mitigates XSS and data-injection by restricting what content can load/execute." },
  { header: "strict-transport-security", note: "Forces HTTPS for future visits, preventing downgrade/stripping attacks." },
  { header: "x-content-type-options", note: "Set to 'nosniff' to stop browsers from MIME-sniffing responses away from the declared Content-Type." },
  { header: "x-frame-options", note: "Mitigates clickjacking by restricting who can frame this page (superseded by CSP's frame-ancestors, either is fine)." },
  { header: "referrer-policy", note: "Controls how much of the referring URL is leaked to other origins." },
  { header: "permissions-policy", note: "Restricts which browser features (camera, geolocation, etc.) this page may use." },
];

export function analyzeSecurityHeaders(facts: SiteFacts): SecurityHeaderFinding[] {
  return CHECKED_HEADERS.map(({ header, note }) => {
    const value = facts.headers[header];
    const hasFrameProtection = header === "x-frame-options" && (facts.headers["content-security-policy"] ?? "").includes("frame-ancestors");
    return { header, present: value !== undefined || hasFrameProtection, value, note };
  });
}

export interface ExposedBannerFinding {
  header: string;
  value: string;
  note: string;
}

/** Server/X-Powered-By banners that leak specific software + version info to anyone probing the site. */
export function analyzeExposedBanners(facts: SiteFacts): ExposedBannerFinding[] {
  const findings: ExposedBannerFinding[] = [];
  for (const header of ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version", "x-generator"]) {
    const value = facts.headers[header];
    if (value && /[0-9]/.test(value)) {
      findings.push({ header, value, note: "Exposes a specific software version to anyone who requests the page — helps attackers target known issues in that exact version." });
    }
  }
  return findings;
}

export interface TlsFinding {
  issue: string;
  detail: string;
}

export function analyzeTls(facts: SiteFacts): TlsFinding[] {
  const findings: TlsFinding[] = [];
  if (facts.finalUrl.startsWith("https:")) {
    if (facts.tlsValid === false) {
      findings.push({ issue: "invalid-certificate", detail: "The TLS certificate did not validate (expired, self-signed, or hostname mismatch)." });
    }
    if (facts.tlsProtocol && /^(TLSv1|TLSv1\.1|SSLv3)$/i.test(facts.tlsProtocol)) {
      findings.push({ issue: "outdated-tls-protocol", detail: `Negotiated ${facts.tlsProtocol}, which is deprecated — modern clients and server configs should use TLS 1.2 or 1.3.` });
    }
  }
  return findings;
}

export interface MixedContentFinding {
  url: string;
}

export function analyzeMixedContent(facts: SiteFacts): MixedContentFinding[] {
  if (!facts.finalUrl.startsWith("https:")) return [];
  const httpUrls = new Set<string>();
  for (const src of facts.scriptSrcs) {
    if (src.startsWith("http://")) httpUrls.add(src);
  }
  for (const link of facts.linkTags) {
    if (link.href.startsWith("http://")) httpUrls.add(link.href);
  }
  return [...httpUrls].map((url) => ({ url }));
}
