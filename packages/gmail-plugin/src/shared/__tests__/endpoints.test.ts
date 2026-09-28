/**
 * L1 endpoint-override gate (test-plan E28). See change: add-gmail-plugin.
 */
import { describe, expect, it, vi } from "vitest";
import { GOOGLE_DEFAULTS, resolveGoogleEndpoints } from "../endpoints.js";

describe("E28 — PI_E2E_GOOGLE_BASE_URL gate", () => {
  it.each(["http://127.0.0.1:9999", "http://localhost:9999"])("honours loopback %s", (base) => {
    const warn = vi.fn();
    const ep = resolveGoogleEndpoints({ PI_E2E_GOOGLE_BASE_URL: base }, warn);
    expect(ep).toMatchObject({
      overridden: true,
      authorize: `${base}/o/oauth2/v2/auth`,
      token: `${base}/token`,
      revoke: `${base}/revoke`,
      gmail: `${base}/gmail/v1`,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["https://evil.com", "http://evil.com:80", "https://127.0.0.1:9999", "http://user:pw@127.0.0.1:1"])(
    "ignores %s with a warning that does not echo the value",
    (base) => {
      const warn = vi.fn();
      expect(resolveGoogleEndpoints({ PI_E2E_GOOGLE_BASE_URL: base }, warn)).toBe(GOOGLE_DEFAULTS);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).not.toContain("evil");
    },
  );

  it("unset → Google defaults", () => {
    const ep = resolveGoogleEndpoints({}, vi.fn());
    expect(ep).toBe(GOOGLE_DEFAULTS);
    expect(ep.token).toBe("https://oauth2.googleapis.com/token");
  });
});
