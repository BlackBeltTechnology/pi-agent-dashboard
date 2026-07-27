import type { GrammarCheckResult, GrammarHealth } from "@blackbelt-technology/pi-dashboard-shared/grammar-types.js";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGrammarCheck } from "../useGrammarCheck.js";

const HEALTH: GrammarHealth = {
  enabled: true,
  backend: "languagetool",
  autoCheck: true,
  debounceMs: 20,
  minChars: 5,
  language: "auto",
};

const RESULT: GrammarCheckResult = {
  backend: "languagetool",
  correctedText: "I have an apple",
  suggestions: [
    { id: "2:3:0", offset: 2, length: 3, original: "has", replacement: "have", kind: "grammar", message: "Agreement" },
    { id: "8:5:1", offset: 8, length: 5, original: "a apple", replacement: "an apple", kind: "grammar", message: "Article" },
  ],
  summary: "2 grammar",
  language: "en-US",
  truncated: false,
};

function installFetch(over: { health?: Partial<GrammarHealth>; result?: GrammarCheckResult } = {}) {
  const calls: string[] = [];
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("/api/grammar/health")) {
      return new Response(JSON.stringify({ success: true, data: { ...HEALTH, ...over.health } }), { status: 200 });
    }
    return new Response(JSON.stringify({ success: true, data: over.result ?? RESULT }), { status: 200 });
  }) as any;
  return { calls, checkCalls: () => calls.filter((u) => u.includes("/api/grammar/check")) };
}

function render(props: { draft: string; sessionStatus?: "idle" | "streaming" | "ended"; onDraftChange?: (t: string) => void }) {
  const onDraftChange = props.onDraftChange ?? vi.fn();
  const view = renderHook(
    ({ draft, sessionStatus }) =>
      useGrammarCheck({ draft, sessionId: "s1", sessionStatus, onDraftChange, }),
    { initialProps: { draft: props.draft, sessionStatus: props.sessionStatus ?? ("idle" as const) } },
  );
  return { ...view, onDraftChange };
}

describe("useGrammarCheck", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("loads config from the health endpoint", async () => {
    installFetch();
    const { result } = render({ draft: "" });
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it("stays disabled when the health endpoint reports disabled", async () => {
    installFetch({ health: { enabled: false } });
    const { result } = render({ draft: "I has a apple" });
    await waitFor(() => expect(result.current.enabled).toBe(false));
    // give the (skipped) debounce a chance
    await new Promise((r) => setTimeout(r, 40));
    expect((globalThis.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes("/check"))).toHaveLength(0);
  });

  it("auto-checks after the debounce for a prose draft ≥ minChars", async () => {
    const f = installFetch();
    const { result } = render({ draft: "I has a apple" });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(f.checkCalls().length).toBe(1);
    expect(result.current.suggestions).toHaveLength(2);
    expect(result.current.summary).toBe("2 grammar");
  });

  it("does not auto-check a draft below minChars", async () => {
    const f = installFetch();
    render({ draft: "hi" });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.checkCalls().length).toBe(0);
  });

  it("does not auto-check slash-command or shell drafts", async () => {
    const f = installFetch();
    render({ draft: "/compact now please" });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.checkCalls().length).toBe(0);
  });

  it("does not auto-check while the session is streaming", async () => {
    const f = installFetch();
    render({ draft: "I has a apple", sessionStatus: "streaming" });
    await new Promise((r) => setTimeout(r, 50));
    expect(f.checkCalls().length).toBe(0);
  });

  it("manual checkNow runs even when auto-check is off", async () => {
    const f = installFetch({ health: { autoCheck: false } });
    const { result } = render({ draft: "I has a apple" });
    await waitFor(() => expect(result.current.enabled).toBe(true));
    await new Promise((r) => setTimeout(r, 40));
    expect(f.checkCalls().length).toBe(0); // auto-check off
    await act(async () => {
      result.current.checkNow();
    });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(f.checkCalls().length).toBe(1);
  });

  it("clears the panel when the draft is emptied (e.g. after Send)", async () => {
    installFetch();
    const { result, rerender } = render({ draft: "I has a apple" });
    await waitFor(() => expect(result.current.status).toBe("done"));
    expect(result.current.suggestions.length).toBeGreaterThan(0);
    // Send resets the composer draft to "" → the panel must clear.
    rerender({ draft: "", sessionStatus: "idle" });
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(result.current.suggestions).toHaveLength(0);
  });

  it("applyAll replaces the draft with correctedText and clears the panel", async () => {
    installFetch();
    const onDraftChange = vi.fn();
    const { result } = render({ draft: "I has a apple", onDraftChange });
    await waitFor(() => expect(result.current.status).toBe("done"));
    act(() => result.current.applyAll());
    expect(onDraftChange).toHaveBeenCalledWith("I have an apple");
    expect(result.current.status).toBe("idle");
  });

  it("accept splices a single suggestion into the draft", async () => {
    installFetch();
    const onDraftChange = vi.fn();
    const { result } = render({ draft: "I has a apple", onDraftChange });
    await waitFor(() => expect(result.current.status).toBe("done"));
    act(() => result.current.accept("2:3:0"));
    expect(onDraftChange).toHaveBeenCalledWith("I have a apple");
    // accepted suggestion drops out of the active list
    await waitFor(() => expect(result.current.suggestions.map((s) => s.id)).toEqual(["8:5:1"]));
  });

  it("marks a suggestion stale when its original is no longer in the draft", async () => {
    installFetch();
    // draft no longer contains "a apple"
    const { result } = render({ draft: "I has fruit here" });
    await waitFor(() => expect(result.current.status).toBe("done"));
    const stale = result.current.suggestions.find((s) => s.id === "8:5:1");
    expect(stale?.stale).toBe(true);
    const live = result.current.suggestions.find((s) => s.id === "2:3:0");
    expect(live?.stale).toBe(false);
  });

  it("surfaces a typed error code on a failed check", async () => {
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes("/api/grammar/health")) {
        return new Response(JSON.stringify({ success: true, data: HEALTH }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: false, code: "backend_unreachable" }), { status: 502 });
    }) as any;
    const { result } = render({ draft: "I has a apple" });
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error).toBe("backend_unreachable");
  });
});
