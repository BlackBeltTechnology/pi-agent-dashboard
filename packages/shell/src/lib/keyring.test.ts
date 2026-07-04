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

  it("survives a fresh store handle (persisted across reload)", async () => {
    await addServer(entry("sha256:eee"));
    // A second listServers() opens a new IDB connection — simulates reload.
    const reloaded = await listServers();
    expect(reloaded.map((e) => e.id)).toContain("sha256:eee");
  });
});
