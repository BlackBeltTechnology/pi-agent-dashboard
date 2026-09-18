import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Binding, bindingKey } from "../../shared/types.js";
import { createBindingStore, createSpawnCorrelator } from "../routing.js";

let tmp: string;
let filePath: string;

function binding(over: Partial<Binding> = {}): Binding {
  return {
    platform: "discord",
    channelId: "c1",
    sessionId: "s1",
    cwd: "/repos/proj",
    boundBy: "u1",
    source: "spawn",
    createdAt: 1,
    ...over,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cg-routing-"));
  filePath = path.join(tmp, "nested", "bindings.json");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("createBindingStore", () => {
  it("load() is tolerant of a missing file", () => {
    const store = createBindingStore({ filePath });
    expect(() => store.load()).not.toThrow();
    expect(store.all()).toEqual([]);
  });

  it("load() is tolerant of a corrupt file", () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "{not json");
    const store = createBindingStore({ filePath });
    expect(() => store.load()).not.toThrow();
    expect(store.all()).toEqual([]);
  });

  it("E10: a second message reuses the same binding", () => {
    const store = createBindingStore({ filePath });
    store.load();
    const b = binding();
    store.set(b);
    expect(store.get(bindingKey(b))).toEqual(b);
    // second lookup for the same identity -> same binding, no new session
    expect(store.get(bindingKey({ platform: "discord", channelId: "c1" }))).toEqual(b);
  });

  it("E11: a new thread resolves an independent binding (distinct bindingKey)", () => {
    const store = createBindingStore({ filePath });
    store.load();
    const chan = binding();
    const thread = binding({ threadId: "t9", sessionId: "s2", cwd: "/repos/other" });
    expect(bindingKey(chan)).not.toBe(bindingKey(thread));
    store.set(chan);
    store.set(thread);
    expect(store.get(bindingKey(chan))?.sessionId).toBe("s1");
    expect(store.get(bindingKey(thread))?.sessionId).toBe("s2");
    expect(store.all()).toHaveLength(2);
  });

  it("X7: the store survives a reload from disk", () => {
    const first = createBindingStore({ filePath });
    first.load();
    first.set(binding());
    first.set(binding({ threadId: "t9", sessionId: "s2" }));

    const second = createBindingStore({ filePath });
    second.load();
    expect(second.all()).toHaveLength(2);
    expect(second.get(bindingKey({ platform: "discord", channelId: "c1" }))?.sessionId).toBe("s1");
    expect(
      second.get(bindingKey({ platform: "discord", channelId: "c1", threadId: "t9" }))?.sessionId,
    ).toBe("s2");
  });

  it("persists atomically with 0600 file / 0700 dir and supports remove()", () => {
    const store = createBindingStore({ filePath });
    store.load();
    store.set(binding());
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
    // no temp leftovers
    expect(fs.readdirSync(path.dirname(filePath))).toEqual(["bindings.json"]);

    store.remove(bindingKey({ platform: "discord", channelId: "c1" }));
    const reloaded = createBindingStore({ filePath });
    reloaded.load();
    expect(reloaded.all()).toEqual([]);
  });
});

describe("createSpawnCorrelator", () => {
  it("E8: a unique-cwd spawn correlates to its session", () => {
    const c = createSpawnCorrelator();
    c.expect("tok-1", { channelKey: "discord:c1:-", isDM: true, channelId: "c1", cwd: "/repos/proj", by: "u1" });
    expect(c.pending()).toEqual(["tok-1"]);
    expect(c.resolve("tok-1", "sess-1")).toEqual({
      channelKey: "discord:c1:-", channelId: "c1",
      isDM: true,
      cwd: "/repos/proj",
      by: "u1",
    });
    // consumed
    expect(c.pending()).toEqual([]);
    expect(c.resolve("tok-1", "sess-1")).toBe(false);
  });

  it("E9: two concurrent same-cwd spawns never cross-bind", () => {
    const c = createSpawnCorrelator();
    c.expect("tok-a", { channelKey: "discord:cA:-", isDM: true, channelId: "cA", cwd: "/repos/proj", by: "u1" });
    c.expect("tok-b", { channelKey: "discord:cB:-", isDM: true, channelId: "cB", cwd: "/repos/proj", by: "u2" });
    // resolved out of order, same cwd: correlation is by token, not cwd+recency
    expect(c.resolve("tok-b", "sess-b")).toEqual({
      channelKey: "discord:cB:-", channelId: "cB",
      isDM: true,
      cwd: "/repos/proj",
      by: "u2",
    });
    expect(c.resolve("tok-a", "sess-a")).toEqual({
      channelKey: "discord:cA:-", channelId: "cA",
      isDM: true,
      cwd: "/repos/proj",
      by: "u1",
    });
  });

  it("an unknown token resolves to false (no cwd fallback)", () => {
    const c = createSpawnCorrelator();
    c.expect("tok-a", { channelKey: "discord:cA:-", isDM: true, channelId: "cA", cwd: "/repos/proj", by: "u1" });
    expect(c.resolve("tok-unknown", "sess-x")).toBe(false);
    expect(c.pending()).toEqual(["tok-a"]);
  });

  it("X8: reject(token) drops a failed spawn so a later resolve returns false", () => {
    const c = createSpawnCorrelator();
    c.expect("tok-1", { channelKey: "discord:c1:-", isDM: true, channelId: "c1", cwd: "/repos/proj", by: "u1" });
    c.reject("tok-1");
    expect(c.pending()).toEqual([]);
    expect(c.resolve("tok-1", "sess-late")).toBe(false);
  });
});
