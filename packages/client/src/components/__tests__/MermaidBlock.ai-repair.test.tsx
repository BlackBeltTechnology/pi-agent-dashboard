/**
 * MermaidBlock "Fix with AI" — gating, states, accept-only-if-renders, cache
 * (test-plan #F1–#F9, #E15, #E16, #X8, #X9, #X10).
 * See change: add-mermaid-ai-repair.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type React from "react";
import { useEffect } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "../../lib/i18n/i18n.js";
import { setMermaidRepairClientConfig } from "../../lib/preview/mermaid-repair-config.js";
import { ThemeProvider, useThemeContext } from "../settings/ThemeProvider.js";

const mockRender = vi.hoisted(() => vi.fn());
vi.mock("mermaid", () => ({ default: { initialize: vi.fn(), render: mockRender } }));

import { _aiFixCache, _outcomeCache, MermaidBlock } from "../preview/MermaidBlock.js";

const SVG = '<svg viewBox="0 0 1000 400"><text>fixed</text></svg>';
const BAD = "unknownDiagram\nA-->B"; // no repair rule applies → error outcome
const BAD2 = "unknownDiagram\nC-->D";
const FIXED = "graph TD\nA-->B";
const MODEL = "anthropic/m";

function renderBlock(ui: React.ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>);
}

function okResponse(code = FIXED, model = MODEL) {
  return { ok: true, status: 200, json: async () => ({ success: true, data: { code, model } }) };
}
function errResponse(status: number, code: string, error: string) {
  return { ok: false, status, json: async () => ({ success: false, code, error }) };
}

let fetchMock: ReturnType<typeof vi.fn>;
const fixButton = () => screen.queryByRole("button", { name: /fix with ai/i });
const aiBadge = (c: HTMLElement) => c.querySelector('[data-testid="mermaid-ai-badge"]');

async function mountError(code = BAD) {
  const utils = renderBlock(<MermaidBlock code={code} />);
  await waitFor(() => expect(utils.container.textContent).toMatch(/could not be rendered/i));
  return utils;
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  _outcomeCache.clear();
  _aiFixCache.clear();
  localStorage.clear();
  setMermaidRepairClientConfig({ enabled: true, model: MODEL });
  mockRender.mockImplementation(async (_id: string, code: string) => {
    if (code.startsWith("unknownDiagram")) throw new Error("Parse error E1");
    return { svg: SVG };
  });
  fetchMock = vi.fn().mockResolvedValue(okResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  setMermaidRepairClientConfig(undefined);
  vi.unstubAllGlobals();
});

describe("gating (F1–F3)", () => {
  it("F1: action only when enabled AND the diagram failed after rule repair", async () => {
    // disabled + error
    setMermaidRepairClientConfig(undefined);
    const a = await mountError();
    expect(fixButton()).toBeNull();
    a.unmount();
    // enabled + error
    setMermaidRepairClientConfig({ enabled: true, model: MODEL });
    _outcomeCache.clear();
    const b = await mountError();
    expect(fixButton()).not.toBeNull();
    b.unmount();
    // enabled + ok
    const c = renderBlock(<MermaidBlock code={FIXED} />);
    await waitFor(() => expect(c.container.querySelector(".mermaid-diagram svg")).not.toBeNull());
    expect(fixButton()).toBeNull();
    c.unmount();
    // enabled + rule-repaired
    mockRender.mockRejectedValueOnce(new Error("E1")).mockResolvedValueOnce({ svg: SVG });
    const d = renderBlock(<MermaidBlock code={"graph TD\nA -->|(x)| B"} />);
    await waitFor(() => expect(d.container.querySelector('[data-testid="mermaid-repair-badge"]')).not.toBeNull());
    expect(fixButton()).toBeNull();
  });

  it("F2: nothing is requested without a click", async () => {
    await mountError();
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("F3: real <button> with an accessible name and a provider-disclosure description", async () => {
    await mountError();
    const btn = fixButton() as HTMLButtonElement;
    expect(btn.tagName).toBe("BUTTON");
    const descId = btn.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    const desc = document.getElementById(descId as string)!;
    expect(desc.textContent).toMatch(/sent to/i);
    expect(desc.textContent).toContain(MODEL);
  });
});

describe("flow (F4–F9, X8, X9)", () => {
  it("F4: pending disables the action; a second click does not refetch", async () => {
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockReturnValue(new Promise((r) => (resolveFetch = r)));
    await mountError();
    fireEvent.click(fixButton()!);
    const pending = await screen.findByRole("button", { name: /fixing with ai/i });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(pending);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => resolveFetch(okResponse()));
  });

  it("F5: renderable result → SVG, AI-fixed badge naming the model, show-original + copy-fixed", async () => {
    const { container } = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(container)).not.toBeNull());
    expect(container.querySelector(".mermaid-diagram svg")).not.toBeNull();
    expect(aiBadge(container)!.textContent).toMatch(/AI-fixed/);
    expect(aiBadge(container)!.textContent).toContain(MODEL);
    expect(container.querySelector('[data-testid="mermaid-repair-badge"]')).toBeNull();
    expect(screen.getByRole("button", { name: /show original/i })).toBeTruthy();
    expect(container.querySelector('[data-testid="mermaid-copy-fixed"]')).not.toBeNull();
    expect(fixButton()).toBeNull();
  });

  it("F6: show original reveals original source + error, hides the viewport; copy-fixed copies the fix", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { container } = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(container)).not.toBeNull());
    const toggle = screen.getByRole("button", { name: /show original/i });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("pre code")!.textContent).toBe(BAD);
    expect(container.textContent).toMatch(/original render error.*Parse error E1/i);
    expect(container.querySelector(".mermaid-diagram-inner")!.parentElement!.hasAttribute("hidden")).toBe(true);
    await act(async () => {
      fireEvent.click(container.querySelector('[data-testid="mermaid-copy-fixed"]')!);
    });
    expect(writeText).toHaveBeenCalledWith(FIXED);
  });

  it("F7: a different failing source discards the AI result without a new request", async () => {
    const utils = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(utils.container)).not.toBeNull());
    utils.rerender(
      <ThemeProvider>
        <MermaidBlock code={BAD2} />
      </ThemeProvider>,
    );
    await waitFor(() => expect(fixButton()).not.toBeNull());
    expect(aiBadge(utils.container)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("F8: a theme change re-renders the fixed source, no new request, original view closed", async () => {
    let setTheme!: (t: "light" | "dark") => void;
    function Probe() {
      setTheme = useThemeContext().setPreference as typeof setTheme;
      return null;
    }
    const { container } = renderBlock(
      <>
        <Probe />
        <MermaidBlock code={BAD} />
      </>,
    );
    await waitFor(() => expect(container.textContent).toMatch(/could not be rendered/i));
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(container)).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /show original/i }));
    const before = mockRender.mock.calls.length;
    await act(async () => setTheme("light")); // jsdom matchMedia reports dark by default
    await waitFor(() => expect(mockRender.mock.calls.length).toBeGreaterThan(before));
    expect(mockRender.mock.calls.slice(before).some(([, code]) => code === FIXED)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(aiBadge(container)).not.toBeNull());
    expect(screen.getByRole("button", { name: /show original/i }).getAttribute("aria-pressed")).toBe("false");
  });

  it("F9: unmount aborts the request and caches nothing", async () => {
    let signal: AbortSignal | undefined;
    let resolveFetch!: (v: unknown) => void;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      return new Promise((r) => (resolveFetch = r));
    });
    const { unmount } = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal!.aborted).toBe(true);
    await act(async () => resolveFetch(okResponse()));
    expect(_aiFixCache.size).toBe(0);
  });

  it("E15: remount reuses the AI result without a new request", async () => {
    const first = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(first.container)).not.toBeNull());
    first.unmount();
    const second = renderBlock(<MermaidBlock code={BAD} />);
    await waitFor(() => expect(aiBadge(second.container)).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("E16: failures are not cached — a remount retries and succeeds", async () => {
    fetchMock.mockResolvedValueOnce(errResponse(502, "provider_error", "Provider down"));
    const first = await mountError();
    fireEvent.click(fixButton()!);
    await screen.findByText(/AI fix failed/i);
    first.unmount();
    const second = await mountError();
    fireEvent.click(fixButton()!);
    await waitFor(() => expect(aiBadge(second.container)).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("X8: a non-renderable AI result keeps the original error and offers retry", async () => {
    fetchMock.mockResolvedValue(okResponse("unknownDiagram\nstill-broken"));
    const { container } = await mountError();
    fireEvent.click(fixButton()!);
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/AI fix failed/i);
    expect(container.textContent).toContain("Parse error E1");
    expect(container.querySelector(".mermaid-diagram svg")).toBeNull();
    expect(aiBadge(container)).toBeNull();
    const retry = screen.getByRole("button", { name: /retry ai fix/i }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    expect(_aiFixCache.size).toBe(0);
  });

  it("X9: endpoint error surfaces its reason; retry issues a second request", async () => {
    fetchMock.mockResolvedValue(errResponse(504, "timeout", "Model timed out"));
    const { container } = await mountError();
    fireEvent.click(fixButton()!);
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/AI fix failed.*Model timed out/i);
    expect(container.textContent).toContain("Parse error E1");
    fireEvent.click(screen.getByRole("button", { name: /retry ai fix/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

describe("i18n (X10) — catalog parity lives in __tests__/i18n.test.ts", () => {
  it("the Hungarian UI shows the Hungarian action text", async () => {
    // The block is mounted only once the hu catalog is active (it uses the standalone t()).
    function Lang() {
      const { language, setLanguage } = useI18n();
      useEffect(() => setLanguage("hu"), [setLanguage]);
      return language === "hu" ? <MermaidBlock code={BAD} /> : null;
    }
    renderBlock(
      <I18nProvider>
        <Lang />
      </I18nProvider>,
    );
    const huFix = "Javítás MI-vel";
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: huFix })).toBeTruthy());
    } finally {
      await act(async () => {});
    }
  });
});
