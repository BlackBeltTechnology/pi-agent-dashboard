/**
 * Tests for the migrated SpawnErrorBanner (change: redesign-directory-card).
 * It now renders via the shared `InlineMessage` primitive; stderr renders in a
 * `LogBlock` (collapsible, closed by default); the timeout case is an
 * `InlineMessage severity="warning"` (no separate `TimeoutBanner` component).
 * Test ids `spawn-error-banner`, `spawn-timeout-banner`, `spawn-error-dismiss`
 * are preserved.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpawnErrorDetail } from "../../hooks/useMessageHandler.js";
import { I18nProvider, loadCatalog } from "../../lib/i18n/i18n.js";
import { SpawnErrorBanner } from "../session/SpawnErrorBanner.js";

afterEach(() => cleanup());

describe("SpawnErrorBanner (InlineMessage migration)", () => {
  it("renders an error surface with the code hint and preserves spawn-error-banner id", () => {
    const detail: SpawnErrorDetail = { kind: "error", message: "boom", code: "PI_NOT_FOUND" };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} />);
    const el = getByTestId("spawn-error-banner");
    expect(el).toBeTruthy();
    expect(el.textContent).toContain("Pi binary not found.");
    // Severity tokens, not raw literals.
    expect(el.outerHTML).toContain("--severity-error");
    expect(el.outerHTML).not.toMatch(/\bred-500\b/);
  });

  it("renders stderr inside a collapsible LogBlock (closed by default), not <details>", () => {
    const detail: SpawnErrorDetail = { kind: "error", message: "crash", code: "PI_CRASHED", stderr: "Error: nope" };
    const { getByTestId, queryByTestId } = render(<SpawnErrorBanner detail={detail} />);
    expect(getByTestId("log-block")).toBeTruthy();
    // Collapsed by default → no body until toggled.
    expect(queryByTestId("log-block-body")).toBeNull();
    fireEvent.click(getByTestId("log-block-toggle"));
    expect(getByTestId("log-block-body").textContent).toContain("Error: nope");
  });

  it("timeout renders as a warning InlineMessage under spawn-timeout-banner id", () => {
    const detail: SpawnErrorDetail = { kind: "timeout", message: "", pid: 4242, timeoutMs: 30000 };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} />);
    const el = getByTestId("spawn-timeout-banner");
    expect(el).toBeTruthy();
    expect(el.outerHTML).toContain("--severity-warning");
    expect(el.outerHTML).not.toMatch(/\bamber-500\b/);
    expect(el.textContent).toMatch(/4242/);
  });

  it("dismiss fires onDismiss only", () => {
    const onDismiss = vi.fn();
    const detail: SpawnErrorDetail = { kind: "error", message: "boom" };
    const { getByTestId } = render(<SpawnErrorBanner detail={detail} onDismiss={onDismiss} />);
    fireEvent.click(getByTestId("spawn-error-dismiss"));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});

/** See change: fix-session-bridge-registration (test-plan E26-E29). */
describe("SpawnErrorBanner — terminated timeout wording", () => {
  const timeout = (extra: Partial<SpawnErrorDetail>): SpawnErrorDetail => ({ kind: "timeout", message: "", ...extra });
  const text = (detail: SpawnErrorDetail) =>
    render(<SpawnErrorBanner detail={detail} />).getByTestId("spawn-timeout-banner").textContent ?? "";

  it("E26: terminated:true renders the exact terminated sentence, with and without a PID", () => {
    expect(text(timeout({ pid: 123, timeoutMs: 30000, terminated: true }))).toContain(
      "Pi started (PID 123) but never connected to the dashboard within 30s and was terminated.",
    );
    cleanup();
    expect(text(timeout({ timeoutMs: 30000, terminated: true }))).toContain(
      "Pi started but never connected to the dashboard within 30s and was terminated.",
    );
  });

  it.each([undefined, false])("E27: terminated=%s keeps the never-connected text with no termination clause", (terminated) => {
    const withPid = text(timeout({ pid: 123, timeoutMs: 30000, terminated }));
    expect(withPid).toContain("Pi started (PID 123) but never connected to the dashboard within 30s.");
    expect(withPid).not.toMatch(/terminated/);
    cleanup();
    const noPid = text(timeout({ timeoutMs: 30000, terminated }));
    expect(noPid).toContain("Pi started but never connected to the dashboard within 30s.");
    expect(noPid).not.toMatch(/terminated/);
  });

  it("E27: testid and warning severity are unchanged when terminated", () => {
    const { getByTestId } = render(<SpawnErrorBanner detail={timeout({ pid: 1, terminated: true })} />);
    expect(getByTestId("spawn-timeout-banner").outerHTML).toContain("--severity-warning");
  });

  it("E28: renders only the single PID (never terminatedPids) and seconds without trailing zeros", () => {
    const cases: Array<[number, string]> = [[5000, "5s"], [7500, "7.5s"], [45000, "45s"], [120000, "120s"]];
    for (const [timeoutMs, secs] of cases) {
      const out = text(timeout({ pid: 4242, timeoutMs, terminated: true, terminatedPids: [4242, 4243] }));
      expect(out).toContain("PID 4242");
      expect(out).not.toContain("4243");
      expect(out).toContain(`within ${secs} and was terminated.`);
      cleanup();
    }
  });

  it("E29: renders per locale (hu, zh-CN) and falls back to the code default for a missing key", async () => {
    try {
      for (const [lang, marker] of [["hu", "le lett állítva"], ["zh-CN", "终止"]] as const) {
        await loadCatalog(lang);
        window.localStorage.setItem("pi-dashboard-language", lang);
        const out = render(
          <I18nProvider>
            <SpawnErrorBanner detail={timeout({ pid: 9, timeoutMs: 30000, terminated: true })} />
          </I18nProvider>,
        ).getByTestId("spawn-timeout-banner").textContent ?? "";
        expect(out, lang).toContain(marker);
        expect(out, lang).not.toContain("{pid}");
        expect(out, lang).not.toContain("{secs}");
        cleanup();
      }
      // en: dictionary carries no core catalog, so the code default renders.
      window.localStorage.setItem("pi-dashboard-language", "en");
      const en = render(
        <I18nProvider>
          <SpawnErrorBanner detail={timeout({ timeoutMs: 30000, terminated: true })} />
        </I18nProvider>,
      ).getByTestId("spawn-timeout-banner").textContent ?? "";
      expect(en).toContain("and was terminated.");
    } finally {
      window.localStorage.removeItem("pi-dashboard-language");
    }
  });
});
