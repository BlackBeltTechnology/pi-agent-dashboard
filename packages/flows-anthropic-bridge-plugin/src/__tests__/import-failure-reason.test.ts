/**
 * E10 contract — the bridge's import-failure `reason` keeps the literal
 * `import failed:` prefix the client's hint matches on (D6c).
 *
 * A rename here must fail a test rather than silently degrade the Anthropic
 * peer hint into offering an install for an already-installed package.
 * See change: warn-missing-anthropic-messages-peer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const probeAll = vi.fn();

vi.mock("../peer-probe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../peer-probe.js")>();
  return { ...actual, probeAll: (...args: unknown[]) => probeAll(...args) };
});

describe("bridge import-failure reason", () => {
  beforeEach(() => {
    probeAll.mockReset();
  });

  it("emits a reason prefixed with `import failed:` when resolve succeeds but import throws", async () => {
    // Both peers resolve, and the anthropic-messages entry points at a path
    // that cannot be imported — the exact resolve-yes/import-no shape.
    probeAll.mockReturnValue({
      am: { ok: true, via: "pi-packages", entryPath: "/nonexistent/pi-anthropic-messages.mjs" },
      flows: { ok: true, via: "node" },
      bothPresent: true,
    });

    const activate = (await import("../bridge/index.js")).default;
    const emitted: Array<{ event: string; payload: any }> = [];
    await activate({
      pi: { on: () => {}, events: { listenerCount: () => 1 } },
      events: { emit: (event: string, payload: any) => emitted.push({ event, payload }) },
    });

    const status = emitted.filter((e) => e.event === "flows-anthropic-bridge:status").at(-1);
    expect(status).toBeTruthy();
    expect(status!.payload.status).toBe("waiting_peers");
    const am = status!.payload.peers["@pi/anthropic-messages"];
    expect(am.ok).toBe(false);
    expect(am.reason.startsWith("import failed:")).toBe(true);
  });
});
