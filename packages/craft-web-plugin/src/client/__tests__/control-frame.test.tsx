// @vitest-environment jsdom
/**
 * Live control through the real host (add-craft-live-control D1–D6): claims with a status per path match,
 * the run re-check and TTL, the agent chip and log, agentPending vs the shim's dirty:false, save records
 * through host.state, and the agent-export confirmation.
 * Test-plan #E1 #E2 #E14 #E11 #E13 #X5 #F2 (and the host-side half of #E4 #E9 #E10 through the frame).
 */
import { PluginContextProvider } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL_CLAIM, CONTROL_GONE, CONTROL_PROBE, CONTROL_RESULT, CONTROL_RUN } from "../../shared/control-protocol.js";
import { ControlHost } from "../control-host.js";
import { AGENT_LOG_MAX, appendLog, buildClaim, type ControlInstance, handleRun, logRow, type ProbeMsg, type RunMsg, runExpired } from "../control-registry.js";
import { CRAFT_WEB_APPS } from "../craft-apps-table.js";
import type { FrameSession } from "../frame-session.js";
import { bytesOf, flush, makeFh, mountFrame, openDoc, shimSend, stubFetch } from "./test-utils.js";

const download = vi.hoisted(() => vi.fn());
vi.mock("../device-download.js", async (orig) => ({ ...(await orig<typeof import("../device-download.js")>()), downloadToDevice: download }));

const VECTOR = CRAFT_WEB_APPS.vectorcraft;
const CONTROL = VECTOR.profile.control as NonNullable<typeof VECTOR.profile.control>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  download.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ------------------------------------------------------------------------------------------------ pure routing

function host(over: { open?: boolean; caps?: { shimVersion: number; control: boolean } | null } = {}): ControlHost {
  const h = new ControlHost({
    profile: CONTROL,
    label: "VectorCraft",
    buildVersion: undefined,
    maxBytes: VECTOR.maxBytes,
    instanceId: "i1",
    postControl: vi.fn(),
    isOpen: () => over.open ?? true,
    snapshotState: () => ({ path: "a.svg", unsaved: false }),
    onPendingChange: vi.fn(),
  });
  if (over.caps !== null) h.setCaps(over.caps ?? { shimVersion: 3, control: true });
  return h;
}

function inst(o: { cwd: string; path: string; session?: string; active?: boolean; visible?: boolean; control?: ControlHost | null; msSinceFocus?: number }): ControlInstance {
  const fh = makeFh({ cwd: o.cwd, path: o.path, session: { id: o.session ?? "S" } as never, isActive: o.active ?? true });
  const control = o.control === undefined ? host() : o.control;
  return {
    instanceId: `inst:${o.cwd}:${o.path}`,
    app: VECTOR,
    fh: () => fh,
    session: () => (control ? ({ control } as unknown as FrameSession) : null),
    pageVisible: () => o.visible ?? true,
    msSinceFocus: () => o.msSinceFocus ?? 100,
  };
}

const probe = (over: Partial<ProbeMsg> = {}): ProbeMsg => ({
  type: CONTROL_PROBE,
  sessionId: "S",
  reqId: "r1",
  path: "/tmp/w/a.svg",
  realPath: "/private/tmp/w/a.svg",
  relPath: "a.svg",
  caseInsensitive: true,
  ...over,
});

describe("E1 a claim for every tab that names the file", () => {
  it("matches the lexical path, the real path and the cwd-relative path; b.svg does not claim", () => {
    const status = (cwd: string, path: string, p = probe()) => buildClaim(inst({ cwd, path }), p)?.status ?? null;
    expect(status("/tmp/w", "A.SVG")).toBe("eligible"); // case-folded
    expect(status("/private/tmp/w", "a.svg")).toBe("eligible"); // symlinked cwd, real path
    expect(status("/tmp/w", "/tmp/w/a.svg")).toBe("eligible"); // absolute tab path
    expect(status("/tmp/w", "b.svg")).toBeNull();
    expect(status("/tmp/w", "sub/a.svg")).toBeNull();
  });

  it("case-sensitive file systems keep A.SVG apart", () => {
    expect(buildClaim(inst({ cwd: "/tmp/w", path: "A.SVG" }), probe({ caseInsensitive: false }))).toBeNull();
    expect(buildClaim(inst({ cwd: "/tmp/w", path: "a.svg" }), probe({ caseInsensitive: false }))?.status).toBe("eligible");
  });

  it("the claim carries the request and instance ids and an integer focus age", () => {
    expect(buildClaim(inst({ cwd: "/tmp/w", path: "a.svg", msSinceFocus: 41.6 }), probe())).toEqual({ reqId: "r1", instanceId: "inst:/tmp/w:a.svg", status: "eligible", msSinceFocus: 42 });
  });
});

describe("E2 claim status: the first failing rule wins", () => {
  const status = (o: Partial<Parameters<typeof inst>[0]>) => buildClaim(inst({ cwd: "/tmp/w", path: "a.svg", ...o }), probe())?.status;
  it("one instance per condition", () => {
    expect(status({ session: "OTHER" })).toBe("wrong-session");
    expect(status({ control: host({ caps: { shimVersion: 3, control: false } }) })).toBe("unsupported");
    expect(status({ control: host({ caps: { shimVersion: 2, control: true } }) })).toBe("unsupported");
    expect(status({ control: host({ caps: null }) })).toBe("unsupported");
    expect(status({ control: host({ open: false }) })).toBe("not-ready");
    expect(status({ active: false })).toBe("not-visible");
    expect(status({ visible: false })).toBe("not-visible");
    expect(status({})).toBe("eligible");
  });

  it("several failing conditions: session beats unsupported beats not-ready beats not-visible", () => {
    expect(status({ session: "OTHER", active: false, control: host({ open: false }) })).toBe("wrong-session");
    expect(status({ active: false, control: host({ caps: { shimVersion: 2, control: true }, open: false }) })).toBe("unsupported");
    expect(status({ active: false, control: host({ open: false }) })).toBe("not-ready");
  });

  it("an instance whose frame session does not exist yet is not-ready", () => {
    expect(status({ control: null })).toBe("not-ready");
  });
});

describe("X5 run TTL", () => {
  const run = (over: Partial<RunMsg> = {}): RunMsg => ({ type: CONTROL_RUN, sessionId: "S", reqId: "r1", instanceId: "inst:/tmp/w:a.svg", method: "ui.inspect", ttlMs: 13_000, ...over });

  it("a run held longer than ttlMs (from receipt) is dropped and nothing is posted to the frame", async () => {
    expect(runExpired(1000, 13_000, 14_000)).toBe(false);
    expect(runExpired(1000, 13_000, 14_001)).toBe(true);
    const post = vi.fn();
    const h = new ControlHost({ ...baseDeps(post) });
    h.setCaps({ shimVersion: 3, control: true });
    const i = { ...inst({ cwd: "/tmp/w", path: "a.svg", control: h }) };
    expect(await handleRun(i, run(), 0, 13_001)).toBeNull();
    expect(post).not.toHaveBeenCalled();
    void handleRun(i, run(), 0, 13_000); // exactly at the limit is still handled
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("another instance's run, a run for another session and an inactive tab are answered or ignored per the rules", async () => {
    const h = new ControlHost({ ...baseDeps(vi.fn()) });
    h.setCaps({ shimVersion: 3, control: true });
    const i = inst({ cwd: "/tmp/w", path: "a.svg", control: h });
    expect(await handleRun(i, run({ instanceId: "someone-else" }), 0, 0)).toBeNull();
    expect(await handleRun(i, run({ sessionId: "OTHER" }), 0, 0)).toMatchObject({ reply: { ok: false, code: "not-open" } });
    const hidden = inst({ cwd: "/tmp/w", path: "a.svg", control: h, active: false });
    expect(await handleRun(hidden, run({ instanceId: hidden.instanceId }), 0, 0)).toMatchObject({ reply: { ok: false, code: "not-visible" } });
  });
});

function baseDeps(post: (...a: unknown[]) => void) {
  return {
    profile: CONTROL,
    label: "VectorCraft",
    buildVersion: undefined,
    maxBytes: VECTOR.maxBytes,
    instanceId: "inst:/tmp/w:a.svg",
    postControl: post as never,
    isOpen: () => true,
    snapshotState: () => ({ path: "a.svg", unsaved: false as const }),
    onPendingChange: vi.fn(),
  };
}

describe("F2 agent log cap", () => {
  it("keeps the newest 50 rows; each row has method, outcome, bytes and a ≤ 120-char preview", () => {
    let log: ReturnType<typeof appendLog> = [];
    for (let i = 0; i < 51; i++) log = appendLog(log, logRow(`m${i}`, { ok: true, result: { text: "y".repeat(500) }, instance: "i" }, i));
    expect(log).toHaveLength(AGENT_LOG_MAX);
    expect(log[0].method).toBe("m1");
    expect(log.at(-1)?.method).toBe("m50");
    expect(log[0].preview.length).toBeLessThanOrEqual(120);
    expect(log[0]).toMatchObject({ outcome: "ok", bytes: expect.any(Number) });
    expect(logRow("x", { ok: false, code: "denied", error: "e".repeat(300), instance: "i" }, 1)).toMatchObject({ outcome: "denied", preview: "e".repeat(120) });
  });
});

// ------------------------------------------------------------------------------------------------ through the frame

class FakeWs {
  private listeners = new Set<(e: MessageEvent) => void>();
  addEventListener(type: string, fn: (e: MessageEvent) => void): void {
    if (type === "message") this.listeners.add(fn);
  }
  removeEventListener(type: string, fn: (e: MessageEvent) => void): void {
    if (type === "message") this.listeners.delete(fn);
  }
  emit(payload: unknown): void {
    for (const fn of this.listeners) fn({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

async function mountVector(over: { cwd?: string; path?: string; active?: boolean; session?: string } = {}) {
  stubFetch({ status: () => ({ vectorcraft: { status: "ok" } }) });
  const ws = new FakeWs();
  const sent: Array<Record<string, unknown>> = [];
  const fh = makeFh({ cwd: over.cwd ?? "/tmp/w", path: over.path ?? "a.svg", session: { id: over.session ?? "S" } as never, isActive: over.active ?? true });
  const wrap = (children: ReactNode) => (
    <PluginContextProvider ws={ws as unknown as WebSocket} send={(m) => void sent.push(m as Record<string, unknown>)}>
      {children}
    </PluginContextProvider>
  );
  fh.save.mockImplementation((async () => ({ ok: true, path: fh.path, mtime: 2, sha1: "bb" })) as never);
  const m = await mountFrame({ app: VECTOR, fh, wrap });
  await shimSend(m.iframe, { type: "ready", shimVersion: 3, control: true });
  await shimSend(m.iframe, { type: "opened", title: "a", confirmed: true });
  return { m, ws, sent, fh };
}

const probeFrame = (over: Record<string, unknown> = {}) => ({ type: CONTROL_PROBE, sessionId: "S", reqId: "r1", path: "/tmp/w/a.svg", relPath: "a.svg", caseInsensitive: true, ...over });
const controlPosts = (m: Awaited<ReturnType<typeof mountVector>>["m"]) =>
  m.post.mock.calls.map((c) => c[0] as { type: string; id: number; method: string; params: unknown }).filter((p) => p.type === "control");
const results = (sent: Array<Record<string, unknown>>) => sent.filter((s) => s.type === CONTROL_RESULT);

describe("claims and runs through the host", () => {
  it("answers a probe with a claim, a run with the app's answer, and shows the chip and log", async () => {
    const { m, ws, sent } = await mountVector();
    act(() => ws.emit(probeFrame()));
    const claim = sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>;
    expect(claim).toMatchObject({ reqId: "r1", status: "eligible" });
    const instanceId = claim.instanceId as string;

    act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId: "r1", instanceId, method: "engine.execute", params: { command: "shape.rectangle", params: { x: 1 } }, ttlMs: 13_000 }));
    await flush();
    expect(m.getByTestId("craft-agent-active").textContent).toContain("engine.execute");
    const [c] = controlPosts(m);
    expect(c).toMatchObject({ method: "engine.execute", params: { command: "shape.rectangle", params: { x: 1 } } });
    await shimSend(m.iframe, { type: "control-result", id: c.id, ok: true, result: { id: 4 } });
    await flush();
    expect(results(sent)).toEqual([{ type: CONTROL_RESULT, reqId: "r1", instanceId, ok: true, result: { id: 4 } }]);
    expect(m.queryByTestId("craft-agent-active")).toBeNull();
    expect(m.getByTestId("craft-agent-log")).toBeTruthy();
    fireEvent.click(m.getByTestId("craft-agent-log").querySelector("summary") as HTMLElement);
    expect(m.getByTestId("craft-agent-log").querySelectorAll('[data-testid="craft-agent-log-row"]')).toHaveLength(1);
    // each row carries its time (spec: time, method, outcome, bytes, preview)
    expect(m.getByTestId("craft-agent-log-time").getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("a probe for another path or another session's file gets no claim / a wrong-session claim", async () => {
    const { ws, sent } = await mountVector();
    act(() => ws.emit(probeFrame({ path: "/tmp/w/b.svg", relPath: "b.svg" })));
    expect(sent.filter((s) => s.type === CONTROL_CLAIM)).toHaveLength(0);
    act(() => ws.emit(probeFrame({ sessionId: "OTHER", reqId: "r2" })));
    expect(sent.find((s) => s.type === CONTROL_CLAIM)).toMatchObject({ reqId: "r2", status: "wrong-session" });
  });

  it("a run for another instance is ignored; a not-visible tab answers not-visible without touching the frame (#F5)", async () => {
    const { m, ws, sent } = await mountVector({ active: false });
    act(() => ws.emit(probeFrame()));
    const instanceId = (sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>).instanceId as string;
    expect(sent.find((s) => s.type === CONTROL_CLAIM)).toMatchObject({ status: "not-visible" });
    act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId: "x", instanceId: "other", method: "ui.inspect", ttlMs: 13_000 }));
    act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId: "r3", instanceId, method: "engine.execute", params: { command: "shape.rectangle" }, ttlMs: 13_000 }));
    await flush();
    expect(controlPosts(m)).toHaveLength(0);
    expect(results(sent)).toEqual([expect.objectContaining({ reqId: "r3", ok: false, code: "not-visible" })]);
  });

  it("closing the instance tells the server so pinned follow-ups answer not-open at once", async () => {
    stubFetch({ status: () => ({ vectorcraft: { status: "ok" } }) });
    const { m, sent } = await mountVector();
    cleanup();
    expect(sent.some((s) => s.type === CONTROL_GONE)).toBe(true);
    void m;
  });
});

describe("E11 an agent edit stays unsaved (the shim's dirty:false cannot clear it)", () => {
  it("through the frame: edit → unsaved; shim dirty:false → still unsaved; an own-file save acknowledged with no later edit → clean", async () => {
    const { m, ws, sent, fh } = await mountVector();
    // the app reported clean first
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(fh.setDirty).toHaveBeenLastCalledWith(false);
    act(() => ws.emit(probeFrame()));
    const instanceId = (sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>).instanceId as string;
    act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId: "r1", instanceId, method: "engine.execute", params: { command: "shape.rectangle" }, ttlMs: 13_000 }));
    await flush();
    expect(fh.setDirty).toHaveBeenLastCalledWith(true); // set when FORWARDED
    await shimSend(m.iframe, { type: "control-result", id: controlPosts(m)[0].id, ok: true, result: { id: 4 } });
    await shimSend(m.iframe, { type: "dirty", value: false });
    expect(fh.setDirty).toHaveBeenLastCalledWith(true);
    // own-file save (same stem, .svg): acknowledged → clean
    await shimSend(m.iframe, { type: "save", suggestedName: "a.svg", bytes: bytesOf(4), msSinceInput: 10 });
    await flush();
    expect(fh.setDirty).toHaveBeenLastCalledWith(false);
  });

  it("an agent ok between the save message and the ack keeps it unsaved", async () => {
    const { m, ws, sent, fh } = await mountVector();
    act(() => ws.emit(probeFrame()));
    const instanceId = (sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>).instanceId as string;
    const edit = async (reqId: string) => {
      act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId, instanceId, method: "engine.execute", params: { command: "shape.rectangle" }, ttlMs: 13_000 }));
      await flush();
    };
    await edit("r1");
    await shimSend(m.iframe, { type: "control-result", id: controlPosts(m)[0].id, ok: true, result: {} });
    // the save is held open by core (a slow overwrite) while the agent edits again
    let release: (v: unknown) => void = () => undefined;
    fh.save.mockImplementationOnce(() => new Promise((r) => void (release = r)) as never);
    await shimSend(m.iframe, { type: "save", suggestedName: "a.svg", bytes: bytesOf(4), msSinceInput: 10 });
    await edit("r2");
    await shimSend(m.iframe, { type: "control-result", id: controlPosts(m)[1].id, ok: true, result: {} });
    release({ ok: true, path: "a.svg", mtime: 2, sha1: "bb" });
    await flush();
    expect(fh.setDirty).toHaveBeenLastCalledWith(true);
  });
});

describe("E13 save records read back through host.state", () => {
  it("a sibling save with the dialog open is pending; created → outcome sibling; the tab stays unsaved", async () => {
    const { m, ws, sent, fh } = await mountVector();
    act(() => ws.emit(probeFrame()));
    const instanceId = (sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>).instanceId as string;
    const state = async (reqId: string, sinceSeq: number) => {
      act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId, instanceId, method: "host.state", params: { sinceSeq }, ttlMs: 13_000 }));
      await flush();
      return results(sent).find((r) => r.reqId === reqId)?.result as { saves: Array<Record<string, unknown>>; noSaveYet: boolean; unsaved: unknown };
    };
    expect(await state("s0", 0)).toMatchObject({ saves: [], noSaveYet: true });
    await shimSend(m.iframe, { type: "save", suggestedName: "a.vectorcraft", bytes: bytesOf(4), msSinceInput: 5 });
    await flush();
    expect(m.getByTestId("craft-sibling")).toBeTruthy();
    expect((await state("s1", 0)).saves).toMatchObject([{ seq: 1, pending: true }]);
    fireEvent.click(m.getByTestId("craft-sibling-create"));
    await flush();
    fh.save.mock.calls.at(-1);
    const after = await state("s2", 0);
    expect(after.saves).toMatchObject([{ seq: 1, pending: false, outcome: "sibling" }]);
    expect(after.unsaved).toBe(true);
    expect(controlPosts(m)).toHaveLength(0); // host.state never reached the frame
  });

  it("a cancelled in-app dialog sends no save message: noSaveYet", async () => {
    const { ws, sent } = await mountVector();
    act(() => ws.emit(probeFrame()));
    const instanceId = (sent.find((s) => s.type === CONTROL_CLAIM) as Record<string, unknown>).instanceId as string;
    act(() => ws.emit({ type: CONTROL_RUN, sessionId: "S", reqId: "s", instanceId, method: "host.state", params: { sinceSeq: 0 }, ttlMs: 13_000 }));
    await flush();
    expect(results(sent)[0].result).toMatchObject({ noSaveYet: true, saves: [] });
  });
});

describe("E14 agent export confirmation", () => {
  async function exportWith(msSinceInput: number | undefined, over: Parameters<typeof mountVector>[0] = {}) {
    const r = await mountVector(over);
    await shimSend(r.m.iframe, { type: "save", suggestedName: "a.pdf", bytes: bytesOf(4), ...(msSinceInput === undefined ? {} : { msSinceInput }) });
    await flush();
    return r;
  }

  it.each([1999, 2000])("msSinceInput %i downloads without asking", async (ms) => {
    const { m } = await exportWith(ms);
    expect(m.queryByTestId("craft-download-confirm")).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("msSinceInput 2001 asks first: Allow downloads, Block does not and answers the frame ok:false", async () => {
    const { m } = await exportWith(2001);
    expect(m.getByTestId("craft-download-confirm").textContent).toContain("a.pdf");
    expect(download).not.toHaveBeenCalled();
    fireEvent.click(m.getByTestId("craft-download-allow"));
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    expect(m.queryByTestId("craft-download-confirm")).toBeNull();

    cleanup();
    const blocked = await exportWith(5000);
    fireEvent.click(blocked.m.getByTestId("craft-download-block"));
    await flush();
    expect(download).toHaveBeenCalledTimes(1);
    const results = blocked.m.post.mock.calls.map((c) => c[0] as { type: string; ok: boolean }).filter((p) => p.type === "save-result");
    expect(results.at(-1)?.ok).toBe(false);
  });

  it("a v2 shim (no msSinceInput) and an app without control never prompt", async () => {
    const { m } = await exportWith(undefined);
    expect(m.queryByTestId("craft-download-confirm")).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);
    cleanup();
    stubFetch({});
    const word = await mountFrame({ fh: makeFh({ path: "docs/report.docx" }) });
    await openDoc(word);
    await shimSend(word.iframe, { type: "save", suggestedName: "report.pdf", bytes: bytesOf(4), msSinceInput: 99_999 });
    await flush();
    expect(word.queryByTestId("craft-download-confirm")).toBeNull();
    expect(download).toHaveBeenCalledTimes(2);
  });
});
