# Importing a community fingerprint pack

Adaiyalam's bundled ruleset (`packages/rules/data/`) is written from
scratch — no fingerprint data from any third-party project is bundled or
shipped with Adaiyalam. This command is a *converter*, not a source of
data: it turns a file **you already have, under its own license**, into
draft rules in Adaiyalam's own schema.

It is never run automatically — there is no default pack, no network
fetch, and no auto-import on startup or scan. You invoke it by hand, once,
with a file you supply.

## Usage

```sh
adaiyalam import community-pack ./my-pack.json \
  --license "MIT" \
  --source "https://example.com/some-fingerprint-project" \
  --out-dir ./imported-rules
```

`--license` and `--source` are **required** — the command refuses to run
without them, and prints both back in a banner before doing anything else,
so the license is always displayed, never silently assumed. Every
converted rule's `notes` field records the same source/license string
permanently.

## Input format

A JSON object keyed by technology name, where each value may contain:
`website`, `headers`, `html`, `scriptSrc`, `script`, `cookies`, `meta`,
`js`, `url`, `implies`, `requires`, `excludes`, `cpe`. This is a best-effort
subset of the long-standing, widely-documented "apps.json"-style community
fingerprint format. A `dom` field (complex CSS-selector-based signals) is
recognized but deliberately **not** converted — the shape varies too much
across sources to convert with confidence, and a warning is printed
instead of guessing.

Pattern strings may use the common `\;key:value` suffix convention to
embed `confidence` and `version`, e.g. `"MyTech\\;confidence:90"`. Any
signal that doesn't specify a confidence gets `--default-confidence`
(50 by default) — deliberately moderate, since an imported signal hasn't
been independently assessed the way bundled rules have.

## What happens to the output

- Every converted rule is run through Adaiyalam's own schema validator and
  ReDoS checker (the same ones `adaiyalam rule lint` uses). Anything that
  fails is skipped and reported, never written.
- Rules that pass are written as individual draft files to `--out-dir`
  (default `./imported-rules/`) — **not** into `packages/rules/data/**`.
  Nothing here joins the bundled ruleset until a human reviews a specific
  file and moves it there on purpose.
- Numeric `cats` (category ids) are not mapped to Adaiyalam's own
  categories — there's no stable, confidently-known public mapping to
  rely on, so every imported rule defaults to `miscellaneous` and the
  command warns about it. Pick real categories by hand.

## Before trusting an imported rule

Treat every file in `--out-dir` as a first draft: read it, write
positive/negative fixtures under `packages/rules/fixtures/<id>/` (see
`adaiyalam rule test`), and re-run `adaiyalam rule lint` after any edits —
exactly the same bar bundled rules are held to.
