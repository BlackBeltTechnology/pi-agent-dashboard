/**
 * `tool-renderer` claim seams `rowStatus`, `stop` and `stopLabel` in `ToolCallStep`.
 *
 * Covers test-plan #E5 (row status decision table) and #E6 (claim-owned stop,
 * standalone and inside a burst controller), #E3/#E4 of
 * drop-subagent-card-stop-button (a claim-handled stop expands the row).
 * See change: subagent-queue-visibility (design D2).
 * See change: drop-subagent-card-stop-button (design D3).
 */
import { type ClaimEntry, createSlotRegistry, PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { mdiLoading } from "@mdi/js";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetClaimWarningsForTests, ToolCallStep } from "../chat/ToolCallStep.js";
import type { StopController } from "../chat/ToolStopControl.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";
import type { ToolContext } from "../tool-renderers/index.js";

vi.mock("../../hooks/useMobile.js", () => ({
  useMobile: () => false,
  MobileProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
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

beforeEach(() => __resetClaimWarningsForTests());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Status = "running" | "complete" | "error" | "elided";

function renderRow(
  claim: Partial<ClaimEntry> | null,
  props: { status: Status; onAbort?: () => void; stopController?: StopController | null },
) {
  const registry = createSlotRegistry();
  if (claim) {
    registry.addClaim({
      pluginId: "p",
      priority: 100,
      slot: "tool-renderer",
      toolName: "Agent",
      Component: () => <div data-testid="plugin-renderer" />,
      ...claim,
    });
  }
  return render(
    <PluginContextProvider registry={registry}>
      <ThemeProvider>
        <ToolCallStep
          toolName="Agent"
          toolCallId="tc-1"
          status={props.status}
          startedAt={Date.now() - 1000}
          toolDetails={{ agentId: "ag-1" }}
          context={{ sessionId: "s-1" } as ToolContext}
          onAbort={props.onAbort}
          stopController={props.stopController}
        />
      </ThemeProvider>
    </PluginContextProvider>,
  );
}

/** The running spinner is the `mdiLoading` glyph. */
const spinner = (c: HTMLElement) => c.querySelector(`path[d="${mdiLoading}"]`);

describe("claim rowStatus decision table (#E5)", () => {
  const variants = {
    queued: () => ({ state: "queued" as const, label: "queued · #2" }),
    stopped: () => ({ state: "stopped" as const, label: "removed from queue" }),
    undefined: () => undefined,
    throws: () => {
      throw new Error("row boom");
    },
  };

  for (const status of ["running", "complete", "error", "elided"] as Status[]) {
    for (const [name, rowStatus] of Object.entries(variants)) {
      it(`status=${status} × rowStatus=${name}`, () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const { container } = renderRow({ rowStatus }, { status });
        const queued = container.querySelector('[data-testid="tool-row-status-queued"]');
        const stopped = container.querySelector('[data-testid="tool-row-status-stopped"]');
        const label = container.querySelector('[data-testid="tool-row-status-label"]');
        if (name === "queued" && status === "running") {
          expect(queued).not.toBeNull();
          expect(label?.textContent).toBe("queued · #2");
          expect(spinner(container)).toBeNull();
          // The wait time stays visible: queueing starts with the call, so the
          // row's live elapsed counter IS the wait (spec: "with the wait time").
          expect(container.querySelector('[data-testid="tool-row-wait-time"]')?.textContent).toMatch(/^(\d+s|<1s)…$/);
        } else if (name === "stopped" && status === "complete") {
          expect(stopped).not.toBeNull();
          expect(stopped?.className).not.toContain("text-green-400");
          expect(label?.textContent).toBe("removed from queue");
        } else {
          expect(queued).toBeNull();
          expect(stopped).toBeNull();
          expect(label).toBeNull();
        }
        if (name === "throws") {
          expect(warn).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0][0])).toContain('"p"');
        }
      });
    }
  }

  it("a throwing rowStatus warns ONCE per plugin across renders", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rowStatus = () => {
      throw new Error("x");
    };
    renderRow({ rowStatus }, { status: "running" });
    cleanup();
    renderRow({ rowStatus }, { status: "running" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("without a claim the row renders as before (spinner + elapsed)", () => {
    const { container } = renderRow(null, { status: "running" });
    expect(container.querySelector('[data-testid="tool-row-status-queued"]')).toBeNull();
    expect(spinner(container)).not.toBeNull(); // the probe can see a spinner
  });
});

describe("claim-owned per-row stop (#E6)", () => {
  const burst = () => ({ state: "idle" as const, stop: vi.fn(), forceKill: vi.fn() });

  for (const [name, stopImpl] of [
    ["true", () => true],
    ["false", () => false],
    [
      "throws",
      () => {
        throw new Error("stop boom");
      },
    ],
    ["absent", undefined],
  ] as const) {
    for (const inBurst of [false, true]) {
      it(`claim.stop=${name}, in burst=${inBurst}`, () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        const onAbort = vi.fn();
        const controller = inBurst ? burst() : null;
        const stop = stopImpl ? vi.fn(stopImpl) : undefined;
        const { container } = renderRow(stop ? { stop } : {}, { status: "running", onAbort, stopController: controller });
        const btn = container.querySelector('[data-testid="tool-stop-button"]') as HTMLButtonElement;
        expect(btn).not.toBeNull();
        fireEvent.click(btn);
        if (stop) {
          expect(stop).toHaveBeenCalledWith({ sessionId: "s-1", toolCallId: "tc-1", toolDetails: { agentId: "ag-1" } });
        }
        const existing = inBurst ? controller!.stop : onAbort;
        expect(existing).toHaveBeenCalledTimes(name === "true" ? 0 : 1);
        if (inBurst) expect(onAbort).not.toHaveBeenCalled();
      });
    }
  }

  it("stopLabel supplies the accessible label", () => {
    const { container } = renderRow({ stopLabel: () => "Remove from queue" }, { status: "running", onAbort: vi.fn() });
    const btn = container.querySelector('[data-testid="tool-stop-button"]') as HTMLButtonElement;
    expect(btn.getAttribute("aria-label")).toBe("Remove from queue");
  });
});

describe("a claim-handled stop expands the row (#E3/#E4)", () => {
  /** Collapse the row with header clicks, whatever its initial state. */
  function collapse(container: HTMLElement) {
    const header = container.querySelector('[data-testid="tool-call-step"] button') as HTMLButtonElement;
    if (container.querySelector('[data-testid="plugin-renderer"]')) fireEvent.click(header);
    expect(container.querySelector('[data-testid="plugin-renderer"]')).toBeNull();
  }

  it("#E3 claim stop → true on a collapsed row: row body shown, onAbort not called", () => {
    const onAbort = vi.fn();
    const { container } = renderRow({ stop: () => true }, { status: "running", onAbort });
    collapse(container);
    fireEvent.click(container.querySelector('[data-testid="tool-stop-button"]') as HTMLButtonElement);
    expect(container.querySelector('[data-testid="plugin-renderer"]')).not.toBeNull();
    expect(onAbort).not.toHaveBeenCalled();
  });

  for (const [name, stopImpl] of [
    ["false", () => false],
    [
      "throws",
      () => {
        throw new Error("stop boom");
      },
    ],
  ] as const) {
    it(`#E4 claim stop → ${name}: row stays collapsed, onAbort called once`, () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const onAbort = vi.fn();
      const { container } = renderRow({ stop: stopImpl }, { status: "running", onAbort });
      collapse(container);
      fireEvent.click(container.querySelector('[data-testid="tool-stop-button"]') as HTMLButtonElement);
      expect(container.querySelector('[data-testid="plugin-renderer"]')).toBeNull();
      expect(onAbort).toHaveBeenCalledTimes(1);
    });
  }
});
