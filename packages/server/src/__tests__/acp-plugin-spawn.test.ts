/**
 * Plugin spawn hook validation with `agent`; plugin sendToSession slash text.
 * See change: add-acp-session-driver (test-plan #E51, #E54).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validatePluginAcpSpawn } from "../spawn-process/acp-spawn.js";

let home: string;
let orig: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "acp-plug-"));
  orig = process.env.HOME as string;
  process.env.HOME = home;
  fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
  fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify({ acpAgents: [{ id: "qmt", name: "q", command: "q" }] }));
});
afterEach(() => {
  process.env.HOME = orig;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("validatePluginAcpSpawn (E51)", () => {
  it("no agent → nothing to validate (pi spawn untouched)", () => {
    expect(validatePluginAcpSpawn({ scope: { tools: ["read"] }, model: "m" })).toBeUndefined();
  });
  it("known agent with only portable options → accepted", () => {
    expect(validatePluginAcpSpawn({ agent: "qmt" })).toBeUndefined();
  });
  it("pi-only options with agent are rejected, naming them", () => {
    expect(validatePluginAcpSpawn({ agent: "qmt", scope: { tools: ["read"] } })).toMatch(/scope/);
    expect(validatePluginAcpSpawn({ agent: "qmt", resume: { sessionFile: "/x" } })).toMatch(/resume/);
    expect(validatePluginAcpSpawn({ agent: "qmt", model: "m" })).toMatch(/model/);
    expect(validatePluginAcpSpawn({ agent: "qmt", scope: {}, model: "m" })).toMatch(/scope, model/);
  });
  it("unknown agent → rejected", () => {
    expect(validatePluginAcpSpawn({ agent: "nope" })).toMatch(/Unknown ACP agent/);
  });
});

describe("sendToSession slash text (E54)", () => {
  it("the host hook always sends a plain send_prompt — no extension-command dispatch — and the adapter passes '/review' to the agent", async () => {
    // Host side (server.ts): `sendToSession: (id, text) => piGateway.sendToSession(id, {type:"send_prompt", sessionId:id, text})`.
    // Adapter side: send_prompt text is forwarded verbatim in the session/prompt block.
    const { makeHarness, startReady } = await import("../acp-bridge/__tests__/adapter-harness.js");
    const h = makeHarness({ protocol: 1 });
    await startReady(h);
    h.send({ type: "send_prompt", text: "/review" } as never);
    await h.waitFor(() => h.received().some((m) => m.method === "session/prompt"));
    expect(h.received().find((m) => m.method === "session/prompt")?.params.prompt).toEqual([{ type: "text", text: "/review" }]);
    expect(h.sent.some((m) => m.type === ("dispatch_extension_command" as never))).toBe(false);
    await h.adapter.stop();
  });
});
