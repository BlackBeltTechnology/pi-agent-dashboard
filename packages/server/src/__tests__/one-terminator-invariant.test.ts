/**
 * One terminator behind every server-initiated kill (test-plan #E35).
 *
 * Static scan: the reaper injection, the automation stop binding and
 * `shutdownSession` resolve through `terminate(`, and none of them reaches the
 * headless registry's `killBySessionId`/`killByToken` directly (only the
 * terminator itself does).
 *
 * @structural-pin one-terminator rule: every server-initiated kill site must resolve through the shared terminator; a code-shape fact, not behaviour
 *
 * See change: fix-session-reclaim-tmux.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(here, "..", rel), "utf-8");

/** Slice of `src` from the first `start` marker to the first `end` marker after it. */
function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `marker not found: ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a);
  expect(b, `marker not found: ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

const BARE_REGISTRY_KILL = /headlessPidRegistry\.(killBySessionId|killByToken)\s*\(/;

describe("one terminator invariant", () => {
  it("the reaper injection and the automation binding resolve through the shared terminator", () => {
    const server = read("server.ts");
    const reaperSite = between(server, "createEmbedLifecycleController({", "// Serve static files");
    expect(reaperSite).toContain("terminate(");
    expect(reaperSite).not.toMatch(BARE_REGISTRY_KILL);
    expect(reaperSite).not.toMatch(/\.killBySessionId\s*\(/);

    const abortSite = between(server, "abortSpawnedRun: async (args)", "registerCwdPolicy");
    expect(abortSite).toContain("abortSpawnedRunImpl(");
    expect(abortSite).not.toMatch(BARE_REGISTRY_KILL);
    expect(abortSite).not.toMatch(/\.killBy(SessionId|Token)\s*\(/);

    const wiring = between(server, "createAbortSpawnedRun({", "createEmbedLifecycleController({");
    expect(wiring).toContain("sessionTerminator.terminate");
  });

  it("abort-spawned-run.ts and shutdownSession only call terminate()", () => {
    const abort = read("spawn-process/abort-spawned-run.ts");
    expect(abort).toContain("deps.terminate(");
    expect(abort).not.toMatch(/killBy(SessionId|Token)/);

    const handler = read("browser-handlers/session-action-handler.ts");
    const shutdown = between(handler, "export async function shutdownSession", "export function handleAbort");
    expect(shutdown).toContain("terminate(");
    expect(shutdown).not.toMatch(/headlessPidRegistry\.killBy(SessionId|Token)\s*\(/);
  });
});
