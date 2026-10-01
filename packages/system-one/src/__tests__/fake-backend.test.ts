/**
 * Self-test for the fake backend helper (task 1.3).
 * See change: add-system-one-registry.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type FakeBackend, interceptOffMachine, startFakeBackend } from "./helpers/fake-backend.js";

let fake: FakeBackend | null = null;
afterEach(async () => {
  await fake?.close();
  fake = null;
});

describe("fake backend helper", () => {
  it("serves one scripted reply and counts the connection", async () => {
    fake = await startFakeBackend();
    fake.script({ kind: "answer", body: { model: "m", answers: {} } });
    const res = await fetch(fake.url, { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({ model: "m", answers: {} });
    expect(fake.connections).toBe(1);
    expect(fake.requests).toHaveLength(1);
  });

  it("interceptor records off-machine requests without sending them", async () => {
    const icpt = interceptOffMachine();
    try {
      await expect(fetch("https://api.typesafe.ai/v1/systemone", { method: "POST" })).rejects.toThrow(/intercepted/);
      expect(icpt.offMachine.map((r) => r.url)).toEqual(["https://api.typesafe.ai/v1/systemone"]);
    } finally {
      icpt.restore();
    }
  });
});
