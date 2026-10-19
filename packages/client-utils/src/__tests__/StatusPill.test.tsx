import { mdiCheck, mdiFlaskOutline, mdiLoading } from "@mdi/js";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { __resetMdiIconSetForTests, loadMdiIconSet } from "../mdi-by-key.js";
import { StatusPill } from "../StatusPill.js";

/**
 * `ui:status-pill` renders the runtime kit's `SettingsStatusPill`
 * (change: align-ui-contract-recipes, design D2; test-plan #E1, #E2).
 *
 * The two lazy-icon tests that used to assert "no svg before the icon set loads"
 * were replaced: the `shared-status-recipes` scenario "Default icon on a cold
 * load" now requires the tone's default icon on first paint, so the old
 * assertion is the behaviour this change retires. The replacement asserts
 * strictly more (default path first, then the resolved path).
 */

afterEach(() => {
  cleanup();
  __resetMdiIconSetForTests();
});

type State = "running" | "success" | "info" | "warn" | "error" | "muted";

const TONE: Record<State, string> = {
  running: "info",
  success: "success",
  info: "info",
  warn: "warning",
  error: "error",
  muted: "neutral",
};

/** The wrapper that carries `data-status-pill` + `title`. */
const wrapOf = (c: HTMLElement) => c.querySelector("[data-status-pill]") as HTMLElement;
/** The kit pill inside it, which carries tone and classes. */
const pillOf = (c: HTMLElement) => wrapOf(c).querySelector("[data-tone]") as HTMLElement;
const pathOf = (el: Element) => el.querySelector("svg path")?.getAttribute("d");

describe("StatusPill", () => {
  it("renders the text", () => {
    const { getByText } = render(<StatusPill state="running" text="Working" />);
    expect(getByText("Working")).toBeDefined();
  });

  it("keeps the raw state in data-status-pill", () => {
    const { container } = render(<StatusPill state="error" text="Failed" />);
    expect(wrapOf(container).getAttribute("data-status-pill")).toBe("error");
  });

  it.each(Object.keys(TONE) as State[])("%s maps to its severity tone and shows an icon (#E1)", (state) => {
    const { container } = render(<StatusPill state={state} text={state} />);
    const el = pillOf(container);
    const tone = TONE[state];
    expect(el.getAttribute("data-tone")).toBe(tone);
    expect(el.className).toContain(`bg-[var(--severity-${tone}-bg)]`);
    expect(el.className).toContain(`border-[var(--severity-${tone}-border)]`);
    expect(el.className).toContain(`text-[var(--severity-${tone}-fg)]`);
    expect(el.querySelector("svg path")?.getAttribute("d")).toBeTruthy();
    expect(el.getAttribute("style")).toBeNull();
    expect(wrapOf(container).outerHTML).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}\b/);
  });

  it("running shows a spinning progress icon that stops under reduced motion", () => {
    const { container } = render(<StatusPill state="running" text="Working" />);
    const svg = pillOf(container).querySelector("svg");
    expect(pathOf(pillOf(container))).toBe(mdiLoading);
    expect(svg?.getAttribute("class")).toContain("animate-spin");
    expect(svg?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("only running spins", () => {
    for (const state of ["success", "info", "warn", "error", "muted"] as const) {
      const { container, unmount } = render(<StatusPill state={state} text={state} />);
      expect(pillOf(container).querySelector("svg")?.getAttribute("class")).not.toContain("animate-spin");
      unmount();
    }
  });

  it("running ignores an explicit icon key: it always shows the progress glyph", () => {
    const { container } = render(<StatusPill state="running" text="Working" icon="mdiCheck" />);
    expect(pathOf(pillOf(container))).toBe(mdiLoading);
  });

  it("tooltip becomes a title attribute", () => {
    const { container } = render(<StatusPill state="running" text="X" tooltip="Currently running" />);
    expect(container.querySelector("[title]")?.getAttribute("title")).toBe("Currently running");
  });

  it("does not render a title without a tooltip", () => {
    const { container } = render(<StatusPill state="info" text="X" />);
    expect(container.querySelector("[title]")).toBeNull();
  });

  // Lazy icon set (change: harden-ios-safari-memory-and-ws-diagnostics) + default icon on a cold load (#E2).
  it("shows the tone default icon first, then the resolved icon key (#E2)", async () => {
    const { container } = render(<StatusPill state="info" text="Working" icon="mdiCheck" />);
    const first = pathOf(pillOf(container));
    expect(first).toBeTruthy();
    expect(first).not.toBe(mdiCheck);
    await waitFor(() => {
      expect(pathOf(pillOf(container))).toBe(mdiCheck);
    });
  });

  it("resolves a different key to its own path", async () => {
    const { container } = render(<StatusPill state="warn" text="Beta" icon="mdiFlaskOutline" />);
    await waitFor(() => {
      expect(pathOf(pillOf(container))).toBe(mdiFlaskOutline);
    });
  });

  it("keeps the tone default for an unknown icon key and does not throw (#E2, test-plan #S3)", async () => {
    const { container } = render(<StatusPill state="error" text="Failed" icon="mdiNotAReal" />);
    const before = pathOf(pillOf(container));
    expect(before).toBeTruthy();
    await act(async () => {
      await loadMdiIconSet();
    });
    expect(pathOf(pillOf(container))).toBe(before);
    expect(pillOf(container).textContent).toContain("Failed");
  });

  it("shows the tone default icon when no icon key is given", () => {
    const { container } = render(<StatusPill state="success" text="OK" />);
    expect(pillOf(container).querySelector("svg path")?.getAttribute("d")).toBeTruthy();
  });
});
