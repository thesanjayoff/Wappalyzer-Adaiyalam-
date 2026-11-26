# Fingerprint rule schema and authoring guide

Adaiyalam's rule format is its own — written from scratch for this
project, not copied from any third-party ruleset. The schema and matcher
live in `@adaiyalam/schema` (`packages/schema/src/fingerprint.ts`) and
`@adaiyalam/engine`.

## The shape of a rule file

A rule file is `{ "schemaVersion": 1, "technologies": [ ...rules ] }`.
Each rule:

```jsonc
{
  "schemaVersion": 1,
  "id": "wordpress",                 // kebab-case, used everywhere else as the stable id
  "name": "WordPress",
  "description": "...",              // 1-400 chars
  "website": "https://wordpress.org",
  "categories": ["cms"],              // ids from packages/schema/src/categories.ts
  "pricing": ["open-source"],         // free | freemium | paid | open-source
  "openSource": true,
  "cpe": "cpe:2.3:a:wordpress:wordpress:{version}:*:*:*:*:*:*:*", // optional, CPE 2.3
  "osvPackage": { "ecosystem": "npm", "name": "..." },             // optional, enables OSV.dev vuln hints
  "implies": ["php"],                 // detecting this implies these too (lower confidence unless given one)
  "requires": [],                     // only match if these are already detected
  "excludes": [],                     // never co-occurs with these; a rule and its own excludes conflicting is a lint error
  "evidence": [ /* see below */ ],
  "notes": "author notes, not shown to end users"
}
```

## Evidence patterns and signal types

Each entry in `evidence` is one observable signal:

| `type` | Matches against | `key` meaning |
|---|---|---|
| `header` | an HTTP response header | header name |
| `cookie` | a `Set-Cookie` name | cookie name (`*` suffix wildcard supported by convention) |
| `meta` | an HTML `<meta>` tag | `name`/`property` value |
| `scriptSrc` | a `<script src="...">` URL | — |
| `scriptInline` | inline `<script>` body text | — |
| `html` | the raw HTML document | — |
| `url` | the page URL itself | — |
| `robots` | `robots.txt` contents | — |
| `dns` | a DNS record | record type (`CNAME`/`MX`/`TXT`/`NS`) |
| `tlsIssuer` | the TLS certificate issuer | — |
| `faviconHash` | the favicon's content hash | — |
| `probe` | a response from an extra same-origin path fetch | probe path |
| `domExists` / `domAttr` / `domText` | a DOM node (browser mode only) | CSS selector |
| `jsGlobal` | a global on `window` (browser mode only) | dotted global path |
| `css` | computed/stylesheet signals (browser mode only) | — |

`domExists`/`domAttr`/`domText`/`jsGlobal`/`css` only ever fire in
browser (Playwright) mode — fast mode can't observe them, and a rule that
depends only on those signals will never match a fast scan.

Fields on each pattern:

- `pattern`: a regex **source string** (no literal-string shortcut —
  escape literal dots/slashes yourself, or use the engine's
  `escapeRegex()` helper). Required for every type except `domExists`,
  which matches on presence alone — convention for "just check this
  exists" signals (a cookie, a JS global) is `pattern: ".*"`.
- `flags`: regex flags, default `"i"`.
- `confidence`: 1-100. How sure this *one* signal is, on its own, that the
  technology is present. Multiple hits combine probabilistically (see
  below) — they don't just average.
- `version`: an optional template like `"$1"` or `"$1.$2"` referencing
  regex capture groups, used to extract a version string.
- `negative: true`: this signal, if it matches, *suppresses* the rule
  instead of confirming it — used to rule out a near-identical competing
  technology (e.g. a generic header that both a real product and a
  common false-positive share). A negative pattern needs `confidence: 100`
  to fully suppress; a lower value only partially discounts it (the math
  is `combined *= 1 - confidence/100`, so `confidence: 0` has *no* effect
  at all — this exact mistake was made and fixed once in this project's
  own ruleset, see `docs/RULESET_CHANGELOG.md`).
- `note`: free-text, shown in `rule lint` output, not to end users.

A rule must have at least one non-negative pattern (a rule made entirely
of negative patterns can never fire).

## How confidence combines

Multiple matching positive signals combine as a probabilistic OR, not a
sum or average: `combined = 1 - Π(1 - c_i)`. Two 60%-confidence hits
combine to 84%, not 120% (capped) or 60%. Negative hits then multiply the
result down further: `combined *= 1 - c_j` for each matching negative
pattern. This means confidence numbers are meant to be read as genuine
probabilities, not arbitrary scores — pick them accordingly (a
vendor-unique script URL deserves 90+; a generic header shared by several
products deserves 30-50).

## `implies` / `requires` / `excludes`

- `implies`: detecting this rule also marks the implied technology as
  detected (at a lower, explicit confidence unless you give the implied
  entry its own `{ "id": ..., "confidence": ... }`). Resolved to a fixed
  point, so chains (A implies B implies C) work. A rule implying itself
  is a lint error.
- `requires`: this rule is only considered if the required technology was
  *also* independently detected (e.g. a WordPress plugin rule requiring
  `wordpress`).
- `excludes`: this rule and any of its excludes are considered mutually
  exclusive; having an id in both `requires` and `excludes` is a lint
  error.

## Authoring workflow

```sh
adaiyalam rule new my-cool-tech --category cms --out ./drafts
adaiyalam rule lint ./drafts/my-cool-tech.json   # schema + dangling-reference + ReDoS checks
```

Add fixtures so the rule is tested automatically forever after, not just
once by hand:

```
packages/rules/fixtures/my-cool-tech/positive-1.json
packages/rules/fixtures/my-cool-tech/negative-1.json
```

Each fixture is `{ "expect": "positive" | "negative", "facts": { ...partial SiteFacts }, "description": "..." }`.
`adaiyalam rule test my-cool-tech` runs them by hand; every fixture also
runs automatically in the normal test suite via
`packages/rules/src/fixtures.test.ts` — no separate step needed once the
fixture files exist. When you're confident in a rule, move its file into
`packages/rules/data/`.

## ReDoS safety

Every pattern is checked with a real timing probe
(`assertSafeRegex` in `@adaiyalam/schema`) before a rule is trusted,
both in `rule lint` and in the full-ruleset test
(`packages/rules/src/ruleset.test.ts`). `adaiyalam evaluate redos` runs
the same check across the whole bundled ruleset and reports the slowest
patterns. As of the last ruleset expansion: 451 patterns across 221
rules, 0 unsafe.
