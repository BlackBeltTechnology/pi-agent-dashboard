/**
 * L1 extension-wiring tests — test-plan #E31 (session scope + /guard-clear) and
 * the real pi hook wiring (input reset, message_end taint, tool_result rewrite).
 * A fake `pi` captures handlers; settings come from a temp agent dir.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import untrustedContentGuard from "../extension.js";

type Handler = (event: unknown, ctx: unknown) => unknown;

function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
  const pi = {
    on: (name: string, h: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
    registerCommand: (name: string, opts: { handler: (args: string, ctx: unknown) => Promise<void> }) =>
      commands.set(name, opts),
  };
  const emit = async (name: string, event: unknown, ctx: unknown = {}) => {
    let last: unknown;
    for (const h of handlers.get(name) ?? []) last = await h(event, ctx);
    return last;
  };
  return { pi, emit, commands };
}

let agentDir: string;
let cwd: string;
const savedEnv = process.env.PI_CODING_AGENT_DIR;

beforeEach(() => {
  agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "ucg-agent-"));
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ucg-cwd-"));
  process.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedEnv;
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(cwd, { recursive: true, force: true });
});

function writeSettings(dir: string, value: unknown) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ "untrusted-content-guard": value }));
}

async function boot(trusted = true) {
  const f = fakePi();
  untrustedContentGuard(f.pi as never);
  await f.emit("session_start", { type: "session_start" }, { cwd, isProjectTrusted: () => trusted });
  return f;
}

const confirmCtx = () => {
  const confirm = vi.fn(async () => true);
  return { ctx: { hasUI: true, ui: { confirm, notify: vi.fn() } }, confirm };
};

const webCall = { type: "message_end", message: { role: "assistant", content: [{ type: "toolCall", name: "web_search" }] } };

describe("extension wiring", () => {
  it("run scope: input of any source resets taint", async () => {
    const { emit } = await boot();
    await emit("message_end", webCall);
    const a = confirmCtx();
    await emit("tool_call", { toolName: "bash", input: { command: "ls" } }, a.ctx);
    expect(a.confirm).toHaveBeenCalledTimes(1);

    await emit("input", { type: "input", text: "next", source: "extension" });
    const b = confirmCtx();
    expect(await emit("tool_call", { toolName: "bash", input: {} }, b.ctx)).toBeUndefined();
    expect(b.confirm).not.toHaveBeenCalled();
  });

  it("#E31 session scope survives input; /guard-clear resets it", async () => {
    writeSettings(agentDir, { taintScope: "session" });
    const { emit, commands } = await boot();
    await emit("message_end", webCall);
    await emit("input", { type: "input", text: "next", source: "interactive" });

    const a = confirmCtx();
    await emit("tool_call", { toolName: "bash", input: {} }, a.ctx);
    expect(a.confirm).toHaveBeenCalledTimes(1);

    const notify = vi.fn();
    await commands.get("guard-clear")?.handler("", { ui: { notify } });
    expect(notify).toHaveBeenCalledWith("Untrusted-content taint cleared", "info");
    const b = confirmCtx();
    await emit("tool_call", { toolName: "bash", input: {} }, b.ctx);
    expect(b.confirm).not.toHaveBeenCalled();
  });

  it("rewrites an untrusted tool_result through the real hook", async () => {
    const { emit } = await boot();
    const out = (await emit("tool_result", {
      type: "tool_result",
      toolName: "stub_fetch",
      content: [{ type: "text", text: '<html><span style="display:none">x</span>ok</html>' }],
      details: { untrusted: true },
    })) as { content: Array<{ text: string }> };
    expect(out.content[0]?.text).toMatch(/^<<untrusted source="stub_fetch" id="\w{8}">>\n<html>ok<\/html>\n/);
    expect(out.content[0]?.text).toContain("[guard] 1 hidden span removed (html-display-none)");
  });

  it("ignores project settings of an untrusted project", async () => {
    writeSettings(path.join(cwd, ".pi"), { mode: "off" });
    const untrusted = await boot(false);
    await untrusted.emit("message_end", webCall);
    expect(await untrusted.emit("tool_call", { toolName: "bash", input: {} }, { hasUI: false })).toEqual(
      expect.objectContaining({ block: true }),
    );

    const trusted = await boot(true);
    await trusted.emit("message_end", webCall);
    expect(await trusted.emit("tool_call", { toolName: "bash", input: {} }, { hasUI: false })).toBeUndefined();
  });
});
