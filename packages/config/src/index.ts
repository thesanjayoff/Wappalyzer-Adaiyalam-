import os from "node:os";
import path from "node:path";

/**
 * Single source of truth for the product name. Change this constant (and
 * nothing else) to rename the whole product across the CLI, dashboard,
 * API, extension, and generated reports.
 */
export const APP_NAME = "Adaiyalam";

export const APP_SLUG = APP_NAME.toLowerCase();

export const APP_TAGLINE = "An open, evidence-based website technology detector";

/** Bump when the on-disk data format changes in a backwards-incompatible way. */
export const APP_DATA_VERSION = 1;

export const DEFAULT_CONTACT_URL = "https://github.com/adaiyalam/adaiyalam";

/** Honest, identifiable User-Agent used for every outbound HTTP request. */
export function buildUserAgent(version: string): string {
  return `${APP_NAME}/${version} (+${DEFAULT_CONTACT_URL}; technology-detector; contact-via-github)`;
}

function resolveHomeDataDir(): string {
  const override = process.env.ADAIYALAM_HOME;
  if (override && override.trim().length > 0) {
    return override;
  }
  const home = os.homedir();
  if (process.platform === "win32") {
    const base = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return path.join(base, APP_NAME);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  const xdg = process.env.XDG_DATA_HOME ?? path.join(home, ".local", "share");
  return path.join(xdg, APP_SLUG);
}

export const PATHS = {
  home: resolveHomeDataDir(),
  get db() {
    return path.join(this.home, "adaiyalam.sqlite3");
  },
  get snapshots() {
    return path.join(this.home, "snapshots");
  },
  get cache() {
    return path.join(this.home, "cache");
  },
  get config() {
    return path.join(this.home, "config.json");
  },
  get vulnData() {
    return path.join(this.home, "vuln-data");
  },
  get bulkJobs() {
    return path.join(this.home, "bulk-jobs");
  },
  get logs() {
    return path.join(this.home, "logs");
  },
};
