import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { addServer, listServers, removeServer, type KeyringEntry } from "./keyring.js";

function entry(id: string): KeyringEntry {
  return {
    id,
    label: `server-${id}`,
    urls: [`https://${id}.share.zrok.io`],
    pinnedPubkey: "pubkey-" + id,
    pinnedFingerprint: id,
    bearerToken: "bearer-" + id,
  };
}

describe("keyring", () => {
  beforeEach(async () => {
    for (const e of await listServers()) await removeServer(e.id);
  });

  it("adds and lists a server", async () => {
    await addServer(entry("sha256:aaa"));
    const list = await listServers();
    expect(list).toHaveLength(1);
    expect(list[0].bearerToken).toBe("bearer-sha256:aaa");
    expect(list[0].urls).toEqual(["https://sha256:aaa.share.zrok.io"]);
  });

  it("upserts by id", async () => {
    await addServer(entry("sha256:bbb"));
    await addServer({ ...entry("sha256:bbb"), label: "renamed" });
    const list = await listServers();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("renamed");
  });

  it("removes a server", async () => {
    await addServer(entry("sha256:ccc"));
    await addServer(entry("sha256:ddd"));
    await removeServer("sha256:ccc");
    const list = await listServers();
    expect(list.map((e) => e.id)).toEqual(["sha256:ddd"]);
  });

  // See change: device-key-mutual-check (X13).
  it("round-trips an entry with a device key, and still loads one without", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
    await addServer({ ...entry("sha256:kkk"), deviceKey: { pub: "P".repeat(43), privateKey: pair.privateKey } });
    await addServer(entry("sha256:nnn"));
    const list = await listServers();
    const withKey = list.find((e) => e.id === "sha256:kkk");
    const without = list.find((e) => e.id === "sha256:nnn");
    expect(withKey?.deviceKey?.pub).toBe("P".repeat(43));
    expect(withKey?.deviceKey?.privateKey.type).toBe("private");
    expect(withKey?.deviceKey?.privateKey.extractable).toBe(false);
    expect(without?.deviceKey).toBeUndefined();
    expect(without?.bearerToken).toBe("bearer-sha256:nnn");
  });

  it("survives a fresh store handle (persisted across reload)", async () => {
    await addServer(entry("sha256:eee"));
    // A second listServers() opens a new IDB connection — simulates reload.
    const reloaded = await listServers();
    expect(reloaded.map((e) => e.id)).toContain("sha256:eee");
  });
});
