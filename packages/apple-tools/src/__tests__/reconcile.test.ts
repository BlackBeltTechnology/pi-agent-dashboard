/**
 * #E33 / 7.T1 — reconciliation guard: write-back fires only on unset/default,
 * never over an explicit operator override.
 * See change: add-apple-tools-imcp-plugin.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_IMCP_PATH, shouldReconcilePath } from "../reconcile.js";

const USER_LOCAL = "/Users/me/Applications/iMCP.app/Contents/MacOS/imcp-server";

describe("shouldReconcilePath", () => {
  it("#E33: explicit override + different discovered path → left unmodified", () => {
    expect(shouldReconcilePath("/opt/custom/imcp-server", USER_LOCAL)).toBe(false);
  });

  it("unset config + discovered non-default → reconcile", () => {
    expect(shouldReconcilePath(undefined, USER_LOCAL)).toBe(true);
    expect(shouldReconcilePath("", USER_LOCAL)).toBe(true);
  });

  it("still-at-default config + discovered non-default → reconcile", () => {
    expect(shouldReconcilePath(DEFAULT_IMCP_PATH, USER_LOCAL)).toBe(true);
  });

  it("no discovery → never reconcile", () => {
    expect(shouldReconcilePath(undefined, null)).toBe(false);
  });

  it("discovered equals configured → no-op", () => {
    expect(shouldReconcilePath(USER_LOCAL, USER_LOCAL)).toBe(false);
  });
});
