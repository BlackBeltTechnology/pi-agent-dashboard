/**
 * Source-text contract for the bridge's two LIVE replay sites (onReconnect in
 * `bridge.ts`, session_start in `bridge-handlers/lifecycle.ts`). The bridge
 * module is not instantiable under a unit test (live WS, timers) — same
 * structural-pin approach as `terminal-reload.test.ts` (E6).
 *
 * - each live site decides `liveTailOpen` via `isLive(...)` and passes it to
 *   the replay, so in-flight calls are not given a fabricated end;
 * - each site's synthetic reconnect `agent_start` carries `synthetic: true`,
 *   so the server's end-of-session scan can see past it (test-plan #E10).
 *
 * @structural-pin bridge.ts / lifecycle.ts cannot be instantiated in a test; the live-replay option and synthetic agent_start marker are pinned in their text, with the behaviour covered by session-sync.test.ts and the server open-tool-calls tests
 * See change: fix-replay-fabricates-orphan-end-for-live-calls (D3, D4).
 */
import { describe, expect, it } from "vitest";
import { readBridgeSource } from "./helpers/bridge-source.js";

function region(src: string, startMarker: string, endMarker: string): string {
  const start = src.indexOf(startMarker);
  expect(start, `start marker not found: ${startMarker}`).toBeGreaterThan(-1);
  const end = src.indexOf(endMarker, start + startMarker.length);
  expect(end, `end marker not found: ${endMarker}`).toBeGreaterThan(-1);
  return src.slice(start, end);
}

const RECONNECT = region(readBridgeSource("bridge.ts"), "onReconnect: safe(() => {", "refreshUiModules(");
const SESSION_START = (() => {
  const src = readBridgeSource("bridge-handlers/lifecycle.ts");
  return region(src, 'pi.on("session_start"', "// Send initial commands list");
})();

it("E16: reconnect passes the shared liveTailOpen to sendStateSync", () => {
  expect(RECONNECT).toMatch(/sendStateSync\(\{\s*liveTailOpen\s*\}\)/);
});

it("E16: session_start register carries the shared liveTailOpen", () => {
  const registerMsg = region(SESSION_START, 'type: "session_register"', "usageSeed");
  expect(registerMsg).toMatch(/\bliveTailOpen,/);
});

describe.each([
  ["onReconnect (bridge.ts)", RECONNECT],
  ["session_start (lifecycle.ts)", SESSION_START],
])("%s", (_name, body) => {
  it("replays with liveTailOpen decided by isLive(...)", () => {
    expect(body).toMatch(/const liveTailOpen\s*=\s*isLive\(/);
    expect(body).toMatch(/replaySessionEntries\(\{\s*liveTailOpen\s*\}\)/);
  });

  // test-plan #E16: the register's `liveTailOpen` and the replay's are ONE value.
  it("E16: decides isLive once and shares it between the register and the replay", () => {
    expect(body.match(/isLive\(/g)).toHaveLength(1);
  });

  it("marks the synthetic reconnect agent_start (test-plan #E10)", () => {
    expect(body).toMatch(/type:\s*"agent_start",\s*synthetic:\s*true/);
    expect(body).not.toMatch(/\{\s*type:\s*"agent_start"\s*\}/);
  });

  it("sends the synthetic agent_start after replay_complete", () => {
    const replay = body.indexOf("replaySessionEntries(");
    const complete = body.indexOf('type: "replay_complete"');
    const start = body.search(/type:\s*"agent_start",\s*synthetic/);
    expect(replay).toBeGreaterThan(-1);
    expect(replay).toBeLessThan(complete);
    expect(complete).toBeLessThan(start);
  });
});
