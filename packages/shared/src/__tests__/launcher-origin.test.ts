import { describe, expect, it } from "vitest";
import { isLauncherOrigin } from "../launcher-origin.js";

/** test-plan #E10. See change: fix-pairing-approval-credential. */
describe("isLauncherOrigin", () => {
  it.each([
    ["localhost", "8000", 8000],
    ["127.0.0.1", "8000", 8000],
    ["127.255.255.254", "8000", 8000],
    ["[::1]", "8000", 8000],
    ["localhost", "", 80],
    ["LOCALHOST", 8000, 8000],
  ])("accepts %s:%s (cfg %s)", (h, p, cfg) => {
    expect(isLauncherOrigin(h, p, cfg)).toBe(true);
  });

  it.each([
    ["128.0.0.1", "8000", 8000],
    ["localhost.evil.com", "8000", 8000],
    ["localhost", "7999", 8000],
    ["localhost", "8001", 8000],
    ["localhost", "", 8000],
    ["0.0.0.0", "8000", 8000],
    ["[::ffff:127.0.0.1]", "8000", 8000],
  ])("refuses %s:%s (cfg %s)", (h, p, cfg) => {
    expect(isLauncherOrigin(h, p, cfg)).toBe(false);
  });
});
