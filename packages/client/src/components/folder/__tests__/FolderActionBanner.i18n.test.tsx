/**
 * Banner hook-rung copy is localised (change: fix-folder-card-pill-contrast,
 * test-plan #E16). Separate file: the i18n language is a module singleton, so
 * the `hu` switch must not leak into the English banner tests.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WorktreeInitStatus } from "../../../lib/git/git-api.js";
import { initStore } from "../../../lib/git/worktree-init-store.js";
import { I18nProvider, loadCatalog } from "../../../lib/i18n/i18n.js";
import { huCatalog } from "../../../lib/i18n/i18n-hu.js";
import { FolderActionBanner } from "../FolderActionBanner.js";

const CWD = "/a/proj";
const untrusted: WorktreeInitStatus = { hasHook: true, trusted: false };

afterEach(() => {
  cleanup();
  initStore.__resetForTests();
  localStorage.removeItem("pi-dashboard-language");
});

describe("FolderActionBanner — localised rung copy", () => {
  it("E16: hu UI language shows the hu message and label, not the English strings", async () => {
    localStorage.setItem("pi-dashboard-language", "hu");
    await loadCatalog("hu");
    render(
      <I18nProvider>
        <FolderActionBanner cwd={CWD} isProjectRoot status={untrusted} />
      </I18nProvider>,
    );
    const region = screen.getByTestId(`folder-banner-retrust-${CWD}`);
    const btn = screen.getByTestId("worktree-init-btn");
    const msg = huCatalog["folders.bannerRetrust"];
    const action = huCatalog["folders.bannerRetrustAction"];
    expect(msg).toBeTruthy();
    expect(action).toBeTruthy();
    expect(region.textContent).toContain(msg);
    expect(btn.textContent).toBe(action);
    expect(region.textContent).not.toContain("Init hook needs your trust");
    expect(btn.textContent).not.toBe("Review & trust");
  });
});
