/**
 * Generic `dashboard:commands-changed` seam: any plugin emits it, the core
 * bridge resends `commands_list`. Core holds no `flow:*` listener.
 * See change: update-flows-plugin (D4; test-plan E6, E7).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { EventEmitter } from "node:events";
import { COMMANDS_CHANGED_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/event-forward-declaration.js";
import { describe, expect, it } from "vitest";
import type { BridgeContext } from "../bridge-context.js";
import { registerCommandsChangedListener } from "../flow-event-wiring.js";

function makeBc(ready = true) {
  const emitter = new EventEmitter();
  const onChannels: string[] = [];
  const sent: Array<Record<string, unknown>> = [];
  const pi = {
    events: {
      on: (ch: string, h: (d: unknown) => void) => {
        onChannels.push(ch);
        emitter.on(ch, h);
        return () => emitter.off(ch, h);
      },
      emit: (ch: string, d: unknown) => emitter.emit(ch, d),
    },
    getCommands: () => [{ name: "deploy", source: "extension" }],
  };
  const bc = {
    pi,
    connection: { send: (m: Record<string, unknown>) => sent.push(m) },
    sessionId: "s1",
  } as unknown as BridgeContext;
  registerCommandsChangedListener(bc, () => ready);
  return { pi, sent, onChannels };
}

describe("dashboard:commands-changed (E6)", () => {
  it("resends commands_list once per signal and ignores the payload", () => {
    const { pi, sent } = makeBc();
    pi.events.emit(COMMANDS_CHANGED_CHANNEL, { x: 1 });
    pi.events.emit(COMMANDS_CHANGED_CHANNEL, undefined);
    expect(sent.filter((m) => m.type === "commands_list")).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain('"x":1');
    expect(sent.some((m) => m.type === "event_forward")).toBe(false);
    expect(sent[0]).toEqual({
      type: "commands_list",
      sessionId: "s1",
      commands: [{ name: "deploy", source: "extension" }],
    });
  });

  it("does nothing before the session is ready", () => {
    const { pi, sent } = makeBc(false);
    pi.events.emit(COMMANDS_CHANGED_CHANNEL, {});
    expect(sent).toEqual([]);
  });
});

describe("core holds no flow listener (E7)", () => {
  it("flow:rediscover / flow:complete trigger no resend without the flows plugin", () => {
    const { pi, sent, onChannels } = makeBc();
    pi.events.emit("flow:rediscover", {});
    pi.events.emit("flow:complete", { flowName: "r" });
    expect(sent).toEqual([]);
    expect(onChannels.filter((c) => c.startsWith("flow:"))).toEqual([]);
  });

  it("no core extension module subscribes a flow: channel", () => {
    const src = path.resolve(import.meta.dirname, "..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "__tests__") walk(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
          for (const m of fs.readFileSync(p, "utf8").matchAll(/\bevents\.on\(\s*["'`](flow:[^"'`]*)/g)) {
            hits.push(`${path.relative(src, p)}: ${m[1]}`);
          }
        }
      }
    };
    walk(src);
    expect(hits).toEqual([]);
  });
});
