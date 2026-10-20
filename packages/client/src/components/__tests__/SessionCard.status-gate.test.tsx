/**
 * STATUS subcard gate with a core-owned stand-in for a status-gating plugin's
 * badge + feed claims (`test-support/statusGateStandIn.tsx`; fix-empty-status-subcard):
 * decision table #E3, first/last tab #F1/#F2, feed independent of cards #F5,
 * malformed frames #X3. The real browser-plugin badge/store is covered by that
 * plugin's own tests. See change: decouple-plugins-from-core (task 2.12).
 */
import {
  createSlotRegistry,
  PluginContextProvider,
  ShellHeadlessSlot,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionPrefs } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CardSectionsProvider } from "../../lib/state/CardSectionsContext.js";
import {
  hasStandInItems,
  resetStandIn,
  STAND_IN_FRAME_TYPE,
  STAND_IN_PLUGIN_ID,
  StandInBadge,
  StandInFeed,
} from "../../test-support/statusGateStandIn.js";
import { SessionCard } from "../session/SessionCard.js";

vi.mock("../../hooks/useMobile.js", () => ({ useMobile: vi.fn(() => false) }));
vi.mock("wouter", async (orig) => ({ ...(await orig<typeof import("wouter")>()), useLocation: () => ["/", vi.fn()] }));

beforeAll(() => {
  Element.prototype.scrollTo = () => {};
});
beforeEach(() => {
  resetStandIn();
});
afterEach(() => {
  cleanup();
  resetStandIn();
});

class FakeWs {
  private listeners = new Set<(e: MessageEvent) => void>();
  addEventListener(t: string, cb: (e: MessageEvent) => void) {
    if (t === "message") this.listeners.add(cb);
  }
  removeEventListener(t: string, cb: (e: MessageEvent) => void) {
    if (t === "message") this.listeners.delete(cb);
  }
  emit(msg: unknown) {
    for (const cb of this.listeners) cb({ data: JSON.stringify(msg) } as MessageEvent);
  }
}

const tab = (tabId: number) => ({ tabId, title: `Tab ${tabId}`, url: "https://x.test", state: "live" as const });
const relay = (n: number) => ({
  type: STAND_IN_FRAME_TYPE,
  auditSeq: 1,
  instances: n ? [{ instanceId: "i1", profileDirectory: "OSS", state: "connected", tabs: Array.from({ length: n }, (_, i) => tab(i + 1)) }] : [],
});

function registry() {
  const r = createSlotRegistry();
  r.addClaim({ pluginId: "goal", priority: 100, slot: "session-card-badge", Component: () => <span data-testid="goal-badge">G</span>, shouldRender: (s) => !!(s as { hasGoal?: boolean } | null)?.hasGoal });
  r.addClaim({ pluginId: "auto", priority: 101, slot: "session-card-badge", Component: () => <span data-testid="auto-badge">A</span>, shouldRender: (s) => !!(s as { isAutomationRun?: boolean } | null)?.isAutomationRun });
  r.addClaim({ pluginId: STAND_IN_PLUGIN_ID, priority: 500, slot: "session-card-badge", Component: StandInBadge, shouldRender: hasStandInItems });
  r.addClaim({ pluginId: STAND_IN_PLUGIN_ID, priority: 500, slot: "shell-headless", Component: StandInFeed });
  return r;
}

const session = (o: Record<string, unknown> = {}) =>
  ({ id: "s1", cwd: "/repo", source: "tui", status: "idle", startedAt: Date.now() - 60000, tokensIn: 0, tokensOut: 0, cost: 0, ...o }) as unknown as DashboardSession;

const hasStatus = () => screen.queryAllByText("STATUS", { selector: "span" }).length > 0;

function Harness({ ws, s, showCard = true, prefs }: { ws: FakeWs; s: DashboardSession; showCard?: boolean; prefs?: CardSectionPrefs }) {
  const card = (
    <SessionCard
      session={s}
      selectedId={undefined}
      onSelect={() => {}}
      now={Date.now()}
      showGitInfo={false}
      isHidden={false}
      onArchive={() => {}}
    />
  );
  return (
    <PluginContextProvider registry={registry()} ws={ws as unknown as WebSocket} connectionStatus="disconnected">
      <ShellHeadlessSlot />
      {showCard ? (prefs ? <CardSectionsProvider value={{ prefs }}>{card}</CardSectionsProvider> : card) : null}
    </PluginContextProvider>
  );
}

describe("STATUS gate decision table (#E3)", () => {
  const rows: Array<[string, Record<string, unknown>, number, CardSectionPrefs | undefined, boolean]> = [
    ["no goal/auto, 0 tabs", {}, 0, undefined, false],
    ["no goal/auto, 1 tab", {}, 1, undefined, true],
    ["goal, 0 tabs", { hasGoal: true }, 0, undefined, true],
    ["automation, 0 tabs", { isAutomationRun: true }, 0, undefined, true],
    ["1 tab but stand-in badge hidden by pref", {}, 1, { global: { "badge-standin": false } }, false],
  ];
  it.each(rows)("%s", (_n, over, tabs, prefs, shown) => {
    const ws = new FakeWs();
    render(<Harness ws={ws} s={session(over)} prefs={prefs} />);
    act(() => ws.emit(relay(tabs)));
    expect(hasStatus()).toBe(shown);
  });
});

describe("idle card follows relay status without a session broadcast (#F1, #F2)", () => {
  it("shows STATUS + badge on the first tab, hides on the last close", () => {
    const ws = new FakeWs();
    const s = session(); // referentially fixed: no session broadcast
    render(<Harness ws={ws} s={s} />);
    expect(hasStatus()).toBe(false);
    act(() => ws.emit(relay(1)));
    expect(hasStatus()).toBe(true);
    expect(screen.getByTestId("standin-badge")).toBeTruthy();
    act(() => ws.emit(relay(0)));
    expect(hasStatus()).toBe(false);
    expect(screen.queryByTestId("standin-badge")).toBeNull();
  });
});

describe("feed independent of cards (#F5)", () => {
  it("holds the snapshot before any card exists; a later card shows STATUS", () => {
    const ws = new FakeWs();
    const s = session();
    const { rerender } = render(<Harness ws={ws} s={s} showCard={false} />);
    act(() => ws.emit(relay(1)));
    expect(hasStatus()).toBe(false);
    rerender(<Harness ws={ws} s={s} showCard />);
    expect(hasStatus()).toBe(true);
    expect(screen.getByTestId("standin-badge")).toBeTruthy();
  });
});

describe("malformed relay frames do not crash the gate (#X3)", () => {
  it("non-array instances → no STATUS; then a partly bad frame → STATUS with 1-tab menu", () => {
    const ws = new FakeWs();
    render(<Harness ws={ws} s={session()} />);
    act(() => ws.emit({ type: STAND_IN_FRAME_TYPE, auditSeq: 1, instances: {} }));
    expect(hasStatus()).toBe(false);
    act(() => ws.emit({ type: STAND_IN_FRAME_TYPE, auditSeq: 2, instances: [{ instanceId: "a", tabs: null }, { instanceId: "i1", tabs: [tab(1)] }] }));
    expect(hasStatus()).toBe(true);
    fireEvent.click(screen.getByTestId("standin-badge"));
    expect(screen.getAllByRole("menuitem").filter((el) => el.getAttribute("data-testid")?.startsWith("browser-relay-open-i1"))).toHaveLength(1);
  });
});
