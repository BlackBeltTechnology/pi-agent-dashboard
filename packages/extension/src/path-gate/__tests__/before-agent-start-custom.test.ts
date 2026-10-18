/**
 * pi >= 1.2.0 fires `before_agent_start` for a custom-message run (the
 * dashboard Retry turn) with `messageType: "custom"` + `message` and NO `prompt`.
 * The path-gate capture reads `systemPromptOptions` only, so it must keep
 * capturing skills / context files on that turn.
 *
 * Covers test-plan row E21 (path-gate arm).
 * See change: update-pi-core-1-3-adopt-apis (design D2).
 */
import * as fs from "node:fs";
import os from "node:os";
import nodePath from "node:path";
import { describe, expect, it } from "vitest";
import { PromptBus } from "../../prompt-bus.js";
import { createPathGate } from "../index.js";
import { Suppression } from "../suppression.js";

function setup() {
  const cwd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), "pg-custom-cwd-")));
  // Outside cwd and outside the temp roots: a real directory in the source tree.
  const elsewhere = fs.realpathSync(nodePath.resolve(__dirname, "../../../.."));
  const gate = createPathGate({
    getSessionId: () => "S1",
    getPromptBus: () => new PromptBus({ timeoutMs: -1 }),
    send: () => false,
    readConfig: () => ({ enabled: true, timeoutSeconds: 120 }),
    getCwd: () => cwd,
    getSessionDir: () => undefined,
    log: () => {},
    suppression: new Suppression(),
  });
  return { gate, cwd, elsewhere, ctx: { hasUI: false, cwd } };
}

const customEvent = (systemPromptOptions: unknown) => ({
  type: "before_agent_start",
  messageType: "custom",
  message: { role: "custom", customType: "pi-dashboard:retry", content: "", display: false },
  systemPrompt: "body",
  systemPromptOptions,
});

describe("path-gate onBeforeAgentStart on a custom-message (Retry) start", () => {
  it("E21 does not throw and captures the skill dir so its files are in-root", async () => {
    const t = setup();
    const skillDir = nodePath.join(t.elsewhere, "src");
    const readOf = (file: string) => ({ toolName: "read", toolCallId: "tc", input: { path: nodePath.join(skillDir, file) } });
    // Control: before any capture the skill dir is outside every root (no UI → blocked).
    expect(await t.gate.handler(readOf("bridge.ts") as never, t.ctx as never)).toBeDefined();
    const req = readOf("index.ts");

    expect(() =>
      t.gate.onBeforeAgentStart(customEvent({ skills: [{ baseDir: skillDir }], contextFiles: [] }) as never),
    ).not.toThrow();

    expect(await t.gate.handler(req as never, t.ctx as never)).toBeUndefined();
    expect(t.gate.counters.inRoot).toBeGreaterThan(0);
    expect(t.gate.counters.inRoot).toBe(1);
  });
});
