/**
 * Revert-detection for the D1 wiring.
 *
 * `bounded-startup.test.ts` proves the helper behaves; this proves `server.ts`
 * actually USES it. Without this, reverting just the `server.ts` wrapper would
 * leave the whole suite green.
 *
 * Asserted STATICALLY on the source rather than by booting a real server: a
 * full in-process boot leaves gateway sockets, plugin timers and keeper
 * handles alive, which stalls the vitest worker's exit (observed as a CI run
 * that never finishes). The behavioural half is covered by the helper suite.
 *
 * See change: fix-worktree-server-autostart-leak.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_TS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "server.ts"),
  "utf8",
);

const CLI_TS = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.ts"),
  "utf8",
);

describe("the standalone server process opts into the deadline", () => {
  it("cli.ts passes SERVER_STARTUP_DEADLINE_MS to start()", () => {
    expect(CLI_TS).toContain("SERVER_STARTUP_DEADLINE_MS");
    expect(CLI_TS).toMatch(/server\.start\(\{ deadlineMs: SERVER_STARTUP_DEADLINE_MS \}\)/);
  });
});

describe("server.start() is wired to runBoundedStartup", () => {
  it("imports the helper and runs the startup body through it", () => {
    expect(SERVER_TS).toContain('from "./lifecycle/bounded-startup.js"');
    expect(SERVER_TS).toMatch(/await runBoundedStartup\(\{/);
    expect(SERVER_TS).toMatch(/core: \(\) => server\._startCore\(\)/);
    // The deadline is opt-in: in-process callers get teardown only.
    expect(SERVER_TS).toMatch(/deadlineMs: opts\.deadlineMs \?\? null/);
  });

  it("keeps the startup body in a separate `_startCore` member", () => {
    expect(SERVER_TS).toMatch(/async _startCore\(\)/);
    expect(SERVER_TS).toMatch(/_startCore\(\): Promise<void>;/);
  });

  it("tears the gateway down FIRST, before either fastify listener", () => {
    const teardown = SERVER_TS.slice(
      SERVER_TS.indexOf("teardown: async () => {"),
      SERVER_TS.indexOf("async _startCore()"),
    );
    const gateway = teardown.indexOf("piGateway.stop()");
    const second = teardown.indexOf("secondFastify.close()");
    const main = teardown.indexOf("fastify.close()");

    expect(gateway).toBeGreaterThan(-1);
    expect(gateway).toBeLessThan(second);
    expect(second).toBeLessThan(main);
  });
});

// test-plan #X5 (archive-service-sessions-on-end): pending on-end archive
// timers must not outlive the server, and bridge teardown (which ends sessions
// → schedules) must happen BEFORE the sweeper latches. Asserted statically for
// the same reason as above. See change: archive-service-sessions-on-end.
describe("archiveSweeper.stop() runs after piGateway.stop() on both teardown paths", () => {
  it("start() failure teardown", () => {
    const teardown = SERVER_TS.slice(
      SERVER_TS.indexOf("teardown: async () => {"),
      SERVER_TS.indexOf("async _startCore()"),
    );
    const gateway = teardown.indexOf("piGateway.stop()");
    const sweeper = teardown.indexOf("archiveSweeper.stop()");
    expect(gateway).toBeGreaterThan(-1);
    expect(sweeper).toBeGreaterThan(gateway);
  });

  it("server stop()", () => {
    const stopStart = SERVER_TS.indexOf("homeRendezvous = null;\n      piGateway.stop();");
    expect(stopStart).toBeGreaterThan(-1);
    const stopBody = SERVER_TS.slice(stopStart, stopStart + 600);
    const gateway = stopBody.indexOf("piGateway.stop()");
    const sweeper = stopBody.indexOf("archiveSweeper.stop()");
    expect(sweeper).toBeGreaterThan(gateway);
  });

  it("wireEvents receives the sweeper", () => {
    const wire = SERVER_TS.slice(SERVER_TS.indexOf("  wireEvents({"));
    expect(wire.slice(0, wire.indexOf("\n  });")).includes("archiveSweeper,")).toBe(true);
  });
});
