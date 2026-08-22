/**
 * Tests for `<DiagnosticsSection />`.
 * See change: doctor-rich-output (task 5.7).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, act, waitFor } from "@testing-library/react";
// Stub MarkdownContent — it pulls ThemeContext that we don't need to wire here.
vi.mock("../components/preview/MarkdownContent.js", () => ({
  MarkdownContent: ({ content }: { content: string }) => content,
}));
import { DiagnosticsSection } from "../components/settings/DiagnosticsSection.js";
import { DoctorFetchError } from "../lib/api/doctor-api.js";
import type { DoctorReport } from "../lib/api/doctor-api.js";
import type { AutoNameOutcomeRow } from "../lib/api/auto-name-outcomes-api.js";

afterEach(() => cleanup());

function mkReport(overrides: Partial<DoctorReport> = {}): DoctorReport {
  return {
    checks: [
      { name: "Electron", section: "runtime", status: "ok", message: "v40" },
      {
        name: "pi CLI",
        section: "pi-tooling",
        status: "error",
        message: "Not found",
        detail: "PATH searched",
        suggestion: "Run setup wizard.",
      },
      {
        name: "API key",
        section: "setup",
        status: "warning",
        message: "Not configured",
        detail: "No key found",
        suggestion: "Configure in Settings.",
      },
    ],
    summary: { ok: 1, warnings: 1, errors: 1 },
    generatedAt: 1700000000000,
    ...overrides,
  };
}

describe("DiagnosticsSection", () => {
  it("renders sections in fixed order, omitting empty sections", async () => {
    const fetcher = vi.fn().mockResolvedValue(mkReport());
    const { container, queryByTestId } = render(<DiagnosticsSection fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    await waitFor(() => expect(queryByTestId("diagnostics-section-runtime")).not.toBeNull());

    // Order: runtime → pi-tooling → setup. (server + diagnostics absent.)
    const html = container.innerHTML;
    const r = html.indexOf("Runtime");
    const p = html.indexOf("PI Tooling");
    const s = html.indexOf("Setup");
    expect(r).toBeGreaterThan(-1);
    expect(p).toBeGreaterThan(r);
    expect(s).toBeGreaterThan(p);
    // No empty sections.
    expect(queryByTestId("diagnostics-section-server")).toBeNull();
    expect(queryByTestId("diagnostics-section-diagnostics")).toBeNull();
  });

  it("re-run refetches and disables the button while in flight", async () => {
    let resolveSecond: ((r: DoctorReport) => void) | null = null;
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(mkReport())
      .mockImplementationOnce(() => new Promise<DoctorReport>((resolve) => { resolveSecond = resolve; }));

    const { getByTestId } = render(<DiagnosticsSection fetcher={fetcher} />);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    const btn = getByTestId("diagnostics-rerun") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    // While the second fetch is pending, button is disabled and shows "Running…".
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toMatch(/Running/);

    await act(async () => {
      resolveSecond?.(mkReport());
    });
    await waitFor(() => expect((getByTestId("diagnostics-rerun") as HTMLButtonElement).disabled).toBe(false));
  });

  it("renders an inline error block on fetch failure with [Re-run] enabled", async () => {
    const fetcher = vi.fn().mockRejectedValue(new DoctorFetchError("HTTP 500", 500, "internal-error-body"));
    const { findByTestId, getByTestId } = render(<DiagnosticsSection fetcher={fetcher} />);
    const errBlock = await findByTestId("diagnostics-error");
    expect(errBlock.textContent).toContain("HTTP 500");
    expect(errBlock.textContent).toContain("internal-error-body");
    const rerun = getByTestId("diagnostics-rerun") as HTMLButtonElement;
    expect(rerun.disabled).toBe(false);
  });

  it("falls back to textarea modal when navigator.clipboard.writeText rejects", async () => {
    const fetcher = vi.fn().mockResolvedValue(mkReport());
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { findByTestId, queryByTestId } = render(<DiagnosticsSection fetcher={fetcher} />);
    const copyBtn = (await findByTestId("diagnostics-copy-md")) as HTMLButtonElement;
    fireEvent.click(copyBtn);
    const modal = await waitFor(() => {
      const m = queryByTestId("diagnostics-copy-modal");
      if (!m) throw new Error("modal not yet rendered");
      return m;
    });
    expect(modal.textContent).toMatch(/clipboard access/);
    // Escape dismisses.
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(queryByTestId("diagnostics-copy-modal")).toBeNull());
  });

  it("happy-path copy uses navigator.clipboard.writeText", async () => {
    const fetcher = vi.fn().mockResolvedValue(mkReport());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const { findByTestId } = render(<DiagnosticsSection fetcher={fetcher} />);
    const copyBtn = (await findByTestId("diagnostics-copy-plain")) as HTMLButtonElement;
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toContain("PI Dashboard Doctor");
  });
});

/**
 * Auto-naming diagnostics readout.
 *
 * Automatic naming could stop a session permanently while emitting nothing an
 * operator could find: the toast reaches only a subscribed client, and the log
 * line only the server host. This readout is the discoverable surface.
 *
 * See change: fix-auto-naming-reasoning-model (design D9, test-plan #F7–#F9).
 */
describe("DiagnosticsSection — auto-naming outcomes", () => {
  const row = (over: Partial<AutoNameOutcomeRow> = {}): AutoNameOutcomeRow => ({
    sessionId: "abcdef12-3456-7890-abcd-ef1234567890",
    outcome: "waiting",
    reason: "no nameable topic yet",
    at: 1700000000000,
    ...over,
  });

  it("F7: renders the outcome and its reason for a session", async () => {
    const { findByTestId } = render(
      <DiagnosticsSection
        fetcher={async () => mkReport()}
        autoNameFetcher={async () => [row()]}
      />,
    );
    const li = await findByTestId(`auto-name-outcome-${row().sessionId}`);
    expect(li.textContent).toContain("no nameable topic yet");
    expect(li.getAttribute("data-outcome")).toBe("waiting");
  });

  it("F8: renders an outcome retained BEFORE the surface mounted", async () => {
    // The row comes from the fetch, not from a live broadcast — a stop
    // reported while no client was connected must still be visible.
    const autoNameFetcher = vi.fn(async () => [row({ outcome: "stopped", reason: "budget exhausted" })]);
    const { findByTestId } = render(
      <DiagnosticsSection fetcher={async () => mkReport()} autoNameFetcher={autoNameFetcher} />,
    );
    await findByTestId("auto-naming-diagnostics");
    expect(autoNameFetcher).toHaveBeenCalled();
    const li = await findByTestId(`auto-name-outcome-${row().sessionId}`);
    expect(li.textContent).toContain("budget exhausted");
  });

  it("F9: `starved` is presented distinctly from `waiting` and conveys truncation", async () => {
    const starvedId = "11111111-2222-3333-4444-555555555555";
    const { findByTestId } = render(
      <DiagnosticsSection
        fetcher={async () => mkReport()}
        autoNameFetcher={async () => [
          row(),
          row({ sessionId: starvedId, outcome: "starved", reason: "output cap reached" }),
        ]}
      />,
    );
    const starved = await findByTestId(`auto-name-outcome-label-${starvedId}`);
    const waiting = await findByTestId(`auto-name-outcome-label-${row().sessionId}`);
    expect(starved.textContent).not.toBe(waiting.textContent);
    expect(starved.textContent).toMatch(/truncat|output cap/i);
  });

  it("renders nothing when no outcomes are retained", async () => {
    const { queryByTestId, findByTestId } = render(
      <DiagnosticsSection fetcher={async () => mkReport()} autoNameFetcher={async () => []} />,
    );
    await findByTestId("diagnostics-rerun");
    expect(queryByTestId("auto-naming-diagnostics")).toBeNull();
  });

  it("still renders the doctor report when the outcomes fetch fails", async () => {
    const { findByTestId, queryByTestId } = render(
      <DiagnosticsSection
        fetcher={async () => mkReport()}
        autoNameFetcher={async () => { throw new Error("HTTP 500"); }}
      />,
    );
    await findByTestId("diagnostics-rerun");
    expect(queryByTestId("auto-naming-diagnostics")).toBeNull();
  });
});
