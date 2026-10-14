/**
 * `useInitStatus` re-probe tests — the setup banner must clear once a setup
 * turn finishes, without a page reload and across banner remounts.
 *
 * Covers test-plan #E1–E8, #F1–F7, #F9, #X1, #X2 of change
 * fix-project-setup-completion-state.
 */
import { act, cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FolderActionBanner } from "../../components/folder/FolderActionBanner.js";
import type { WorktreeInitStatus } from "../../lib/git/git-api.js";
import { setupState } from "../../lib/init-setup-state.js";
import { useInitStatus } from "../useInitStatus.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/git/git-api.js", async (orig) => ({
  ...(await orig<typeof import("../../lib/git/git-api.js")>()),
  fetchWorktreeInitStatus: fetchMock,
}));

const CWD = "/a/proj";
type Sess = { id: string; status: string };
const NP: WorktreeInitStatus = { hasHook: false, checklist: [{ id: "settings", present: false, required: true }] };
const OK: WorktreeInitStatus = { hasHook: false, checklist: [{ id: "settings", present: true, required: true }] };
const FAILED: WorktreeInitStatus = { hasHook: false };

interface Props { sessions: Sess[]; isProjectRoot: boolean }
const S = (id: string, status: string): Sess => ({ id, status });

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

async function mount(initial: Props, probe: WorktreeInitStatus = NP) {
  fetchMock.mockResolvedValue(probe);
  const hook = renderHook((p: Props) => useInitStatus(CWD, p), { initialProps: initial });
  await act(async () => {});
  return hook;
}

async function update(hook: Awaited<ReturnType<typeof mount>>, props: Props) {
  hook.rerender(props);
  await act(async () => {});
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

describe("useInitStatus — gate", () => {
  it("E1: configured row never re-probes", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true }, OK);
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("E2: non-project-root row never re-probes (status change or visibility)", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: false });
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: false });
    vi.setSystemTime(Date.now() + 31_000);
    act(() => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("E3: no interpretable probe yet keeps the gate closed", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true }, FAILED);
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useInitStatus — visibility throttle", () => {
  it("E4: 30 s boundary — 29 999 ms no probe, 30 000 ms exactly one", async () => {
    await mount({ sessions: [], isProjectRoot: true });
    vi.setSystemTime(Date.now() + 29_999);
    act(() => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 1);
    await act(async () => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("E5: throttle is stamped at issue — an unresolved probe still throttles", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    vi.setSystemTime(Date.now() + 31_000);
    fetchMock.mockReturnValue(new Promise(() => {})); // never resolves
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(Date.now() + 10_000);
    act(() => setVisibility("visible"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hidden transitions never probe", async () => {
    await mount({ sessions: [], isProjectRoot: true });
    vi.setSystemTime(Date.now() + 60_000);
    act(() => setVisibility("hidden"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useInitStatus — session triggers", () => {
  it("E6: entering streaming / active never fires", async () => {
    const h = await mount({ sessions: [S("A", "idle")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "active")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("E7: coalesced triggers in one update fire once", async () => {
    const h = await mount({ sessions: [S("A", "streaming"), S("B", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "idle"), S("B", "ended")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("E8: unrelated re-render (identical id:status) is a no-op", async () => {
    const h = await mount({ sessions: [S("A", "idle")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("F1: setup turn finishes, session stays open → status converges", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    fetchMock.mockResolvedValue(OK);
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(h.result.current.status).toEqual(OK);
  });

  it("F2: session ends → one extra probe", async () => {
    const h = await mount({ sessions: [S("A", "active")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "ended")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("F3: turn completed while unobserved (first seen already idle)", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "streaming"), S("B", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("F4: session vanishes before `ended` was observed", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("F5: first snapshot only seeds", async () => {
    await mount({ sessions: [S("A", "idle"), S("B", "ended")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useInitStatus — async safety", () => {
  it("F6: latest-wins — an older, later-resolving probe cannot overwrite", async () => {
    const h = await mount({ sessions: [], isProjectRoot: true });
    const d1 = deferred<WorktreeInitStatus>();
    const d2 = deferred<WorktreeInitStatus>();
    fetchMock.mockReturnValueOnce(d1.promise).mockReturnValueOnce(d2.promise);
    act(() => { h.result.current.refetch(); });
    act(() => { h.result.current.refetch(); });
    await act(async () => { d2.resolve(OK); });
    await act(async () => { d1.resolve(NP); });
    expect(h.result.current.status).toEqual(OK);
  });

  it("F7: no state update after unmount", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const h = await mount({ sessions: [], isProjectRoot: true });
    const d = deferred<WorktreeInitStatus>();
    fetchMock.mockReturnValueOnce(d.promise);
    act(() => { h.result.current.refetch(); });
    h.unmount();
    await act(async () => { d.resolve(OK); });
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("useInitStatus — failure / abandonment", () => {
  it("X1: a failed probe keeps the gate open — the next trigger retries", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    fetchMock.mockResolvedValue(FAILED);
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setupState(h.result.current.status)).toBe("unknown");
    await update(h, { sessions: [S("A", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "idle")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("X2: abandoned setup — still not-a-project after the session ends", async () => {
    const h = await mount({ sessions: [S("A", "streaming")], isProjectRoot: true });
    await update(h, { sessions: [S("A", "ended")], isProjectRoot: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(setupState(h.result.current.status)).toBe("not-a-project");
  });
});

describe("useInitStatus — banner remount (F9)", () => {
  function Host({ sessions, showBanner }: { sessions: Sess[]; showBanner: boolean }) {
    const { status, refetch } = useInitStatus(CWD, { sessions, isProjectRoot: true });
    return showBanner ? (
      <FolderActionBanner cwd={CWD} status={status} isProjectRoot onInitializeProject={() => {}} onStatusChange={refetch} />
    ) : null;
  }

  it("F9: trigger survives banner remount; banner clears once the probe reports present", async () => {
    fetchMock.mockResolvedValue(NP);
    const view = render(<Host sessions={[S("A", "streaming")]} showBanner />);
    await act(async () => {});
    expect(screen.getByTestId(`folder-banner-setup-${CWD}`)).toBeTruthy();

    view.rerender(<Host sessions={[S("A", "streaming")]} showBanner={false} />);
    view.rerender(<Host sessions={[S("A", "streaming")]} showBanner />);
    await act(async () => {});

    fetchMock.mockResolvedValue(OK);
    view.rerender(<Host sessions={[S("A", "idle")]} showBanner />);
    await act(async () => {});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId(`folder-banner-setup-${CWD}`)).toBeNull();
  });
});
