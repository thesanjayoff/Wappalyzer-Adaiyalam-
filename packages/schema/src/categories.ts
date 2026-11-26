/**
 * Fixed list of technology categories. Keep ids stable: rules reference
 * them by id, and the dashboard groups by id.
 */
export interface CategoryDef {
  id: string;
  name: string;
  /** Lower sorts first in reports (frontend-ish things before infra-ish things). */
  priority: number;
}

export const CATEGORIES: CategoryDef[] = [
  { id: "cms", name: "CMS", priority: 10 },
  { id: "ecommerce", name: "Ecommerce", priority: 11 },
  { id: "site-builder", name: "Site Builder", priority: 12 },
  { id: "js-framework", name: "JavaScript Framework", priority: 20 },
  { id: "js-library", name: "JavaScript Library", priority: 21 },
  { id: "ui-framework", name: "UI / CSS Framework", priority: 22 },
  { id: "static-site-generator", name: "Static Site Generator", priority: 23 },
  { id: "web-server", name: "Web Server", priority: 30 },
  { id: "programming-language", name: "Programming Language", priority: 31 },
  { id: "backend-framework", name: "Backend Framework", priority: 32 },
  { id: "operating-system", name: "Operating System", priority: 33 },
  { id: "paas", name: "Hosting Platform / PaaS", priority: 40 },
  { id: "cdn", name: "CDN", priority: 41 },
  { id: "dns", name: "DNS Provider", priority: 42 },
  { id: "cloud", name: "Cloud Provider", priority: 43 },
  { id: "analytics", name: "Analytics", priority: 50 },
  { id: "tag-manager", name: "Tag Manager", priority: 51 },
  { id: "advertising", name: "Advertising", priority: 52 },
  { id: "session-replay", name: "Session Replay / Heatmaps", priority: 53 },
  { id: "social", name: "Social", priority: 54 },
  { id: "payment", name: "Payment Processor", priority: 60 },
  { id: "live-chat", name: "Live Chat", priority: 61 },
  { id: "marketing-automation", name: "Marketing Automation", priority: 62 },
  { id: "email-marketing", name: "Email Marketing", priority: 63 },
  { id: "fonts", name: "Fonts", priority: 70 },
  { id: "icon-library", name: "Icon Library", priority: 71 },
  { id: "security", name: "Security / WAF", priority: 80 },
  { id: "captcha", name: "CAPTCHA", priority: 81 },
  { id: "consent-management", name: "Consent / Cookie Management", priority: 82 },
  { id: "search", name: "Search", priority: 90 },
  { id: "video", name: "Video Player", priority: 91 },
  { id: "widget", name: "Widgets", priority: 92 },
  { id: "database", name: "Database (inferred)", priority: 95 },
  { id: "miscellaneous", name: "Miscellaneous", priority: 99 },
];

export const CATEGORY_IDS = new Set(CATEGORIES.map((c) => c.id));

export function categoryName(id: string): string {
  return CATEGORIES.find((c) => c.id === id)?.name ?? id;
}
