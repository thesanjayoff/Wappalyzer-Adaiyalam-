# Adaiyalam

Adaiyalam ("identifier"/"mark" in Tamil) is an open, evidence-based website
(and, via an adapter, mobile app) technology detector. It observes public
signals — response headers, HTML, cookies, scripts, DOM/JS globals in
browser mode — and matches them against a self-authored fingerprint
ruleset, scoring every detection as a probability with the evidence that
produced it. It never claims certainty, never logs in or bypasses
protections, and never phones home.

## Contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [Architecture](#architecture)
- [The CLI](#the-cli)
- [The local dashboard](#the-local-dashboard)
- [The browser extension](#the-browser-extension)
- [Fingerprint rules](#fingerprint-rules)
- [Security, ethics, and privacy](#security-ethics-and-privacy)
- [License and third-party data](#license-and-third-party-data)
- [Evaluation results](#evaluation-results)
- [Known limitations](#known-limitations)

## Quick start

Requires Node.js 20+. All commands below work the same on Windows
(PowerShell or Git Bash), macOS, and Linux — this is a plain Node/TypeScript
project with no native build step for the core tool (the browser-mode
collector additionally needs Playwright's bundled Chromium, installed
below).

```sh
git clone <this repo>
cd adaiyalam
npm install
npx playwright install chromium   # only needed for browser (--browser) mode

# Fast-mode scan (HTTP + HTML only, no browser)
npm run cli -- scan https://example.com --yes

# Browser-mode scan (adds DOM/JS-global signals, consent-banner handling)
npm run cli -- scan-browser https://example.com --yes

# Local web dashboard
npm run cli -- dashboard
```

`--yes` accepts the one-time usage notice non-interactively (see
[Security, ethics, and privacy](#security-ethics-and-privacy)); omit it in
an interactive terminal and you'll be asked to type `I agree` once. On
Windows, if `npm run cli --` gives you quoting trouble with a URL
containing `&` or `?`, quote the whole URL: `npm run cli -- scan "https://example.com/path?x=1"`.

Run everything (typecheck, full test suite, ReDoS report) the way this
project verifies itself:

```sh
npx tsc -b   # typecheck all packages
npx vitest run
npm run cli -- evaluate redos
```

## What it does

- **Fast mode**: a single SSRF-safe HTTP fetch of the homepage (plus
  `robots.txt`, favicon, a couple of opt-in same-origin probe paths), fed
  through the fingerprint matcher.
- **Browser mode**: the same, through a hardened, isolated Playwright
  Chromium context, adding DOM existence/attribute/text, JS-global, and
  CSS signals — plus optional consent-banner interaction
  (`--consent accept|reject`) and optional multi-page crawling
  (`--crawl`: follows a few same-origin product/checkout/contact-style
  links from the homepage and merges their signals into one report).
- **Confidence, not certainty**: every detection carries a 1-100%
  confidence built from a probabilistic-OR combination of every matching
  signal (`combined = 1 - Π(1 - cᵢ)`), discounted by any matching negative
  signal. Implied technologies, version extraction, and category rollups
  all flow from the same matched-evidence graph — nothing is hard-coded
  per technology outside the ruleset.
- **Security & privacy insights** (`@adaiyalam/insights`): missing
  security headers, exposed version banners, mixed content, outdated TLS,
  cookie-flag hygiene, CDN scripts without SRI, a tracker/privacy
  inventory, and version-aware vulnerability/EOL hints cross-referenced
  against a locally-cached CISA KEV catalog and OSV.dev — all explicitly
  framed as probabilistic hints, **never** confirmed findings (see
  `apps/cli`'s `vuln-data` commands, which fetch nothing during an
  ordinary scan).
- **Bulk scanning, diffing, scheduled watch**: a worker pool with shared
  rate limiting for many domains at once (`bulk`), change detection
  between two scans of the same site (`diff`), and a scheduled re-scan
  that reports what changed (`watch`).
- **Local persistence, never remote**: every scan can be saved to a local
  snapshot store and replayed, exported (JSON/HTML/CSV), or diffed later
  — no server-side storage, no account, no telemetry.
- **Optional AI summary** (`--ai-summary`, off by default): turns a
  report's structured detections into a plain-language paragraph via an
  LLM you configure (Anthropic or any OpenAI-compatible endpoint, your own
  API key). Untrusted page content is never sent to the model —  only
  Adaiyalam's own detected technology names and short, sanitized,
  length-capped insight lines, with an explicit system-prompt instruction
  to treat them as data, never instructions.
- **"App mode"**: an *adapter*, not a decompiler — Adaiyalam does not
  parse APK/IPA binaries itself. It matches a small SDK-fingerprint
  ruleset against facts (permissions, embedded class-name prefixes,
  manifest metadata, native libraries, strings) that an external
  reverse-engineering tool (apktool/jadx/aapt/etc.) has already extracted
  (`adaiyalam app schema` to see the expected input shape).

## Architecture

A TypeScript/npm-workspaces monorepo. Each package does one thing:

| Package | Responsibility |
|---|---|
| `packages/schema` | The fingerprint rule schema (Zod), validator, ReDoS-safety checker — Adaiyalam's own format |
| `packages/engine` | The matcher: confidence combination, implies/requires/excludes resolution, version extraction |
| `packages/collectors` | SSRF-safe HTTP fetcher, robots.txt parser, rate limiter, HTML/cookie/DNS/TLS/favicon collection (fast mode); Playwright-based collection (browser mode); link discovery for multi-page crawl |
| `packages/rules` | The bundled ruleset data + loader, plus the signed-package mechanism (`rule package`/`verify-package`) |
| `packages/store` | Local snapshot persistence (scans, sites, false-positive feedback) |
| `packages/vuln-data` | Locally-cached EOL schedule, CISA KEV catalog, OSV.dev lookups — fetched only via explicit maintenance commands |
| `packages/insights` | Security/privacy findings built from a scan's facts |
| `packages/orchestrator` | Ties collectors + engine + rules + insights into one scan, plus crawl-merging, diffing, rule-quality reporting, report export |
| `packages/evaluation` | The ground-truth precision/recall harness, ReDoS report, fast-vs-full comparison |
| `packages/app-analysis` | The mobile "app mode" adapter: its own small ruleset + matcher/stack resolver |
| `packages/ai-summary` | The optional LLM summary layer and its provider adapters |
| `packages/community-import` | The off-by-default community-fingerprint-pack converter |
| `apps/cli` | The `adaiyalam` command-line tool — the primary interface |
| `apps/api` | A local Fastify server + static dashboard UI (`adaiyalam dashboard`) |
| `apps/extension` | An MV3 browser extension exposing the same engine client-side |

## The CLI

Run via `npm run cli -- <command>` or, once installed as a bin, `adaiyalam
<command>`. Top-level commands: `scan`, `scan-browser`, `export` (replay a
saved scan to HTML/CSV/JSON), `dashboard`, `bulk` (start/resume/list/status/
cancel/export/aggregate), `diff`/`compare`/`watch`, `history`/`sites`/
`replay`/`forget`, `app` (schema/analyze/rules), `rule` (lint/test/new/
quality/report-false-positive/keygen/package/verify-package), `import
community-pack`, `evaluate` (ground-truth/redos/fast-vs-full/report), and
`vuln-data` (update-kev/update-osv). Every command has `--help`.

A few worth knowing about specifically:

- `adaiyalam rule quality` — a local signal built from *your own*
  installation's scan history and false-positive reports (never sent
  anywhere): hit rate per rule, and a false-positive count fed by
  `adaiyalam rule report-false-positive <scanId> <techId>` or the "⚠
  report" button in the dashboard. This is a local health signal, not a
  substitute for the ground-truth evaluation harness below.
- `adaiyalam rule keygen` / `rule package` / `rule verify-package` — sign
  and verify a distributable ruleset bundle (Ed25519). See
  [docs/RULE_SIGNING.md](docs/RULE_SIGNING.md) for exactly what this does
  and doesn't prove (there's no hosted distribution channel yet — this is
  the mechanism, ready for one).
- `adaiyalam import community-pack` — converts a third-party fingerprint
  file *you already have* into draft Adaiyalam rules. Off by default,
  requires `--license`/`--source`, never adds anything to the bundled
  ruleset automatically. See
  [docs/COMMUNITY_IMPORT.md](docs/COMMUNITY_IMPORT.md).

## The local dashboard

```sh
npm run cli -- dashboard   # serves on http://127.0.0.1:4848 by default
```

A single local Fastify server + static frontend (dark/light mode, no
build step, no external services): scan a URL, browse saved sites, see
the stack graph, security/privacy insights, and the rule-quality view
with inline false-positive reporting.

## The browser extension

`apps/extension` is an MV3 extension that runs the same engine
client-side against the page you're viewing, with no network calls of
its own beyond what the page already made.

```sh
cd apps/extension
npm run build        # bundles the ruleset + engine into dist/
```

Then load it unpacked: open `chrome://extensions`, enable Developer mode,
"Load unpacked", and select `apps/extension/dist`.

## Fingerprint rules

See [docs/RULE_SCHEMA.md](docs/RULE_SCHEMA.md) for the full schema
reference and authoring guide: signal types, the confidence-combination
model, `implies`/`requires`/`excludes`, and the `rule new` → `rule lint`
→ fixtures → `packages/rules/data/` workflow. See
[docs/RULESET_CHANGELOG.md](docs/RULESET_CHANGELOG.md) for the ruleset's
own history, with every technology count independently verified against
git history rather than trusted from commit-message text.

The bundled ruleset currently covers **221 technologies** across CMS,
ecommerce/payments, JS frameworks, servers/languages, CDN/hosting,
analytics/advertising/marketing, support widgets, fonts/chat/consent/
security, headless/static CMS, and India-market SaaS — **451 regex
patterns, 0 flagged unsafe** by the ReDoS checker (`adaiyalam evaluate
redos`).

## Security, ethics, and privacy

Every scan, on first use, prints and requires acknowledgment of:

> Adaiyalam scans PUBLIC web pages only. By using it you agree to:
> - Respect robots.txt and each site's rate limits.
> - Never log in, bypass CAPTCHAs/bot protection, or access paywalled content.
> - Never run vulnerability exploits or intrusive probes — only passive, publicly-documented signals.
> - Only scan sites you own, have permission to test, or are assessing for legitimate, non-intrusive research with no attempt to access private data.
> - Every detection is PROBABILISTIC. Confidence scores and version numbers are inferences, not proof — and vulnerability hints are NOT confirmed findings.
>
> This tool does not collect personal data and sends no telemetry anywhere.

This isn't just a banner — it's backed by the code:

- **robots.txt is fetched and enforced** before any other request to a
  host (`packages/collectors/src/net/robots.ts`); a disallowed path
  short-circuits the scan with an explicit error rather than silently
  scanning anyway.
- **An SSRF-safe fetcher** (`packages/collectors/src/net/`) resolves and
  checks every target against private/loopback/link-local ranges before
  connecting — including literal-IP URLs — unless you explicitly pass
  `--allow-private-hosts` for your own dev servers.
- **Rate limiting** is shared across a whole bulk run and configurable
  per scan (`--global-rps`, `--host-delay-ms`), on by default.
- **No login, no CAPTCHA/bot-protection bypass, no intrusive probing** —
  the only "active" collection beyond a normal page load is a small,
  opt-in, hard-capped, robots-respecting set of same-origin probe paths.
- **Version-based vulnerability/EOL hints are never presented as
  confirmed findings** — `packages/insights` and `packages/vuln-data`
  frame every such hint probabilistically, and the KEV/OSV caches are
  updated only via explicit `adaiyalam vuln-data update-*` commands, never
  during an ordinary scan.
- **Everything is local.** Scans, sites, false-positive feedback, and
  rule-quality stats live under a local Adaiyalam home directory
  (`@adaiyalam/config`'s `PATHS`). Nothing is sent anywhere unless *you*
  explicitly turn on `--ai-summary` and point it at a provider you
  configured yourself.

## License and third-party data

Adaiyalam's own code is MIT-licensed (see [LICENSE](LICENSE)). The
fingerprint ruleset in `packages/rules/data/` is written from scratch for
this project — no fingerprint data from any third-party project is
bundled or shipped. The only path by which third-party fingerprint data
can enter this codebase is `adaiyalam import community-pack`, which is
off by default, requires the caller to supply their own file under its
own license, requires that license to be named on every invocation, and
writes output to a separate, un-bundled directory (see
[docs/COMMUNITY_IMPORT.md](docs/COMMUNITY_IMPORT.md)).

## Evaluation results

`packages/evaluation` is the honest version of this deliverable: a small,
**hand-verified** ground-truth set (7 real sites + negative controls,
each label independently confirmed by fetching the page/headers directly
and reading an unambiguous first-party signal — not a large-scale
benchmark, which this project doesn't have the infrastructure or
verified-at-scale labels to claim credibly).

Latest run (`adaiyalam evaluate ground-truth`, 2026-11-26, 10 sites,
0 errors):

```
Overall: precision 31.6%, recall 100.0%, F1 48.0%
  (TP 12, FP 26, FN 0)
```

**Read precision generously here, not literally**: ground-truth labels
are *not exhaustive* — each site lists only the 1-3 headline technologies
verified by hand, not every technology genuinely present on that page.
Recall is a reliable signal (every labeled technology was found). Most of
the 26 "false positives" are very likely additional real technologies
that were simply never added to the label list (e.g. detecting jQuery or
Google Tag Manager on a site whose ground-truth entry only names its
CMS) — not proven detector errors. The harness itself documents this
caveat (`PRECISION_CAVEAT` in `ground-truth-eval.ts`) and treats a
reported false positive as "worth investigating," not "proven wrong."

This isn't purely theoretical: running this same harness earlier in
development caught one genuine bug — a `github-pages` rule firing on
`github.com` itself because of an ambiguous shared header — fixed by
adding a negative pattern (see
[docs/RULESET_CHANGELOG.md](docs/RULESET_CHANGELOG.md)).

`adaiyalam evaluate redos` and `adaiyalam evaluate fast-vs-full` are the
other two legs of the harness: regex timing safety across the whole
ruleset, and a side-by-side comparison of fast-mode vs. browser-mode
detection on the same URLs.

## Known limitations

Documented honestly rather than smoothed over:

- **221 technologies, not 300+.** The ruleset was grown from 66 to 221 in
  one deliberate expansion pass, each addition backed by a real signal
  its author was confident of — and stopped there rather than padding the
  count with guessed signals. Growing further the same way is ongoing
  work, not a backlog item with a deadline.
- **Ground truth is small (7 sites + negative controls).** Large-scale,
  independently-verified benchmark labels for hundreds of sites don't
  exist for this project; the harness is honest about that rather than
  fabricating a bigger set.
- **"App mode" is an adapter, not a decompiler.** It never parses
  APK/IPA binaries itself — it consumes facts a separate reverse-
  engineering tool already extracted. There is no built-in APK/IPA
  unpacking.
- **The AI summary's live provider calls were not end-to-end verified
  with a real API key** in the environment this was built in (no key was
  available) — the config-validation and error paths were, including the
  clear failure when no provider is configured.
- **Signed ruleset packages have no distribution channel to fetch from
  yet.** `rule keygen`/`package`/`verify-package` are real, independently
  tested cryptographic machinery, but there's no built-in "check for
  updates" command, because there's nowhere real to check against today.
- **The community-import converter doesn't map third-party category ids**
  (no stable public mapping was confidently known) and doesn't convert
  `dom`-selector-based signals (format too variable across sources) —
  both are called out as explicit warnings rather than silently guessed.
- **Confidence numbers for imported rules are provisional defaults**
  (50% unless the source pack embeds its own), not independently
  assessed the way bundled rules are — imported output is meant to be a
  draft, reviewed and fixture-tested before being trusted.
