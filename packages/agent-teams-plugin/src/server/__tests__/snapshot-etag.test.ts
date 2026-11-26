/**
 * Snapshot revision, epoch and ETag (test-plan S22): `ETag: "<epoch>:<rev>"`,
 * 304 only on exact string equality (no RFC 9110 weak comparison, no lists, no `*`),
 * and `viewerCanControl` in the body.
 * See change: add-agent-teams-ui.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createUiEnv, type UiEnv } from "../../__tests__/harness/ui-env.js";
import type { TeamUiSnapshot } from "../../shared/ui-protocol.js";

const envs: UiEnv[] = [];
afterEach(async () => {
  await Promise.all(envs.splice(0).map((e) => e.close()));
});

describe("ETag follows the viewer's capability (review round 1, B2)", () => {
  it("a validator minted for a controller never answers 304 for a read-only viewer of the same rev", async () => {
    let canControl = true;
    const e = await createUiEnv({ epoch: "E", control: () => canControl });
    envs.push(e);
    const team = await e.createTeam();
    const url = `/teams/${team.id}`;
    const first = await e.get<TeamUiSnapshot>(url);
    expect(first.body.viewerCanControl).toBe(true);
    canControl = false; // same epoch and rev: only the capability flipped
    const flipped = await e.get<TeamUiSnapshot>(url, { "if-none-match": first.headers.etag as string });
    expect(flipped.status).toBe(200);
    expect(flipped.body.viewerCanControl).toBe(false);
    expect(flipped.headers.etag).not.toBe(first.headers.etag);
    // and the read-only validator itself still answers 304 while nothing changes
    expect((await e.get(url, { "if-none-match": flipped.headers.etag as string })).status).toBe(304);
  });
});

describe("If-None-Match (S22)", () => {
  async function setup() {
    const e = await createUiEnv({ epoch: "E" });
    envs.push(e);
    const team = await e.createTeam();
    const rev = e.rt.store.rev(team.id);
    const url = `/teams/${team.id}`;
    const current = `"E:${rev}"`;
    return { e, team, rev, url, current };
  }

  it("the answer carries the strong ETag, epoch, rev and viewerCanControl", async () => {
    const { e, url, rev, current } = await setup();
    const res = await e.get<TeamUiSnapshot>(url);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(current);
    expect(res.body.epoch).toBe("E");
    expect(res.body.rev).toBe(rev);
    expect(res.body.viewerCanControl).toBe(true);
    expect(res.headers["cache-control"]).toContain("private");
    // viewerCanControl is per viewer, the ETag is not: the answer must vary on the identity carriers
    expect(String(res.headers.vary).toLowerCase()).toMatch(/authorization.*cookie/);
  });

  it("exact match → 304 with no body", async () => {
    const { e, url, current } = await setup();
    const res = await e.get(url, { "if-none-match": current });
    expect(res.status).toBe(304);
    expect(res.raw).toBe("");
    expect(res.headers.etag).toBe(current);
  });

  it.each([
    ["stale rev", (rev: number) => `"E:${rev - 1}"`],
    ["stale epoch", (rev: number) => `"E0:${rev}"`],
    ["garbage", () => "garbage"],
    ["weak form", (rev: number) => `W/"E:${rev}"`],
    ["list form", (rev: number) => `"x","E:${rev}"`],
    ["star", () => "*"],
    ["unquoted", (rev: number) => `E:${rev}`],
  ])("%s → 200 with the full body and the current ETag", async (_label, header) => {
    const { e, url, rev, current } = await setup();
    const res = await e.get<TeamUiSnapshot>(url, { "if-none-match": header(rev) });
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(current);
    expect(res.body.id).toBeDefined();
  });

  it("absent → 200; after a mutation the old ETag no longer matches", async () => {
    const { e, team, url, current } = await setup();
    expect((await e.get(url)).status).toBe(200);
    e.rt.store.appendMail(team.id, { from: "lead", to: "alice", kind: "message", text: "x", wake: false });
    const res = await e.get<TeamUiSnapshot>(url, { "if-none-match": current });
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(`"E:${e.rt.store.rev(team.id)}"`);
    expect(res.headers.etag).not.toBe(current);
  });

  it("an invisible team answers 404 even with a matching ETag (no 304 oracle)", async () => {
    const { e, team, url, current } = await setup();
    e.identity.enforced = true;
    team.owner = e.ownerKey({ iss: "idp", sub: "alice" });
    const res = await e.get(url, { "if-none-match": current, "x-principal": "idp|bob" });
    expect(res.status).toBe(404);
  });
});
