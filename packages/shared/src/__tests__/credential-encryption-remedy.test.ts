/**
 * Reason → remedy table of credential-at-rest encryption (decision G3).
 * See change: encrypt-credentials-at-rest (test-plan E96).
 */
import { describe, expect, it } from "vitest";
import {
  CREDENTIAL_LOCK_REASONS,
  CREDENTIAL_REASON_REMEDY,
  credentialRemedy,
  DATA_KEY_FILE_ENV,
} from "../credential-encryption.js";

describe("E96: lock remedy table", () => {
  it("every reason has a non-empty remedy", () => {
    for (const reason of CREDENTIAL_LOCK_REASONS) {
      expect(CREDENTIAL_REASON_REMEDY[reason], reason).toBeTruthy();
      expect(credentialRemedy(reason).length, reason).toBeGreaterThan(0);
    }
  });

  it("key_missing and key_mismatch name the vault reset command", () => {
    for (const reason of ["key_missing", "key_mismatch"] as const) {
      expect(credentialRemedy(reason), reason).toContain("pi-dashboard credentials reset --vault");
    }
  });

  it("keychain_* and key_file_* reasons name the key-file env var", () => {
    const reasons = CREDENTIAL_LOCK_REASONS.filter((r) => r.startsWith("keychain_") || r.startsWith("key_file_"));
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(credentialRemedy(reason), reason).toContain(DATA_KEY_FILE_ENV);
    }
  });

  it("no remedy contains a key-like 43-char base64 token", () => {
    for (const reason of CREDENTIAL_LOCK_REASONS) {
      expect(credentialRemedy(reason), reason).not.toMatch(/[A-Za-z0-9+/_-]{43}=?/);
    }
  });

  it("an unknown reason gets the generic fallback", () => {
    expect(credentialRemedy("x_new")).toMatch(/locked/i);
  });
});
