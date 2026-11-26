# Signing and verifying a ruleset package

Every scan report already carries a `rulesetVersion` — a content hash of
the exact rules that produced it (see `@adaiyalam/engine`'s
`compileRuleset`). That's enough to know *which* ruleset a report came
from. Signing is for a different question: *did this ruleset bundle really
come from whoever claims to have published it, unmodified in transit?*

There is no hosted distribution channel for Adaiyalam's ruleset today —
these commands are the mechanism, ready for whoever runs a fork/maintainer
build to publish signed updates once there's somewhere to publish them to
(a GitHub release, an internal registry, etc.). This is intentionally
scoped to what's actually verifiable right now, rather than a fake "check
for updates" feature pointed at a URL that doesn't serve anything real.

## Generate a keypair (once, as the maintainer)

```sh
adaiyalam rule keygen --out-dir ./keys
```

Writes `keys/private.pem` and `keys/public.pem` (Ed25519). **Never commit
or share `private.pem`** — anyone who has it can sign packages as you.
`public.pem` is what you distribute to anyone who needs to verify your
packages.

## Package and sign the current ruleset

```sh
adaiyalam rule package --sign-with ./keys/private.pem --out ruleset-package.json
```

Produces a JSON file: `{ package: { schemaVersion, version, generatedAt,
technologyCount, technologies }, signature }`. `package.version` is the
same hash that would show up as a scan's `rulesetVersion` if you loaded
exactly this bundle.

## Verify a package before trusting it

```sh
adaiyalam rule verify-package ruleset-package.json --public-key ./keys/public.pem
```

Prints `OK` (exit 0) if the signature matches that public key and the
contents are unmodified, or `FAILED` (exit 1) otherwise — a mismatched key,
a different signer, or any edit to the package after it was signed all
fail the same way, on purpose: the command tells you whether to trust it,
not why it failed, since "why" could itself be misleading for a tampered
file.

## What this does and doesn't prove

- **Proves**: the bundle's bytes are exactly what the private-key holder
  signed.
- **Doesn't prove**: that the rules inside are correct. That's what
  `packages/evaluation` (ground-truth precision/recall) and `adaiyalam
  rule quality` (local hit-rate/false-positive signal) are for.
- **Doesn't do**: fetch anything over the network. There's no built-in
  "pull the latest signed ruleset from X" command, because there's no `X`
  that actually exists yet for this project. Loading a verified package
  into the running ruleset (instead of just inspecting it) is also not
  wired up yet — today, updating the ruleset means editing
  `packages/rules/data/*.json` and rebuilding, same as any other code
  change.
