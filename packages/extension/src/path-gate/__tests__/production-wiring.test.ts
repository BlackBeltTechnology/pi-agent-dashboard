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

function setup(opts: { configFile?: string; readConfig?: () => { enabled: boolean; timeoutSeconds: number }; ui?: any } = {}) {
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
    getSessionId: () => "S1",
    getPromptBus: () => bus,
    send: () => false,
    readConfig: opts.readConfig ?? (() => ({ enabled: true, timeoutSeconds: 120 })),
    configFile: opts.configFile,
    getCwd: () => cwd,
    getSessionDir: () => undefined,
    log: () => {},
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

describe("denial suppression is per session (review r8/B1)", () => {
  it("a denial in one session does not suppress the same directory after a session switch", async () => {
    const asked: string[] = [];
    const t = setup({
      ui: {
        select: async (q: string) => {
          asked.push(q);
          return asked.length === 1 ? "Deny" : "Allow once";
        },
      },
    });
    const call = () => t.gate.handler({ toolName: "read", toolCallId: "tc", input: { path: "/etc/hosts" } }, t.ctx);
    expect((await call())?.reason).toContain("denied");
    // still the same session: suppressed without a prompt
    expect((await call())?.reason).toContain("recently-denied");
    expect(asked).toHaveLength(1);
    // pi switches to another session in the same process: session_start fires
    t.gate.onSessionStart();
    expect(await call()).toBeUndefined(); // asked again (Allow once), not suppressed
    expect(asked).toHaveLength(2);
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
