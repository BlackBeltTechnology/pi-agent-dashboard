/**
 * P2 — unknown pluginId errors clearly.
 * Triple: plugin("<unknown>",…) with no handler · send · explicit "no handler for
 * pluginId: <unknown>" error (test-plan #P2).
 * flows/kb/automation are now KNOWN handlers (change:
 * fix-plugin-action-fanout-and-handlers), so this uses a pluginId with no
 * registered handler to keep exercising the guard.
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import { NoPluginHandlerError } from "../errors.js";
import { startMockServer, type MockServer } from "./support/mock-server.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("plugin unknown id (P2)", () => {
  it("throws NoPluginHandlerError for a pluginId with no working handler", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    expect(() => client.plugin("totally-unknown-plugin", "do-thing")).toThrow(NoPluginHandlerError);
    expect(() => client.plugin("totally-unknown-plugin", "do-thing")).toThrow(
      /no handler for pluginId: totally-unknown-plugin/,
    );

    // Nothing was sent — no silent drop, an explicit throw instead.
    expect(server.received.some((m) => m.type === "plugin_action")).toBe(false);
    client.close();
  });
});
