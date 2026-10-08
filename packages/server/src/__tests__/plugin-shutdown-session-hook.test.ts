/**
 * `ServerPluginContext.shutdownSession` — the plugin hook behind the Chat
 * Gateway's `!close`. It MUST reuse `browserGateway.shutdownSession` (the one
 * body the browser `shutdown` message and `POST /api/session/:id/shutdown`
 * share — manual-close liveness + any-strategy kill), never a parallel
 * `{type:"shutdown"}` send (#449/#452), and MUST be trust-gated like
 * `abortSession`. See change: chat-gateway-close-command.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = readFileSync(path.resolve(here, "..", "server.ts"), "utf8");

describe("plugin shutdownSession hook", () => {
  const block = serverSrc.slice(serverSrc.indexOf("shutdownSession: async (sessionId)"));

  it("server wiring is trust-gated and delegates to browserGateway.shutdownSession", () => {
    expect(block.length).toBeGreaterThan(0);
    const body = block.slice(0, 700);
    expect(body).toMatch(/\(plugin\.manifest\.priority \?\? 1000\) <= 100/);
    expect(body).toMatch(/if \(!trusted\) return false;/);
    expect(body).toMatch(/await browserGateway\.shutdownSession\(sessionId\)/);
    expect(body).not.toMatch(/type: "shutdown"/);
  });

  it("unknown sessions are refused before any shutdown", () => {
    expect(block.slice(0, 700)).toMatch(/if \(!sessionManager\.get\(sessionId\)\) return false;/);
  });

  it("the runtime context exposes the hook, defaulting to a refusing no-op", () => {
    const ctxSrc = readFileSync(
      path.resolve(here, "../../../dashboard-plugin-runtime/src/server/server-context.ts"),
      "utf8",
    );
    expect(ctxSrc).toMatch(/shutdownSession: deps\.shutdownSession \?\? \(async \(\) => false\)/);
  });
});
