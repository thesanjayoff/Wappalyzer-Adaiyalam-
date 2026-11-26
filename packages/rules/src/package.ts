import { createPrivateKey, createPublicKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import { compileRuleset } from "@adaiyalam/engine";
import type { FingerprintRule } from "@adaiyalam/schema";
import { loadDefaultRuleset } from "./loader.js";

/**
 * A distributable, versioned snapshot of the ruleset. `version` is the same
 * content hash stamped on every scan report (see
 * @adaiyalam/engine#compileRuleset) — so a report's "ruleset version" can
 * be matched back to the exact package that produced it. Signing proves the
 * bundle came from whoever holds the private key and wasn't tampered with
 * in transit; it says nothing about whether the rules inside are *correct*
 * (that's what the evaluation harness and rule-quality dashboard are for).
 */
export interface RulesetPackage {
  schemaVersion: 1;
  version: string;
  generatedAt: string;
  technologyCount: number;
  technologies: FingerprintRule[];
}

export interface SignedRulesetPackage {
  package: RulesetPackage;
  /** Ed25519 signature over the canonical (stable key order) JSON of `package`, base64-encoded. */
  signature: string;
}

export function buildRulesetPackage(rules: FingerprintRule[] = loadDefaultRuleset()): RulesetPackage {
  const compiled = compileRuleset(rules);
  return {
    schemaVersion: 1,
    version: compiled.version,
    generatedAt: new Date().toISOString(),
    technologyCount: rules.length,
    technologies: rules,
  };
}

/** Deterministic serialization — same package always signs/hashes to the same bytes, regardless of object key insertion order. */
function canonicalize(pkg: RulesetPackage): string {
  return JSON.stringify(pkg, Object.keys(pkg).sort());
}

export function generateSigningKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

export function signRulesetPackage(pkg: RulesetPackage, privateKeyPem: string): SignedRulesetPackage {
  const key = createPrivateKey(privateKeyPem);
  const signature = cryptoSign(null, Buffer.from(canonicalize(pkg)), key).toString("base64");
  return { package: pkg, signature };
}

export function verifyRulesetPackage(signed: SignedRulesetPackage, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return cryptoVerify(null, Buffer.from(canonicalize(signed.package)), key, Buffer.from(signed.signature, "base64"));
  } catch {
    return false;
  }
}
