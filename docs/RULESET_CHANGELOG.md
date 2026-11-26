# Ruleset changelog

Every ruleset build is content-addressed: `getRuleset().version` (shown as
"ruleset version" in every report) is a hash over the compiled rules, so any
change to `packages/rules/data/*.json` produces a new version automatically —
there is no separate version number to remember to bump. This file is the
human-readable history of what changed and why, verified against this
repository's actual git history (counts below were recomputed from each
commit's tree, not copied from commit messages, which can drift).

See [RULE_SIGNING.md](./RULE_SIGNING.md) for how to produce a signed,
distributable ruleset bundle from any point in this history.

## Unreleased / in progress

Nothing pending.

## 221 technologies — commit `0b04d6b`

**Expand the ruleset from 66 to 221 technologies.**

Added 5 new rule files (155 technologies), each authored from scratch with
the same confidence-and-evidence discipline as the original set — high
confidence (85-100) only for a genuinely vendor-unique signal, a `notes`
field spelling out uncertainty wherever a signal was only moderately
confident:

- `india-market.json` (+14): Indian hosting/domain providers and
  Indian-market SaaS (Zoho PageSense/Forms, Freshchat, Freshdesk,
  Chargebee, Instamojo, Juspay, Haptik, MoEngage, CleverTap, WebEngage,
  ImageKit).
- `headless-and-static-cms.json` (+28): Contentful, Sanity, Strapi,
  Prismic, Craft CMS, TYPO3, Umbraco, Sitecore, AEM, Hugo, Jekyll,
  Gatsby, Astro, Notion sites, Weebly, Framer, and more.
- `ecommerce-and-payments-global.json` (+19): OpenCart, VTEX, Shopware,
  Square, Braintree, Adyen, Klarna, Amazon Pay, Google Pay, and more.
- `marketing-analytics-and-support.json` (+49): Mixpanel, Amplitude,
  Segment, FullStory, Optimizely, VWO, Mailchimp, HubSpot, Zendesk,
  Drift, Trustpilot, and more.
- `infra-cdn-video-and-widgets.json` (+45): Heroku, Render, Sentry, New
  Relic Browser, YouTube, Vimeo, Google Maps, Algolia DocSearch, Flask,
  FastAPI, Spring Boot, and more.

This commit's own history records which candidate technologies were
deliberately *not* added because no author was confident of a real,
specific signal (see the commit message) — the set grows honestly or not
at all.

## 66 technologies, 1 rule fixed — commit `928f44d`

**Add an evaluation harness; fix a real false-positive it found.**

Running the new ground-truth evaluation harness (see
[../packages/evaluation](../packages/evaluation)) against `github.com`
itself caught a real bug: the `github-pages` rule fired at 95% confidence
on github.com's own homepage, because its `Server: GitHub.com` header is
ambiguous — GitHub's own Rails app sends the same header as a real
*.github.io Pages site. Fixed by dropping that header's standalone
confidence to 40 and adding a negative `url` pattern that excludes
`github.com` itself. Rule count unchanged (66); one rule corrected.

## 66 technologies, metadata only — commit `1ae6afa`

**Add security & privacy insights.** Tagged a handful of existing rules
(jQuery, React, Vue, Next.js, Nuxt.js, Angular, Bootstrap, Express.js) with
an `osvPackage` field (npm ecosystem + package name) so the new insights
layer can cross-reference OSV.dev vulnerability data against a detected
version. No technologies added or removed.

## 66 technologies (initial) — commit `1c6ac3c`

**Add original starter ruleset.** 8 rule files across CMS, ecommerce,
JS frameworks, servers/languages, CDN/hosting, analytics/advertising,
payments, and fonts/chat/consent/security — written from scratch, not
copied from any third-party ruleset (see
[../packages/rules/README.md](../packages/rules/README.md) if present, or
the fingerprint schema's own doc comment in
`packages/schema/src/fingerprint.ts`).

## Known gap

221 is still short of the "at least 300 technologies" target the original
spec names. Growing further the same way (one well-justified signal at a
time, skipping anything not confidently known) is ongoing work, not a
backlog item with a deadline.
