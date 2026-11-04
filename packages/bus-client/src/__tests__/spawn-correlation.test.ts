/**
 * A1 — exact spawn correlation.
 * Exemplar: packages/shared/src/__tests__/spawn-session-attach-proposal.test.ts
 * Triple: spawn mints requestId=X, server echoes spawnRequestId=X + a decoy ·
 * spawn resolves on X only, ignores the decoy (test-plan #A1).
 */
import { afterEach, describe, expect, it } from "vitest";
import { BusClient } from "../client.js";
import {
  makeSession,
  startMockServer,
  type MockServer,
} from "./support/mock-server.js";
import type { SpawnSessionBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";

let server: MockServer;
afterEach(async () => {
  await server?.close();
});

describe("spawn correlation (A1)", () => {
  it("resolves with the session whose spawnRequestId matches, ignoring a decoy", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    const pending = client.spawn({ cwd: "/proj" });
    const sent = await server.waitForMessage<SpawnSessionBrowserMessage>(
      (m) => m.type === "spawn_session",
    );
    const reqId = sent.requestId;
    expect(reqId).toBeTruthy();

    // Headless strategy acks the spawn on spawn_result (requestId echoed).
    server.push({ type: "spawn_result", cwd: "/proj", success: true, message: "ok", requestId: reqId });
    // Decoy first (different requestId) — must be ignored.
    server.push({
      type: "session_added",
      session: makeSession("decoy", "active"),
      spawnRequestId: "some-other-id",
    });
    // The correlated one.
    server.push({
      type: "session_added",
      session: makeSession("real", "active"),
      spawnRequestId: reqId,
    });

    await expect(pending).resolves.toBe("real");
    client.close();
  });

  it("fails fast on an explicit spawn_result failure instead of timing out", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();

    const pending = client.spawn({ cwd: "/missing", timeout: 10_000 });
    const sent = await server.waitForMessage<SpawnSessionBrowserMessage>(
      (m) => m.type === "spawn_session",
    );
    server.push({
      type: "spawn_result",
      cwd: "/missing",
      success: false,
      message: "directory missing",
      code: "DIR_MISSING",
      requestId: sent.requestId,
    });

    await expect(pending).rejects.toThrow(/session start failed: directory missing \(DIR_MISSING\)/);
    client.close();
  });
});

// test-plan #E23, #E24 — see change: add-spawn-model-choice.
describe("spawn model choice", () => {
  it("E23: model + thinkingLevel ride the spawn_session frame", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();
    const pending = client.spawn({ cwd: "/p", model: "@planning", thinkingLevel: "high", timeout: 5_000 });
    const sent = await server.waitForMessage<SpawnSessionBrowserMessage>((m) => m.type === "spawn_session");
    expect(sent).toMatchObject({ model: "@planning", thinkingLevel: "high" });
    server.push({ type: "spawn_result", cwd: "/p", success: true, message: "ok", requestId: sent.requestId });
    server.push({ type: "session_added", session: makeSession("s1", "active"), spawnRequestId: sent.requestId });
    await expect(pending).resolves.toBe("s1");
    client.close();
  });

  it("E24: choiceWarning reaches onWarning once; spawn still resolves the id", async () => {
    server = await startMockServer();
    const client = new BusClient({ host: "127.0.0.1", port: server.port });
    await client.connect();
    const warnings: string[] = [];
    const pending = client.spawn({ cwd: "/p", model: "@ghost", onWarning: (w) => warnings.push(w), timeout: 5_000 });
    const sent = await server.waitForMessage<SpawnSessionBrowserMessage>((m) => m.type === "spawn_session");
    server.push({ type: "spawn_result", cwd: "/p", success: true, message: "ok", requestId: sent.requestId, choiceWarning: "w" });
    server.push({ type: "session_added", session: makeSession("s2", "active"), spawnRequestId: sent.requestId });
    await expect(pending).resolves.toBe("s2");
    expect(warnings).toEqual(["w"]);
    client.close();
  });
});
