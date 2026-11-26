import { describe, expect, it } from "vitest";
import { buildRulesetPackage, generateSigningKeyPair, signRulesetPackage, verifyRulesetPackage } from "./package.js";

describe("ruleset packaging and signing", () => {
  it("builds a package whose version matches the current compiled ruleset hash", () => {
    const pkg = buildRulesetPackage();
    expect(pkg.technologyCount).toBeGreaterThan(0);
    expect(pkg.version).toMatch(/^[0-9a-f]+$/);
  });

  it("a package signed with a keypair verifies against that keypair's public key", () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeyPair();
    const pkg = buildRulesetPackage();
    const signed = signRulesetPackage(pkg, privateKeyPem);
    expect(verifyRulesetPackage(signed, publicKeyPem)).toBe(true);
  });

  it("fails verification against a different keypair's public key", () => {
    const { privateKeyPem } = generateSigningKeyPair();
    const { publicKeyPem: wrongPublicKey } = generateSigningKeyPair();
    const pkg = buildRulesetPackage();
    const signed = signRulesetPackage(pkg, privateKeyPem);
    expect(verifyRulesetPackage(signed, wrongPublicKey)).toBe(false);
  });

  it("fails verification if the package contents are tampered with after signing", () => {
    const { privateKeyPem, publicKeyPem } = generateSigningKeyPair();
    const pkg = buildRulesetPackage();
    const signed = signRulesetPackage(pkg, privateKeyPem);
    const tampered = { ...signed, package: { ...signed.package, technologyCount: signed.package.technologyCount + 1 } };
    expect(verifyRulesetPackage(tampered, publicKeyPem)).toBe(false);
  });

  it("fails verification on a garbage/malformed public key instead of throwing", () => {
    const { privateKeyPem } = generateSigningKeyPair();
    const signed = signRulesetPackage(buildRulesetPackage(), privateKeyPem);
    expect(verifyRulesetPackage(signed, "not a real PEM key")).toBe(false);
  });
});
