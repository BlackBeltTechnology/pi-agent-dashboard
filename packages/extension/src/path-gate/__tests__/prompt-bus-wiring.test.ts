import { describe, expect, it } from "vitest";
import { PromptBus } from "../../prompt-bus.js";

describe("PromptBus.requestWithId (gate budget cancel)", () => {
  it("cancel(id) of a caller-chosen id resolves the request as cancelled", async () => {
    const bus = new PromptBus({ timeoutMs: -1 });
    const p = bus.requestWithId("gate-1", { pipeline: "command", type: "select", question: "q", options: ["a"] });
    expect(bus.pendingCount).toBe(1);
    bus.cancel("gate-1");
    expect(await p).toMatchObject({ id: "gate-1", cancelled: true });
    expect(bus.pendingCount).toBe(0);
  });

  it("respond(id) resolves with the answer; request() still mints a unique id", async () => {
    const bus = new PromptBus({ timeoutMs: -1 });
    const p = bus.requestWithId("gate-2", { pipeline: "command", type: "select", question: "q", options: ["a"] });
    bus.respond({ id: "gate-2", answer: "a", source: "t" });
    expect(await p).toMatchObject({ answer: "a" });
    const seen: string[] = [];
    const b2 = new PromptBus({ timeoutMs: -1, onDashboardRequest: (r) => seen.push(r.id) });
    b2.registerAdapter({ name: "x", onRequest: () => ({ component: { type: "t", props: {} } }), onResponse() {}, onCancel() {} });
    void b2.request({ pipeline: "command", type: "confirm", question: "q" });
    void b2.request({ pipeline: "command", type: "confirm", question: "q" });
    expect(new Set(seen).size).toBe(2);
  });
});
