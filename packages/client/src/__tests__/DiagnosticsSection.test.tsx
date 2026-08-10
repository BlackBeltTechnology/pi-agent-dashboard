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
