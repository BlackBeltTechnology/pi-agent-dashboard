/**
 * REDACTION_PATTERNS_V1 / redactSecrets — one sample per pattern (test-plan E15, shared part).
 * See change: add-pending-question-stack.
 */
import { describe, expect, it } from "vitest";
import { REDACTION_PATTERNS_V1, REDACTION_VERSION, redactSecrets } from "../redaction.js";

const SAMPLES: Array<[string, string, string]> = [
  ["Authorization Bearer", "curl -H 'Authorization: Bearer abc123.def-456' x", "abc123.def-456"],
  ["bare Bearer", "token is Bearer eyJhbGciOiJIUzI1NiJ9.payload", "eyJhbGciOiJIUzI1NiJ9"],
  ["sk- key", "use sk-abcdefghijklmnop1234 here", "sk-abcdefghijklmnop1234"],
  ["api_key=", "config api_key=SUPERSECRET123 end", "SUPERSECRET123"],
  ["access-key:", "access-key: hunter2value", "hunter2value"],
  ["secret_key=", "secretKey=zzz999 end", "zzz999"],
  ["password=", "db password=p@ssw0rd! next", "p@ssw0rd!"],
  [
    "PEM private key",
    "x\n-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END RSA PRIVATE KEY-----\ny",
    "MIIBOgIBAAJBAKj34",
  ],
  ["AWS access key id", "id AKIAIOSFODNN7EXAMPLE used", "AKIAIOSFODNN7EXAMPLE"],
];

describe("redactSecrets", () => {
  it("is version 1 with a pattern set", () => {
    expect(REDACTION_VERSION).toBe(1);
    expect(REDACTION_PATTERNS_V1.length).toBeGreaterThanOrEqual(6);
  });

  for (const [name, input, secret] of SAMPLES) {
    it(`redacts ${name}`, () => {
      const out = redactSecrets(input);
      expect(out).not.toContain(secret);
      expect(out).toContain("[REDACTED]");
    });
  }

  it("leaves ordinary text untouched and is idempotent", () => {
    const text = "Resume or hand back? The key idea is simple.";
    expect(redactSecrets(text)).toBe(text);
    const once = redactSecrets("password=abc sk-abcdefghijklmnop1234");
    expect(redactSecrets(once)).toBe(once);
  });

  it("is stable across repeated calls (no global-regex lastIndex leak)", () => {
    const a = redactSecrets("AKIAIOSFODNN7EXAMPLE");
    const b = redactSecrets("AKIAIOSFODNN7EXAMPLE");
    expect(a).toBe(b);
  });
});
