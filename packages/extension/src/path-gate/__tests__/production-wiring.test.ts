/**
 * Production wiring of `createPathGate` (review B2/B4): the REAL PromptBus + the
 * REAL TUI adapter, and a config file toggled between calls.
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { createTuiPromptAdapter } from "../../tui-prompt-adapter.js";
import { PromptBus } from "../../prompt-bus.js";
import { createPathGate } from "../index.js";
import { Suppression } from "../suppression.js";

function setup(opts: { configFile?: string; readConfig?: () => { enabled: boolean; timeoutSeconds: number }; ui?: any; sid?: { v: string }; suppression?: Suppression; logs?: string[] } = {}) {
  const sid = opts.sid ?? { v: "S1" };
  const cwd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-wire-")));
  const bus = new PromptBus({ timeoutMs: -1 });
  const asked: Array<{ question: string; options: string[] }> = [];
  const ui = opts.ui ?? {
    select: async (question: string, options: string[]) => {
      asked.push({ question, options });
      return "Allow once";
    },
  };
  bus.registerAdapter(createTuiPromptAdapter(ui, bus));
  const gate = createPathGate({
    getSessionId: () => sid.v,
    getPromptBus: () => bus,
    send: () => false,
    readConfig: opts.readConfig ?? (() => ({ enabled: true, timeoutSeconds: 120 })),
    configFile: opts.configFile,
    getCwd: () => cwd,
    getSessionDir: () => undefined,
    log: (l) => { opts.logs?.push(l); },
    suppression: opts.suppression,
  });
  return { gate, cwd, asked, ctx: { hasUI: true, cwd } };
}

describe("TUI visibility (review B2)", () => {
  it("the terminal question names the path being approved", async () => {
    const t = setup();
    const r = await t.gate.handler({ toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } }, t.ctx);
    expect(r).toBeUndefined(); // TUI answered Allow once
    expect(t.asked).toHaveLength(1);
    expect(t.asked[0].question).toContain("/etc/hosts");
    expect(t.asked[0].question).toMatch(/outside its workspace/i);
    // review r2/B1: cwd and the withheld-Always note are part of what the terminal shows.
    expect(t.asked[0].question).toContain(`Session cwd: ${t.cwd}`);
    expect(t.asked[0].question).toMatch(/Always allow/);

  });
});

describe("denial suppression is scoped to the session that was asked (review r8/r9 B1)", () => {
  const mk = () => {
    const asked: string[] = [];
    const sid = { v: "S" };
    const t = setup({
      sid,
      ui: {
        select: async (q: string) => {
          asked.push(q);
          return asked.length === 1 ? "Deny" : "Allow once";
        },
      },
    });
    const call = () => t.gate.handler({ toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } }, t.ctx);
    return { asked, sid, t, call };
  };

  it("a denial in session S does not suppress the same directory in session T", async () => {
    const { asked, sid, call, t } = mk();
    expect((await call())?.reason).toContain("denied");
    expect((await call())?.reason).toContain("recently-denied");
    sid.v = "T";
    t.gate.onSessionStart();
    expect(await call()).toBeUndefined();
    expect(asked).toHaveLength(2);
  });

  it("a real /reload (NEW gate instance, same session, shared process-global map) keeps the denial", async () => {
    const shared = new Suppression();
    const asked: string[] = [];
    const ui = { select: async (q: string) => { asked.push(q); return "Deny"; } };
    const first = setup({ ui, suppression: shared });
    const req = { toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } };
    expect((await first.gate.handler(req, first.ctx))?.reason).toContain("denied");
    // pi /reload re-runs initBridge: a brand-new createPathGate, same session id
    const second = setup({ ui, suppression: shared });
    expect((await second.gate.handler(req, second.ctx))?.reason).toContain("recently-denied");
    expect(asked).toHaveLength(1);
  });

  it("an outstanding prompt of S that settles AFTER T started denies under S, never under T", async () => {
    const sid = { v: "S" };
    const resolvers: Array<(v: string) => void> = [];
    const asked: string[] = [];
    const logs: string[] = [];
    const t = setup({
      sid,
      logs,
      ui: {
        select: (q: string) => new Promise<string>((res) => { asked.push(q); resolvers.push(res); }),
      },
    });
    const call = () => t.gate.handler({ toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } }, t.ctx);
    const sCall = call(); // S asks and waits
    await new Promise((r) => setTimeout(r, 20));
    sid.v = "T";
    t.gate.onSessionStart();
    const tCall = call(); // T queues its OWN prompt (not behind S: per-session mutex)
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(2); // both prompts open concurrently, one per session
    resolvers[0]("Deny"); // S settles late → denial recorded under S
    expect((await sCall)?.reason).toContain("denied");
    // audit line names the session that was ASKED, not the live one
    expect(logs.some((l) => l.startsWith("[path-gate] denied") && l.includes("session=S "))).toBe(true);
    expect(logs.some((l) => l.startsWith("[path-gate] denied") && l.includes("session=T "))).toBe(false);
    // and the denial is recorded under S
    sid.v = "S";
    const sAgain = await call();
    expect(sAgain?.reason).toContain("recently-denied");
    sid.v = "T";
    resolvers[1]("Allow once"); // T's own prompt answered normally
    expect(await tCall).toBeUndefined();
    // and T is not suppressed by S's late denial
    const tAgain = call();
    await new Promise((r) => setTimeout(r, 20));
    expect(asked).toHaveLength(3);
    resolvers[2]("Allow once");
    expect(await tAgain).toBeUndefined();
  });
});

describe("config applies on the very next call (review B4)", () => {
  it("disabling then enabling the gate is effective immediately, even within one second", async () => {
    const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-cfg-"));
    const configFile = nodePath.join(dir, "config.json");
    const write = (enabled: boolean) => fs.writeFileSync(configFile, JSON.stringify({ agentPathGate: { enabled, timeoutSeconds: 120 } }));
    write(true);
    const read = () => JSON.parse(fs.readFileSync(configFile, "utf8")).agentPathGate;
    const t = setup({ configFile, readConfig: read });
    const call = () => t.gate.handler({ toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } }, t.ctx);

    await call();
    expect(t.asked).toHaveLength(1); // enabled → asked
    write(false);
    await call();
    expect(t.asked).toHaveLength(1); // disabled → no prompt, no block
    write(true);
    await call();
    expect(t.asked).toHaveLength(2); // enabled again → asked, same millisecond window
  });
});
