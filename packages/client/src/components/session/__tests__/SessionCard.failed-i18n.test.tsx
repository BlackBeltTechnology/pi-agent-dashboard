/**
 * The card's `Failed` label reuses `common.failed` and is localised
 * (change: fix-ui-status-indicators, test-plan #S13). Separate file: the i18n
 * language is a module singleton, so the locale switch must not leak into the
 * English card tests.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadCatalog } from "../../../lib/i18n/i18n.js";
import { huCatalog } from "../../../lib/i18n/i18n-hu.js";
import { zhCNCatalog } from "../../../lib/i18n/i18n-zh-CN.js";
import { ThemeProvider } from "../../settings/ThemeProvider.js";
import { SessionCard } from "../SessionCard.js";

vi.mock("../../../hooks/useMobile.js", () => ({
  useMobile: vi.fn(() => false),
}));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

afterEach(() => {
  cleanup();
  localStorage.removeItem("pi-dashboard-language");
});

const session: DashboardSession = {
  id: "failed-i18n-1",
  cwd: "/home/user/project",
  source: "tui",
  status: "idle",
  startedAt: Date.now() - 60_000,
  tokensIn: 0,
  tokensOut: 0,
  cost: 0,
};

describe("SessionCard — localised Failed label", () => {
  it.each([
    ["hu", huCatalog],
    ["zh-CN", zhCNCatalog],
  ] as const)("%s shows the catalog common.failed, not the English fallback", async (lang, catalog) => {
    localStorage.setItem("pi-dashboard-language", lang);
    await loadCatalog(lang);
    render(
      <I18nProvider>
        <ThemeProvider>
          <SessionCard session={session} selectedId={undefined} onSelect={() => {}} now={Date.now()} showGitInfo={false} isHidden={false} onArchive={() => {}} hasError />
        </ThemeProvider>
      </I18nProvider>,
    );
    const label = catalog["common.failed"];
    expect(label).toBeTruthy();
    expect(label).not.toBe("Failed");
    const meta = screen.getByTestId("session-card-meta");
    expect(meta.textContent).toContain(label);
    expect(meta.textContent).not.toContain("Failed");
  });
});
