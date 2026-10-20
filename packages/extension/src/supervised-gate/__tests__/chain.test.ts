/**
 * Supervised gate × the agent path gate in pi's REAL ExtensionRunner chain.
 * Test-plan: X18 (a path-gate block suppresses the supervised gate — first block
 * wins), X19 (a pending supervised approval never delays a path-gate YOLO answer).
 * See change: add-supervised-tool-approval (design D8, D14, D15).
 */
import nodePath from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPathGateHandler, type GatePrompter, type PathGateDeps } from "../../path-gate/handler.js";
import type { ResolveEnv } from "../../path-gate/resolve.js";
import { Suppression } from "../../path-gate/suppression.js";
import { flush, makeGate } from "./harness.js";

interface LoadedExt {
  path: string;
  handlers: Map<string, unknown[]>;
}
interface PiRuntime {
  createExtensionRuntime(): unknown;
  ExtensionRunner: new (e: LoadedExt[], rt: unknown, cwd: string, sm: unknown, mr: unknown) => {
    emitToolCall(event: unknown): Promise<{ block?: boolean; reason?: string } | undefined>;
  };
  SessionManager: { inMemory(cwd: string): unknown };
}

const env: ResolveEnv = {
  path: nodePath.posix,
  platform: "linux",
  homeDir: "/h",
  realpathSync: (p) => {
    if (["/", "/w", "/w/repo", "/w/other", "/h"].includes(p)) return p;
    throw new Error("ENOENT");
  },
  exists: () => false,
  isDirectory: () => false,
};

function pathGate(opts: { yolo?: PathGateDeps["yoloDecide"]; answers?: Array<string | undefined> } = {}) {
  const answers = [...(opts.answers ?? [])];
  const prompter: GatePrompter = {
    select: async () => answers.shift(),
    confirm: async () => false,
    cancel: () => {},
  };
  let n = 0;
  const deps: PathGateDeps = {
    getConfig: () => ({ enabled: true, timeoutSeconds: 120 }),
    getRoots: async (grants) => ({ workspace: ["/w/repo"], readOnly: [], readWrite: [], grants }),
    getGrants: () => [],
    getSensitiveDirs: () => [],
    isUngrantable: () => false,
    prompter,
    grantStoreMatch: () => true,
    requestGrant: async () => ({ ok: true }),
    yoloSupported: () => !!opts.yolo,
    yoloDecide: opts.yolo,
    log: () => {},
    sessionId: () => "S1",
    env,
    newId: () => `pg${++n}`,
    suppression: new Suppression(),
  };
  return createPathGateHandler(deps);
}

async function runner(handlers: unknown[]) {
  const pi = (await import("@earendil-works/pi-coding-agent")) as unknown as PiRuntime;
  const ext: LoadedExt = { path: "inline", handlers: new Map([["tool_call", handlers]]) };
  return new pi.ExtensionRunner([ext], pi.createExtensionRuntime(), "/w/repo", pi.SessionManager.inMemory("/w/repo"), {});
}

describe("handler chain (real ExtensionRunner)", () => {
  it("#X18 a path-gate block (no UI) suppresses the supervised gate: first block wins, supervised never invoked", async () => {
    const sup = makeGate();
    const supSpy = vi.fn(sup.gate.handler);
    const pg = pathGate();
    const r = await runner([(e: never, c: never) => pg(e, c), supSpy]);
    // the runner builds its own ctx; pass the path gate what it needs via the event path + a ctx shim
    const res = await r.emitToolCall({ type: "tool_call", toolName: "edit", toolCallId: "t1", input: { path: "/w/other/x.txt", edits: [] } });
    // the real ctx.hasUI is false (no UI bound) → the path gate blocks out-of-root with no-ui
    expect(res).toMatchObject({ block: true });
    expect(res?.reason).toMatch(/^path-gate: no-ui/);
    expect(supSpy).not.toHaveBeenCalled();
    expect(sup.prompter.reqs).toHaveLength(0);
  });

  it("#X18b an in-root call passes the path gate and reaches the supervised gate (a prompt, then block on Deny)", async () => {
    const sup = makeGate();
    const pg = pathGate();
    // give the supervised handler a UI-bearing ctx (the runner's own ctx has none)
    const supHandler = (e: never) => sup.gate.handler(e, sup.ctx());
    const r = await runner([(e: never, c: never) => pg(e, c), supHandler]);
    const p = r.emitToolCall({ type: "tool_call", toolName: "edit", toolCallId: "t2", input: { path: "/w/repo/x.txt", edits: [] } });
    await flush();
    expect(sup.prompter.reqs).toHaveLength(1);
    sup.prompter.answer("Deny");
    expect(await p).toEqual({ block: true, reason: "supervised: denied" });
  });

  it("#X19 a pending supervised approval does not delay a path-gate YOLO answer", async () => {
    const sup = makeGate();
    let yoloAsked = 0;
    const pg = pathGate({
      yolo: async () => {
        yoloAsked++;
        return "auto-allow";
      },
    });
    // session S1: a supervised approval is pending (holds the supervised mutex)
    const pending = sup.call("bash", { command: "sleep 100" }, "pend");
    await flush();
    expect(sup.prompter.reqs).toHaveLength(1);
    // meanwhile the path gate (which runs BEFORE the supervised gate) asks YOLO for another call
    const res = await pg(
      { toolName: "write", toolCallId: "t3", input: { path: "/w/other/f.txt", content: "x" } },
      { hasUI: true, cwd: "/w/repo" },
    );
    expect(yoloAsked).toBe(1); // opened immediately, not queued behind the supervised mutex
    expect(res).toBeUndefined(); // YOLO auto-allow
    expect(sup.prompter.isPending(0)).toBe(true);
    sup.prompter.answer("Deny");
    await pending;
  });
});
