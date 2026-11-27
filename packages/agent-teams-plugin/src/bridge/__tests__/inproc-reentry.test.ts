/**
 * The bridge entry is inert inside a subagent child (test-plan S57, design D9, task 6.1): a child loads every extension again in the
 * SAME process with its own `pi`; while the lead's bridge owns the process the second activation registers nothing and sends no hello.
 * Ownership (`process[Symbol.for("agent-teams.bridge")]`) is released by the OWNER's `session_shutdown`, so a reload / new / resume / fork
 * lets the fresh `ExtensionAPI` take over.
 * See change: add-agent-teams-in-process.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createHostEnv } from "../../__tests__/harness/inproc-host-env.js";
import activate, { BRIDGE_OWNER_KEY, claimBridgeOwnership } from "../index.js";

type Handler = (event: unknown, ctx: unknown) => unknown;

/** A minimal pi: records what an activation registers. */
function fakePi() {
  const handlers = new Map<string, Handler[]>();
  const tools: string[] = [];
  const bus = new Map<string, Array<(p: unknown) => void>>();
  return {
    handlers,
    tools,
    busSubscriptions: () => [...bus.keys()],
    pi: {
      on(event: string, handler: Handler) {
        handlers.set(event, [...(handlers.get(event) ?? []), handler]);
      },
      registerTool(def: { name: string }) {
        tools.push(def.name);
      },
      events: {
        on(name: string, fn: (p: unknown) => void) {
          bus.set(name, [...(bus.get(name) ?? []), fn]);
        },
        emit(name: string, payload: unknown) {
          for (const fn of bus.get(name) ?? []) fn(payload);
        },
      },
    },
    async shutdown(reason: string) {
      for (const h of handlers.get("session_shutdown") ?? []) await h({ reason }, {});
    },
  };
}

const owner = (): { pi?: unknown } | undefined => (process as unknown as Record<symbol, { pi?: unknown } | undefined>)[BRIDGE_OWNER_KEY];
afterEach(() => {
  delete (process as unknown as Record<symbol, unknown>)[BRIDGE_OWNER_KEY];
});

describe("S57 bridge entry inert inside a child", () => {
  it("the lead's activation registers; a child's activation in the same process registers nothing and subscribes to nothing", () => {
    const lead = fakePi();
    activate(lead.pi);
    expect(lead.tools.length).toBeGreaterThan(0);
    expect(lead.handlers.has("session_start")).toBe(true);
    const child = fakePi();
    activate(child.pi);
    expect(child.tools).toEqual([]);
    expect(child.handlers.size).toBe(0);
    expect(child.busSubscriptions()).toEqual([]);
    expect(owner()?.pi).toBe(lead.pi); // the child did not take the process over
  });

  it.each(["reload", "new", "resume", "fork", "quit"])("after the owner's session_shutdown (%s) the next activation owns the process and registers", async (reason) => {
    const lead = fakePi();
    activate(lead.pi);
    await lead.shutdown(reason);
    expect(owner()?.pi).toBeUndefined(); // released: no stale owner
    const next = fakePi();
    activate(next.pi);
    expect(next.tools.length).toBeGreaterThan(0);
    expect(owner()?.pi).toBe(next.pi);
  });

  it("a child's own session_shutdown never releases the lead's ownership", async () => {
    const lead = fakePi();
    activate(lead.pi);
    const child = fakePi();
    const holder = owner() as { pi?: unknown };
    expect(claimBridgeOwnership(child.pi, holder)).toBe(false);
    await child.shutdown("quit"); // a child that never claimed registered no handler; nothing to release
    expect(owner()?.pi).toBe(lead.pi);
  });

  it("children are stopped BEFORE the owner releases: in the gap between the lead's shutdown and the next activation no child exists", async () => {
    const env = createHostEnv();
    await env.start();
    await env.spawn("bob");
    const lead = fakePi();
    // The subagents extension's own session_shutdown handler stops every child; the bridge's release comes after it.
    lead.pi.on("session_shutdown", () => env.double.children.clear());
    activate(lead.pi);
    let childrenAtRelease = -1;
    const holder = owner() as { pi?: unknown };
    lead.pi.on("session_shutdown", () => {
      if (holder.pi === undefined) childrenAtRelease = env.double.children.size;
    });
    await lead.shutdown("reload");
    expect(holder.pi).toBeUndefined();
    expect(childrenAtRelease).toBe(0);
    expect(env.double.children.size).toBe(0);
  });

  it("a pi that already owns the process may claim again (same instance), and claimBridgeOwnership works on a private holder", () => {
    const holder: { pi?: unknown } = {};
    const a = fakePi();
    const b = fakePi();
    expect(claimBridgeOwnership(a.pi, holder)).toBe(true);
    expect(claimBridgeOwnership(a.pi, holder)).toBe(true);
    expect(claimBridgeOwnership(b.pi, holder)).toBe(false);
  });
});
