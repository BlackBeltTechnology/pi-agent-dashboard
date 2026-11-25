/**
 * Team owner recording (core amendment of add-agent-teams-ui): the host session's
 * `principalOwner` is an `{iss, sub}` object; core records `ownerKeyOf(it)` as
 * `Team.owner`, converts the key back to the object when it spawns for the host,
 * keeps it across a restart, and still loads teams persisted without an owner.
 * See change: add-agent-teams-ui.
 */
import { describe, expect, it } from "vitest";
import { createTeamsEnv } from "../../__tests__/harness/index.js";
import { ownerFromKey, ownerKeyFrom, ownerKeyOf } from "../../shared/owner-key.js";
import { narrowHostSession } from "../types.js";

const ALICE = { iss: "idp", sub: "alice" };

describe("owner key codec", () => {
  it("round-trips, and only real keys convert back", () => {
    expect(ownerFromKey(ownerKeyOf(ALICE))).toEqual(ALICE);
    for (const bad of ["owner-1", "", "[]", '["a"]', '["a",1]', '["a","b","c"]', '{"iss":"a","sub":"b"}', '[ "a", "b" ]']) expect(ownerFromKey(bad), bad).toBeUndefined();
    expect(ownerKeyFrom(ALICE)).toBe(ownerKeyOf(ALICE));
    expect(ownerKeyFrom("opaque")).toBe("opaque");
    expect(ownerKeyFrom({ iss: "a" })).toBeUndefined();
    expect(ownerKeyFrom(null)).toBeUndefined();
  });

  it("narrowHostSession no longer drops the object principalOwner", () => {
    expect(narrowHostSession({ cwd: "/w", principalOwner: ALICE })?.principalOwner).toBe(ownerKeyOf(ALICE));
    expect(narrowHostSession({ cwd: "/w" })?.principalOwner).toBeUndefined(); // ownerless / local operator / inert identity
    expect(narrowHostSession({ cwd: "/w", principalOwner: { iss: 1, sub: "x" } })?.principalOwner).toBeUndefined();
  });
});

describe("owner recording", () => {
  it("a team created by a lead whose session has a principalOwner object records its key", async () => {
    const e = createTeamsEnv();
    e.fake.addSession("S-alice", { cwd: "/work", principalOwner: ALICE as never });
    const res = await e.fake.call("S-alice", "TeamCreate", { name: "owned" });
    expect(e.rt.store.get(res.data.teamId)?.owner).toBe(ownerKeyOf(ALICE));
  });

  it("an ownerless lead (local operator / inert identity) leaves the team ownerless", async () => {
    const e = createTeamsEnv();
    e.fake.addSession("S-op", { cwd: "/work" });
    const res = await e.fake.call("S-op", "TeamCreate", { name: "plain" });
    expect(e.rt.store.get(res.data.teamId)?.owner).toBeUndefined();
  });

  it("a server-started lead binds with the object from the host ref (and keeps a set owner)", async () => {
    const e = createTeamsEnv();
    const created = e.rt.ops.createTeam({ name: "srv", leadCwd: "/work", mode: "session", starting: true } as never);
    const team = created.ok ? (created.data as { id: string }) : undefined;
    expect(team).toBeDefined();
    e.fake.addSession("S-srv", { cwd: "/work" });
    e.fake.resolveSession("S-srv", { "agent-teams": { teamId: (team as { id: string }).id, role: "lead" }, principalOwner: ALICE });
    expect(e.rt.store.get((team as { id: string }).id)?.owner).toBe(ownerKeyOf(ALICE));
  });

  it("a spawned teammate's pluginRef carries the {iss, sub} object again, never the key", async () => {
    const e = createTeamsEnv();
    e.fake.addSession("S-alice", { cwd: "/work", principalOwner: ALICE as never });
    await e.fake.call("S-alice", "TeamCreate", { name: "owned" });
    await e.fake.call("S-alice", "TeammateSpawn", { name: "bob", prompt: "go" });
    const ref = e.fake.base.spawns.at(-1)?.pluginRef as Record<string, unknown>;
    expect(ref.principalOwner).toEqual(ALICE);
  });

  it("a legacy opaque owner string is never handed to the host as principalOwner", async () => {
    const e = createTeamsEnv(); // harness lead session carries the opaque string "owner-1"
    const team = await e.createTeam();
    expect(team.owner).toBe("owner-1");
    await e.call("lead", "TeammateSpawn", { name: "bob", prompt: "go" });
    expect(e.fake.base.spawns.at(-1)?.pluginRef).not.toHaveProperty("principalOwner");
  });

  it("the owner round-trips through persistence; a team persisted without one still loads ownerless", async () => {
    const first = createTeamsEnv();
    first.fake.addSession("S-alice", { cwd: "/work", principalOwner: ALICE as never });
    const owned = await first.fake.call("S-alice", "TeamCreate", { name: "owned" });
    const legacy = await first.createTeam("legacy");
    delete legacy.owner;
    first.rt.store.patchTeam(legacy.id, { description: "persist" });
    first.fake.runShutdownHooks();

    const second = createTeamsEnv({ dataDir: first.fake.dataDir });
    expect(second.rt.store.get(owned.data.teamId)?.owner).toBe(ownerKeyOf(ALICE));
    const loaded = second.rt.store.get(legacy.id);
    expect(loaded).toBeDefined();
    expect(loaded?.owner).toBeUndefined();
  });
});
