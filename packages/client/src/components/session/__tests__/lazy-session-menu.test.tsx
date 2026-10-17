/**
 * The real code-split wrappers of the session actions flyout (the unit-test
 * shim maps them to the eager components). See change: add-session-actions-flyout.
 */
import { describe, expect, it, vi } from "vitest";

describe("lazy-session-menu (real wrappers)", () => {
  it("maps each loader to its component module", async () => {
    const real = await vi.importActual<typeof import("../lazy-session-menu.js")>("../lazy-session-menu.js");
    const panel = await real.sessionMenuLoaders.SessionActionsPanel();
    const dialogs = await real.sessionMenuLoaders.SessionCardDialogs();
    const { SessionActionsPanel } = await import("../SessionActionsPanel.js");
    const { SessionCardDialogs } = await import("../SessionCardDialogs.js");
    expect(panel.default).toBe(SessionActionsPanel);
    expect(dialogs.default).toBe(SessionCardDialogs);
  });

  it("exposes lazy wrappers and a prefetch that triggers the panel chunk without throwing", async () => {
    const real = await vi.importActual<typeof import("../lazy-session-menu.js")>("../lazy-session-menu.js");
    expect(real.LazySessionActionsPanel).toBeTruthy();
    expect(real.LazySessionCardDialogs).toBeTruthy();
    expect(() => real.prefetchSessionActionsPanel()).not.toThrow();
  });
});
