/**
 * Lead stamp (test-plan S44, S45, S51, S52, S113, S114): `agent-teams-lead:{teamId}`
 * written through `assignSessionRef(…, {persist:true})` on core's store events and
 * recomputed idempotently from the store's live teams. The fake host applies the
 * REAL host merge/sanitize/projection functions, so what is asserted is what the
 * session list would carry, including the JSON round trip.
 * @structural-pin reads the host's pending-ref registry source: the reserved-key list is the contract under test
 * See change: add-agent-teams-ui.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createFakeUiHost, type FakeUiHost } from "../../__tests__/harness/fake-ui-host.js";
import { createTeamsEnv, type TeamsEnv } from "../../__tests__/harness/index.js";
import { LEAD_STAMP_KEY } from "../../shared/ui-protocol.js";
import { createUiBridge, type UiBridge } from "../ui-bridge.js";

const bridges: UiBridge[] = [];
afterEach(() => {
  for (const b of bridges.splice(0)) b.dispose();
});

function mk(over: { env?: TeamsEnv; host?: FakeUiHost } = {}) {
  const e = over.env ?? createTeamsEnv();
  const h = over.host ?? createFakeUiHost();
  const bridge = createUiBridge({ store: e.rt.store, host: h.host, epoch: "E", clock: e.clock, logger: e.fake.host.logger });
  bridges.push(bridge);
  return { e, h, bridge };
}
const teamId = (stamp: unknown): unknown => (stamp as { teamId?: unknown } | undefined)?.teamId;
/** Emit a store event the way the store would, but out of order (the illegal edge). */
const replay = (e: TeamsEnv, event: "team_closed" | "lead_bound" | "team_created", payload: Record<string, unknown>) => (e.rt.store as unknown as { emit(n: string, p: unknown): void }).emit(event, payload);

describe("stamping on core events", () => {
  it("team_created stamps the lead with {teamId}, persisted", async () => {
    const { e, h } = mk();
    const team = await e.createTeam();
    expect(h.assigns).toEqual([{ sessionId: e.lead, ref: { [LEAD_STAMP_KEY]: { teamId: team.id } }, opts: { persist: true } }]);
    expect(h.stampOf(e.lead)).toEqual({ teamId: team.id });
  });

  it("a server-started team stamps on lead_bound; closing clears with the JSON-plain sentinel", async () => {
    const { e, h } = mk();
    const team = e.rt.store.createTeam({ name: "beta", leadCwd: "/work", mode: "session", maxTeammates: 4, starting: true });
    expect(h.assigns).toEqual([]);
    e.fake.addSession("S-late", { cwd: "/work" });
    e.rt.store.bindLead(team.id, "S-late");
    expect(h.stampOf("S-late")).toEqual({ teamId: team.id });
    e.rt.ops.teamDelete(team, { actor: "user" });
    expect(team.status).toBe("closed");
    expect(h.assigns.at(-1)).toEqual({ sessionId: "S-late", ref: { [LEAD_STAMP_KEY]: { teamId: null } }, opts: { persist: true } });
    expect(teamId(h.stampOf("S-late"))).toBeNull();
  });
});

describe("stamp ordering (S44)", () => {
  it("a late team_closed(A) after team_created(B) does not clear B's stamp", async () => {
    const { e, h } = mk();
    const a = await e.createTeam("alpha");
    e.rt.ops.teamDelete(a, { actor: "lead" });
    const b = await e.createTeam("beta");
    expect(teamId(h.stampOf(e.lead))).toBe(b.id);
    const calls = h.assigns.length;
    replay(e, "team_closed", { team: a }); // the stale close arrives AFTER B's creation
    expect(teamId(h.stampOf(e.lead))).toBe(b.id);
    expect(h.assigns).toHaveLength(calls); // reconcile found nothing to change
  });

  it("the stamp follows the live team when the events arrive reversed (close handled after the new create)", async () => {
    const { e, h } = mk();
    const a = await e.createTeam("alpha");
    // B is created for the same lead BEFORE A's close is processed: both live in the store for a moment.
    const b = e.rt.store.createTeam({ name: "beta", leadSessionId: e.lead, leadCwd: "/work", mode: "session", maxTeammates: 4 });
    e.rt.store.setTeamStatus(a.id, "closed");
    expect(teamId(h.stampOf(e.lead))).toBe(b.id);
  });
});

describe("lead rebinding (S45)", () => {
  it("the old session's stamp is cleared, the new one stamped; repeating the event changes nothing", async () => {
    const { e, h } = mk();
    const team = await e.createTeam();
    e.fake.addSession("S-lead2", { cwd: "/work" });
    e.rt.store.bindLead(team.id, "S-lead2");
    expect(teamId(h.stampOf(e.lead))).toBeNull();
    expect(h.stampOf("S-lead2")).toEqual({ teamId: team.id });
    const calls = h.assigns.length;
    replay(e, "lead_bound", { team, rebind: true });
    replay(e, "lead_bound", { team, rebind: true });
    expect(h.assigns).toHaveLength(calls);
    expect(h.stampOf("S-lead2")).toEqual({ teamId: team.id });
  });
});

describe("restart (S51)", () => {
  it("a bridge created over a hydrated store re-stamps the live teams (persist:true) before any REST call", async () => {
    const first = mk();
    const team = await first.e.createTeam();
    first.e.fake.runShutdownHooks();
    expect(first.h.assigns).toHaveLength(1);

    const env2 = createTeamsEnv({ dataDir: first.e.fake.dataDir });
    const host2 = createFakeUiHost();
    mk({ env: env2, host: host2 });
    expect(env2.rt.store.get(team.id)?.leadSessionId).toBe(first.e.lead);
    expect(host2.assigns).toEqual([{ sessionId: first.e.lead, ref: { [LEAD_STAMP_KEY]: { teamId: team.id } }, opts: { persist: true } }]);
    expect(host2.stampOf(first.e.lead)).toEqual({ teamId: team.id });
  });
});

describe("clear survives JSON (S52)", () => {
  it("the sentinel arrives at the client; an undefined clear would be dropped by JSON", async () => {
    const { e, h } = mk();
    const team = await e.createTeam();
    const before = JSON.parse(JSON.stringify(h.projection(e.lead))) as Record<string, unknown>; // client session as of the badge
    expect(teamId(before[LEAD_STAMP_KEY])).toBe(team.id);
    e.rt.ops.teamDelete(team, { actor: "lead" });
    // `session_updated` carries only the projected top-level keys; the client merges shallowly.
    const update = JSON.parse(JSON.stringify(h.projection(e.lead))) as Record<string, unknown>;
    const merged = { ...before, ...update };
    expect(typeof teamId(merged[LEAD_STAMP_KEY])).not.toBe("string"); // predicate false: no badge, no reload
    // Control: the same clear as `undefined` never reaches the client.
    const dropped = JSON.parse(JSON.stringify({ [LEAD_STAMP_KEY]: undefined })) as Record<string, unknown>;
    expect(LEAD_STAMP_KEY in dropped).toBe(false); // JSON drops the key …
    expect({ ...before, ...dropped }[LEAD_STAMP_KEY]).toEqual({ teamId: team.id }); // … so the client would keep a stale badge
  });
});

describe("stamp failure (S113)", () => {
  it.each([[false], ["throw"]] as const)("assignSessionRef → %s on three team_created: exactly one warn, team operations unaffected, a later event retries", async (result) => {
    const { e, h } = mk();
    h.state.result = result;
    const t1 = await e.createTeam("one");
    for (const sid of ["S-b", "S-c"]) {
      e.fake.addSession(sid, { cwd: "/work" });
      e.rt.store.createTeam({ name: sid, leadSessionId: sid, leadCwd: "/work", mode: "session", maxTeammates: 4 });
    }
    expect(h.assigns.length).toBeGreaterThanOrEqual(3);
    expect(e.fake.logs.warn.filter((l) => l.includes("stamp"))).toHaveLength(1);
    expect(e.fake.logs.warn.join("\n")).not.toContain(t1.name);
    // Tools, mail and tasks still work.
    const res = await e.call("lead", "TaskCreate", { title: "t", description: "d" });
    expect(res.ok).toBe(true);
    // The host recovers: the next team event retries every unsettled session.
    h.state.result = true;
    e.fake.addSession("S-d", { cwd: "/work" });
    e.rt.store.createTeam({ name: "d", leadSessionId: "S-d", leadCwd: "/work", mode: "session", maxTeammates: 4 });
    expect(teamId(h.stampOf("S-d"))).toBeDefined();
    expect(teamId(h.stampOf(e.lead))).toBe(t1.id);
    expect(teamId(h.stampOf("S-b"))).toBeDefined();
  });
});

describe("stamp before the session exists (S114)", () => {
  it("the host's pending-ref registry does not reserve the key, and core's binder ignores it", async () => {
    const registry = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../server/src/pending/pending-plugin-ref-registry.ts");
    const src = fs.readFileSync(registry, "utf8");
    const reserved = src.slice(src.indexOf("CORE_RESERVED_REF_KEYS"), src.indexOf("]);", src.indexOf("CORE_RESERVED_REF_KEYS")));
    expect(reserved).toContain('"pluginRefs"'); // found the right block
    expect(reserved).not.toContain(LEAD_STAMP_KEY);

    const { e } = mk();
    const team = await e.createTeam();
    const rev = e.rt.store.rev(team.id);
    const members = team.members.length;
    e.fake.resolveSession("S-ghost", { [LEAD_STAMP_KEY]: { teamId: team.id } }); // session registers carrying only the stamp
    expect(team.members).toHaveLength(members); // not read as a nameless teammate
    expect(e.rt.store.rev(team.id)).toBe(rev);
    expect(e.rt.store.findBySession("S-ghost")).toBeUndefined();
  });

  it("lead_bound before the session record exists: the host says false, one warn, the next event applies it", async () => {
    const { e, h } = mk();
    h.state.known = new Set(); // no session is registered with the host yet
    const team = e.rt.store.createTeam({ name: "beta", leadCwd: "/work", mode: "session", maxTeammates: 4, starting: true });
    e.rt.store.bindLead(team.id, "S-server-lead");
    expect(e.fake.logs.warn.filter((l) => l.includes("stamp"))).toHaveLength(1);
    expect(h.stampOf("S-server-lead")).toBeUndefined();
    h.state.known = new Set(["S-server-lead"]); // registration happened
    e.clock.advance(2000); // past the retry back-off of a failed stamp
    e.rt.store.patchTeam(team.id, { description: "tick" }); // any later `change` on the team
    expect(h.stampOf("S-server-lead")).toEqual({ teamId: team.id });
  });
});
