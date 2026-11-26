import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline/promises";
import { APP_NAME, PATHS } from "@adaiyalam/config";

const NOTICE_TEXT = `
${APP_NAME} scans PUBLIC web pages only. By using it you agree to:
  - Respect robots.txt and each site's rate limits.
  - Never log in, bypass CAPTCHAs/bot protection, or access paywalled content.
  - Never run vulnerability exploits or intrusive probes — only passive,
    publicly-documented signals.
  - Only scan sites you own, have permission to test, or are assessing for
    legitimate, non-intrusive research with no attempt to access private data.
  - Every detection is PROBABILISTIC. Confidence scores and version numbers
    are inferences, not proof — and vulnerability hints are NOT confirmed
    findings.

This tool does not collect personal data and sends no telemetry anywhere.
`;

interface NoticeState {
  acknowledgedAt?: string;
}

function readState(): NoticeState {
  if (!existsSync(PATHS.config)) return {};
  try {
    return JSON.parse(readFileSync(PATHS.config, "utf-8"));
  } catch {
    return {};
  }
}

function writeState(state: NoticeState): void {
  mkdirSync(PATHS.home, { recursive: true });
  writeFileSync(PATHS.config, JSON.stringify(state, null, 2));
}

export async function ensureNoticeAcknowledged(opts: { bulk?: boolean; assumeYes?: boolean } = {}): Promise<void> {
  const state = readState();

  if (!state.acknowledgedAt) {
    process.stderr.write(NOTICE_TEXT);
    if (opts.assumeYes || process.env.ADAIYALAM_ACCEPT_NOTICE === "1") {
      writeState({ ...state, acknowledgedAt: new Date().toISOString() });
    } else if (!process.stdin.isTTY) {
      throw new Error(
        "First use requires accepting the usage notice above. Re-run with --yes, or set ADAIYALAM_ACCEPT_NOTICE=1 in a non-interactive environment."
      );
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
      const answer = await rl.question("Type 'I agree' to continue: ");
      rl.close();
      if (answer.trim().toLowerCase() !== "i agree") {
        throw new Error("Usage notice was not accepted. Exiting.");
      }
      writeState({ ...state, acknowledgedAt: new Date().toISOString() });
    }
  }

  if (opts.bulk) {
    process.stderr.write(
      "\nBulk scan requested. Confirm this domain list is yours, or you have permission/legitimate research grounds to scan it, and that you will respect each site's robots.txt and rate limits.\n"
    );
    if (opts.assumeYes || process.env.ADAIYALAM_ACCEPT_NOTICE === "1") {
      return;
    }
    if (!process.stdin.isTTY) {
      throw new Error("Bulk scans require confirmation. Re-run with --yes, or set ADAIYALAM_ACCEPT_NOTICE=1 in a non-interactive environment.");
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const answer = await rl.question("Type 'yes' to confirm: ");
    rl.close();
    if (answer.trim().toLowerCase() !== "yes") {
      throw new Error("Bulk scan was not confirmed. Exiting.");
    }
  }
}
