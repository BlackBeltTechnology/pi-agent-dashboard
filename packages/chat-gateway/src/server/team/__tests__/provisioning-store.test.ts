/**
 * Plugin-owned workspace↔channel store (change: add-chat-gateway-team-controls).
 * Scenario: task 2.5 — atomic write, restart round-trip, no duplicate channels.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProvisioningStore } from "../provisioning-store.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempPath(name = "channels.json"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cg-store-"));
  tmpDirs.push(dir);
  return path.join(dir, name);
}

function record(over: Partial<Parameters<ReturnType<typeof createProvisioningStore>["upsert"]>[0]> = {}) {
  return {
    workspaceId: "ws_1",
    channelId: "c1",
    channelName: "A",
    accessSignature: "sig-a",
    active: true,
    ...over,
  };
}

describe("provisioning store", () => {
  it("round-trips every field through a restart", () => {
    const filePath = tempPath();
    const first = createProvisioningStore({ filePath });
    first.upsert(record());
    first.upsert(record({ workspaceId: "ws_2", channelId: "c2", channelName: "B", active: false }));

    const reloaded = createProvisioningStore({ filePath });
    reloaded.load();

    expect(reloaded.forWorkspace("ws_1")).toEqual(record());
    expect(reloaded.forWorkspace("ws_2")).toEqual(
      record({ workspaceId: "ws_2", channelId: "c2", channelName: "B", active: false }),
    );
    // Only the active binding is routable.
    expect([...reloaded.activeChannelMap()]).toEqual([["c1", "ws_1"]]);
  });

  it("writes the file 0600 with no leftover temp file", () => {
    const filePath = tempPath();
    const store = createProvisioningStore({ filePath });
    store.upsert(record());

    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    const siblings = fs.readdirSync(path.dirname(filePath));
    expect(siblings).toEqual([path.basename(filePath)]);
  });

  it("holds at most one channel per workspace — an upsert replaces", () => {
    const store = createProvisioningStore();
    store.upsert(record());
    store.upsert(record({ channelId: "c9" }));

    expect(store.all()).toHaveLength(1);
    expect(store.forWorkspace("ws_1")?.channelId).toBe("c9");
    expect(store.forChannel("c1")).toBeUndefined();
    expect(store.forChannel("c9")?.workspaceId).toBe("ws_1");
  });

  it("deactivate keeps the record but drops it from the routable map", () => {
    const store = createProvisioningStore();
    store.upsert(record());
    store.deactivate("ws_1");

    expect(store.forWorkspace("ws_1")?.active).toBe(false);
    expect(store.all()).toHaveLength(1);
    expect(store.activeChannelMap().size).toBe(0);
  });

  it("deactivate is a no-op for an unknown or already-inactive workspace", () => {
    const filePath = tempPath();
    const store = createProvisioningStore({ filePath });
    store.deactivate("nope"); // never written
    expect(fs.existsSync(filePath)).toBe(false);

    store.upsert(record({ active: false }));
    const before = fs.readFileSync(filePath, "utf8");
    store.deactivate("ws_1");
    expect(fs.readFileSync(filePath, "utf8")).toBe(before);
  });

  it("drop removes the record entirely", () => {
    const store = createProvisioningStore();
    store.upsert(record());
    store.drop("c1");
    expect(store.all()).toEqual([]);
    expect(store.forChannel("c1")).toBeUndefined();
  });

  it("hands out copies, so a caller cannot mutate stored state", () => {
    const store = createProvisioningStore();
    store.upsert(record());
    const view = store.forWorkspace("ws_1");
    if (view) view.channelName = "mutated";
    expect(store.forWorkspace("ws_1")?.channelName).toBe("A");
  });

  it("treats a missing file as empty", () => {
    const store = createProvisioningStore({ filePath: tempPath("absent.json") });
    store.load();
    expect(store.all()).toEqual([]);
  });

  it("treats a corrupt or malformed file as empty rather than crashing startup", () => {
    for (const content of ["{ not json", "[]", JSON.stringify({ bindings: "nope" }), "null"]) {
      const filePath = tempPath();
      fs.writeFileSync(filePath, content);
      const store = createProvisioningStore({ filePath });
      store.load();
      expect(store.all()).toEqual([]);
    }
  });

  it("skips individual malformed records but keeps the valid ones", () => {
    const filePath = tempPath();
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        bindings: [
          { workspaceId: "ws_1", channelId: "c1" }, // channelName/signature defaulted
          { workspaceId: "ws_2" }, // no channelId → dropped
          "nonsense",
        ],
      }),
    );
    const store = createProvisioningStore({ filePath });
    store.load();
    expect(store.all()).toEqual([
      {
        workspaceId: "ws_1",
        channelId: "c1",
        channelName: "",
        active: true,
        accessSignature: "",
      },
    ]);
  });
});
