/**
 * ProviderHealthPill unit tests — the register matrix re-authored here after
 * the LlmProviderCard suites were deleted with the card (change:
 * redesign-providers-settings-page). Cached-health registers render through
 * derivePillView; the live-result precedence (a Test response outranking the
 * cached health) is asserted on the same derivation the connected row and the
 * Add-dialog pane both feed.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderHealth } from "../../../lib/api/providers-api.js";
import { derivePillView, ProviderHealthPill } from "../ProviderHealthPill.js";

afterEach(cleanup);

/** Click "Copy details" on the rendered error line and return what reached the clipboard. */
async function copiedPayload(): Promise<string> {
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  await act(async () => {
    fireEvent.click(screen.getByTestId("provider-error-line-copy-details"));
  });
  return String((writeText.mock.calls[0] as unknown[])[0]);
}

/** Render the pill through the cached-health derivation, as both surfaces do. */
function renderPillFromHealth(health?: ProviderHealth) {
  render(<ProviderHealthPill view={derivePillView({ health })} />);
  return {
    pill: screen.getByTestId("health-pill"),
    errorLine: () => screen.queryByTestId("provider-error-line"),
  };
}

describe("ProviderHealthPill register matrix (moved from LlmProviderCard.health)", () => {
  it("connected register: green pill with model count, no error line", () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: true, status: 200, modelCount: 142, testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/142 models/);
    expect(errorLine()).toBeNull();
  });

  it("connected register with zero models: 'Connected' without a count", () => {
    const { pill } = renderPillFromHealth({ ok: true, modelCount: 0, testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("ok");
    expect(pill.textContent).toMatch(/Connected/);
    expect(pill.textContent).not.toMatch(/models/);
  });

  // align-ui-contract-recipes: the raw error text moved from a visible line into
  // "Copy details" (the provider-error-line is now one sentence).
  it("error register: warning pill with the HTTP status code; the raw error is only copied", async () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: false, status: 401, error: "invalid x-api-key", testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("error");
    expect(pill.textContent).toMatch(/401/);
    expect(pill.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("warning");
    expect(errorLine()!.getAttribute("role")).toBe("alert");
    expect(errorLine()!.textContent).not.toContain("invalid x-api-key");
    expect(await copiedPayload()).toBe("invalid x-api-key");
  });

  it("unreachable register: error pill; the raw error is only copied", async () => {
    const { pill, errorLine } = renderPillFromHealth({ ok: false, error: "getaddrinfo ENOTFOUND api.example.com", testedAt: 1 });
    expect(pill.getAttribute("data-state")).toBe("unreachable");
    expect(pill.textContent).toMatch(/Unreachable/i);
    expect(pill.querySelector("[data-tone]")?.getAttribute("data-tone")).toBe("error");
    expect(errorLine()!.textContent).not.toContain("ENOTFOUND");
    expect(await copiedPayload()).toBe("getaddrinfo ENOTFOUND api.example.com");
  });

  it("not-tested register: neutral pill, no error line, when no cached health", () => {
    const { pill, errorLine } = renderPillFromHealth(undefined);
    expect(pill.getAttribute("data-state")).toBe("not-tested");
    expect(errorLine()).toBeNull();
  });

  it("the copied payload preserves the FULL multi-line error string", async () => {
    render(<ProviderHealthPill view={{ kind: "error", status: 500, error: "line one\nline two" }} />);
    expect(await copiedPayload()).toBe("line one\nline two");
  });

  it("no raw palette colour class remains on any register", () => {
    const views = [
      { kind: "testing" },
      { kind: "pending" },
      { kind: "ok", modelCount: 3 },
      { kind: "not-tested" },
      { kind: "error", status: 500, error: "x" },
      { kind: "unreachable", error: "y" },
    ] as const;
    for (const view of views) {
      const { container, unmount } = render(<ProviderHealthPill view={view} />);
      expect(container.innerHTML).not.toMatch(/\b(text|bg|border)-(green|yellow|red|amber|blue)-\d/);
      unmount();
    }
  });

  it("every register keeps data-testid=health-pill and its data-state", () => {
    const expected: Array<[Parameters<typeof ProviderHealthPill>[0]["view"], string]> = [
      [{ kind: "testing" }, "testing"],
      [{ kind: "pending" }, "pending"],
      [{ kind: "ok", modelCount: 3 }, "ok"],
      [{ kind: "not-tested" }, "not-tested"],
      [{ kind: "error", status: 500, error: "" }, "error"],
      [{ kind: "unreachable", error: "" }, "unreachable"],
    ];
    for (const [view, state] of expected) {
      const { unmount } = render(<ProviderHealthPill view={view} />);
      expect(screen.getByTestId("health-pill").getAttribute("data-state")).toBe(state);
      unmount();
    }
  });

  it("an in-flight probe (testing / pending) shows a spinning progress icon", () => {
    for (const kind of ["testing", "pending"] as const) {
      const { unmount } = render(<ProviderHealthPill view={{ kind }} />);
      expect(screen.getByTestId("health-pill").querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
      unmount();
    }
  });

  it("an empty error string renders no error line", () => {
    render(<ProviderHealthPill view={{ kind: "unreachable", error: "" }} />);
    expect(screen.queryByTestId("provider-error-line")).toBeNull();
  });
});

describe("derivePillView precedence (the derivation the row and pane feed)", () => {
  it("a failed live Test result outranks cached-ok health", () => {
    expect(derivePillView({
      health: { ok: true, status: 200, modelCount: 5, testedAt: 1 },
      live: { ok: false, status: 403, error: "forbidden now" },
    })).toEqual({ kind: "error", status: 403, error: "forbidden now" });
  });

  it("an ok live Test result outranks cached-failure health", () => {
    expect(derivePillView({
      health: { ok: false, status: 401, error: "stale", testedAt: 1 },
      live: { ok: true, modelCount: 7 },
    })).toEqual({ kind: "ok", modelCount: 7 });
  });

  it("the testing register outranks everything while the probe is in flight", () => {
    expect(derivePillView({ testing: true, live: { ok: true, modelCount: 1 } })).toEqual({ kind: "testing" });
  });
});
