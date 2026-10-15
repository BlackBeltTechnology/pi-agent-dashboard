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
  ["truncated PEM (no END)", "x\n-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC", "MIIEvQIBADANBgkqhkiG9w0"],
  ["PGP private key block", "-----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF8abcdefghijk\n-----END PGP PRIVATE KEY BLOCK-----", "lQOYBF8abcdefghijk"],
  ["env MY_API_KEY=", "export MY_API_KEY=abc123zzz run", "abc123zzz"],
  ["env STRIPE_SECRET_KEY=", "STRIPE_SECRET_KEY=whsec9999 run", "whsec9999"],
  ["env DB_PASSWORD=", "DB_PASSWORD=hunter2hunter2 run", "hunter2hunter2"],
  ["env PGPASSWORD=", "PGPASSWORD=pgsecret77 psql", "pgsecret77"],
  ["env GITHUB_TOKEN=", "GITHUB_TOKEN=tok_abcdef123 run", "tok_abcdef123"],
  ["JSON password", '{"password":"jsonpw12345","user":"a"}', "jsonpw12345"],
  ["JSON api_key", '{"api_key": "jsonkey12345"}', "jsonkey12345"],
  ["JSON apiKey camelCase", '{"apiKey":"camelkey12345"}', "camelkey12345"],
  ["JSON authorization", '{"authorization": "Bearer jsonbearer12345"}', "jsonbearer12345"],
  ["Authorization Basic", "Authorization: Basic dXNlcjpwYXNzd29yZA==", "dXNlcjpwYXNzd29yZA"],
  ["client_secret", "client_secret=cs_abcdef12345 x", "cs_abcdef12345"],
  ["aws_secret_access_key", "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG x", "wJalrXUtnFEMI"],
  ["JWT", "t eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkw.SflKxwRJSMeKKF2QT4fw x", "SflKxwRJSMeKKF2QT4fw"],
  ["GitHub ghp_", "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"],
  ["GitHub fine-grained", "github_pat_" + "11ABCDEFG0abcdefghij_klmnopqrstuvwxyz0123456789", "11ABCDEFG0abcdefghij"],
  ["Slack token", "xoxb-1234567890-abcdefghij", "1234567890-abcdefghij"],
  ["Google API key", "AIza" + "SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q", "SyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q"],
  ["Stripe key", "sk_live_" + "abcdefghijklmnopqrstuvwx", "abcdefghijklmnopqrstuvwx"],
  ["npm token", "npm_" + "abcdefghijklmnopqrstuvwxyz0123456789", "abcdefghijklmnopqrstuvwxyz0123456789"],
  ["URL credentials", "git clone https://bob:s3cr3tpw@example.com/r.git", "s3cr3tpw"],
  ["token query param", "GET /cb?access_token=abc123def456&x=1", "abc123def456"],
  ["key query param", "https://x.test/a?v=1&key=qkey12345", "qkey12345"],
  ["sig query param", "https://x.test/a?sig=sigvalue999", "sigvalue999"],
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

  it("URL credentials keep scheme/user/host, drop only the password", () => {
    expect(redactSecrets("https://bob:s3cr3tpw@example.com/r.git")).toBe("https://bob:[REDACTED]@example.com/r.git");
  });

  it("token query param keeps the parameter name", () => {
    expect(redactSecrets("/cb?access_token=abc123def456&x=1")).toBe("/cb?access_token=[REDACTED]&x=1");
  });

  it("does not redact lookalike prose", () => {
    const text = "The token budget and the secret sauce; see https://example.com/a?b=1 and key idea.";
    expect(redactSecrets(text)).toBe(text);
  });

  it("is idempotent over the new patterns", () => {
    const once = redactSecrets('{"password":"x1y2z3"} MY_API_KEY=abc https://b:pw@h/ /a?token=zz ghp_' + "a".repeat(36));
    expect(redactSecrets(once)).toBe(once);
  });

  describe("linear time on adversarial input", () => {
    const MB = 1_000_000;
    const timed = (input: string): number => {
      const t0 = performance.now();
      redactSecrets(input);
      return performance.now() - t0;
    };
    it("1 MB of unclosed BEGIN headers redacts < 200 ms", () => {
      const input = "-----BEGIN RSA PRIVATE KEY-----\n".repeat(Math.ceil(MB / 32));
      expect(timed(input)).toBeLessThan(200);
    });
    it("1 MB of BEGIN-without-KEY headers redacts < 200 ms", () => {
      expect(timed("-----BEGIN A B C ".repeat(Math.ceil(MB / 17)))).toBeLessThan(200);
    });
    it.each([
      ["env-style underscore run", "A_".repeat(MB / 2)],
      ["JWT-like run", "eyJ_".repeat(MB / 4)],
      ["URL-scheme run", "a.".repeat(MB / 2)],
      ["scheme with userinfo, no @", "http://u:".repeat(MB / 9)],
      ["key= with no value", "password=".repeat(MB / 9)],
      ["spaces", " ".repeat(MB)],
    ])("%s redacts < 200 ms", (_n, input) => {
      expect(timed(input)).toBeLessThan(200);
    });
  });
});
