/**
 * `shutdownHeadlessProcesses` awaits the registry's async `killAll` and
 * forwards the stop's exit intent; `server.ts` `stop()` awaits it with the
 * recorded intent. See change: guard-restored-headless-identity (test-plan X4, X5).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const stubPi = () =>
  ({ start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() }) as unknown as PiGateway;

describe("shutdownHeadlessProcesses", () => {
  it("X4: returns a promise that settles only after killAll, forwarding the intent (absent ⇒ null)", async () => {
    const gw = createBrowserGateway(createMemorySessionManager(), createMemoryEventStore(() => false), stubPi());
    let release!: () => void;
    const killAll = vi.spyOn(gw.headlessPidRegistry, "killAll").mockImplementation(
      () => new Promise<void>((r) => { release = r; }),
    );
    let done = false;
    const p = gw.shutdownHeadlessProcesses({ exitIntent: "idle" }).then(() => { done = true; });
    await new Promise((r) => setImmediate(r));
    expect(done).toBe(false);
    expect(killAll).toHaveBeenCalledWith({ exitIntent: "idle" });
    release();
    await p;
    expect(done).toBe(true);

    killAll.mockResolvedValue(undefined);
    await gw.shutdownHeadlessProcesses();
    expect(killAll).toHaveBeenLastCalledWith({ exitIntent: null });
  });

  /**
   * @structural-pin no stop() harness exists; the awaited call with the recorded intent is a placement fact in server.ts
   */
  it("X5: server stop() awaits shutdownHeadlessProcesses with the recorded intent (default idle)", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "server.ts"), "utf-8");
    expect(src).toContain('await browserGateway.shutdownHeadlessProcesses({ exitIntent: opts.exitIntent ?? "idle" })');
    expect(src).toContain('recordExitIntent(opts.exitIntent ?? "idle")');
  });
});
