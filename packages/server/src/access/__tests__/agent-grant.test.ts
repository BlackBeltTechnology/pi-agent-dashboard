/**
 * Agent path-gate grant binding (confirm registry + `path_grant_request`).
 * Real directories: the contract is defined over realpath.
 * See change: ask-agent-file-access-in-chat — test-plan #E24–#E29, #E31.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __resetAccessGrants, accessGrantsStorePath, listGrants } from "../access-grants.js";
import { createAgentConfirmRegistry } from "../agent-confirm-registry.js";
import { handlePathGrantRequest } from "../agent-grant.js";
import { announceableGrantStoreId, ensureGrantStoreId, readGrantStoreId } from "../grant-store-id.js";

let root: string;
let prevStore: string | undefined;
let t = 0;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-grant-")));
  prevStore = process.env.PI_ACCESS_GRANTS_STORE;
  process.env.PI_ACCESS_GRANTS_STORE = path.join(root, "access-grants.json");
  __resetAccessGrants();
  t = 1_000_000;
});
afterEach(() => {
  if (prevStore === undefined) delete process.env.PI_ACCESS_GRANTS_STORE;
  else process.env.PI_ACCESS_GRANTS_STORE = prevStore;
  __resetAccessGrants();
});

const mk = (...s: string[]) => {
  const p = path.join(root, ...s);
  fs.mkdirSync(p, { recursive: true });
  return p;
};

function setup() {
  const registry = createAgentConfirmRegistry({ now: () => t, getTtlMs: () => 120_000 });
  const logs: string[] = [];
  const req = (over: Record<string, unknown> = {}) => ({
    type: "path_grant_request" as const,
    requestId: "r1",
    sessionId: "S1",
    promptId: "p2",
    path: "",
    subject: "",
    ...over,
  });
  const handle = (sock: string, msg: ReturnType<typeof req>) =>
    handlePathGrantRequest(sock, msg, { registry, log: (l) => logs.push(l) });
  return { registry, req, handle, logs };
}

describe("agent grant — binding", () => {
  it("E24 stores the realpath'd containing directory, project scope, via agent-prompt, origin session", () => {
    const dir = mk("other", "docs");
    const file = path.join(dir, "a.md");
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: file, subject: dir });
    const r = handle("S1", req({ path: file, subject: dir }));
    expect(r).toMatchObject({ ok: true, subject: dir });
    expect(listGrants()).toEqual([expect.objectContaining({ subject: dir, scope: "project", via: "agent-prompt", origin: "S1" })]);
    expect(fs.existsSync(accessGrantsStorePath())).toBe(true);
  });

  it("E25 every binding failure refuses and leaves the store unchanged", () => {
    const dir = mk("o");
    const file = path.join(dir, "a");
    const { registry, req, handle } = setup();
    registry.observe("S1", "ok", { path: file, subject: dir });
    registry.observe("S1", "used", { path: file, subject: dir });
    registry.observe("S1", "cancelled", { path: file, subject: dir });
    registry.cancel("S1", "cancelled");
    expect(handle("S1", req({ promptId: "used", path: file, subject: dir })).ok).toBe(true);
    const cases: Array<[string, string, Record<string, unknown>]> = [
      ["wrong connection", "S2", { promptId: "ok", path: file, subject: dir }],
      ["unknown", "S1", { promptId: "nope", path: file, subject: dir }],
      ["used", "S1", { promptId: "used", path: file, subject: dir }],
      ["cancelled", "S1", { promptId: "cancelled", path: file, subject: dir }],
      ["path mismatch", "S1", { promptId: "ok", path: path.join(dir, "zzz"), subject: dir }],
      ["subject mismatch", "S1", { promptId: "ok", path: file, subject: mk("elsewhere") }],
    ];
    const before = listGrants().length;
    for (const [name, sock, over] of cases) {
      const r = handle(sock, req(over));
      expect(r.ok, name).toBe(false);
    }
    expect(listGrants().length).toBe(before);
    // The valid entry is still redeemable after all those refusals (none consumed it).
    expect(handle("S1", req({ promptId: "ok", path: file, subject: dir })).ok).toBe(true);
  });

  it("expired confirmation is refused", () => {
    const dir = mk("o");
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: dir, subject: dir });
    t += 121_000;
    expect(handle("S1", req({ path: dir, subject: dir }))).toMatchObject({ ok: false, error: "confirmation expired" });
  });

  it("E26 a replay does not extend the TTL", () => {
    const dir = mk("o");
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: dir, subject: dir });
    t += 100_000;
    registry.observe("S1", "p2", { path: dir, subject: dir }); // replay
    t += 25_000;
    expect(handle("S1", req({ path: dir, subject: dir })).ok).toBe(false);
  });

  it("E27 settled redeem window is 5 s", () => {
    const dir = mk("o");
    const file = path.join(dir, "f.txt");
    const a = setup();
    a.registry.observe("S1", "p2", { path: file, subject: dir });
    a.registry.settle("S1", "p2");
    t += 4_900;
    expect(a.handle("S1", a.req({ path: file, subject: dir })).ok).toBe(true);
    const b = setup();
    b.registry.observe("S1", "p3", { path: file, subject: dir });
    b.registry.settle("S1", "p3");
    t += 5_100;
    expect(b.handle("S1", b.req({ promptId: "p3", path: file, subject: dir })).ok).toBe(false);
  });

  it("E28 subject swapped for a symlink between prompt and grant is refused", () => {
    const docs = mk("other", "docs");
    const secret = mk("secret");
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: path.join(docs, "a.md"), subject: docs });
    fs.rmSync(docs, { recursive: true });
    fs.symlinkSync(secret, docs);
    const r = handle("S1", req({ path: path.join(docs, "a.md"), subject: docs }));
    expect(r.ok).toBe(false);
    expect(listGrants()).toHaveLength(0);
  });

  it("r2/B2: the subject is re-derived from the gated PATH — a confirm naming an ancestor of the file is refused", () => {
    const docs = mk("other", "docs");
    const ancestor = path.dirname(docs); // .../other — an ancestor of the gated file's directory
    const file = path.join(docs, "a.md");
    const { registry, req, handle } = setup();
    // A (buggy/forged) confirm prompt that recorded the ANCESTOR as the subject for that file.
    registry.observe("S1", "p2", { path: file, subject: ancestor });
    const r = handle("S1", req({ path: file, subject: ancestor }));
    expect(r).toMatchObject({ ok: false });
    expect(listGrants()).toHaveLength(0);
  });

  it("r3/B1: a gated existing DIRECTORY names itself (not its parent); an ancestor claim is refused", () => {
    const parent = mk("other3");
    const docs = mk("other3", "docs");
    const a = setup();
    a.registry.observe("S1", "p2", { path: docs, subject: docs });
    expect(a.handle("S1", a.req({ path: docs, subject: docs })).ok).toBe(true);
    expect(listGrants()).toEqual([expect.objectContaining({ subject: docs })]);
    const b = setup();
    b.registry.observe("S1", "p3", { path: docs, subject: parent }); // forged: the parent of the gated directory
    expect(b.handle("S1", b.req({ promptId: "p3", path: docs, subject: parent })).ok).toBe(false);
    expect(listGrants().map((g) => g.subject)).toEqual([docs]);
  });

  it("r3/B1: a path that turns from FILE into DIRECTORY before the grant no longer derives the recorded subject → refused", () => {
    const docs = mk("other2", "docs");
    const file = path.join(docs, "a.md");
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: file, subject: docs });
    fs.mkdirSync(file); // a.md is now a directory: the subject for it would be a.md itself
    expect(handle("S1", req({ path: file, subject: docs }))).toMatchObject({ ok: false });
    expect(listGrants()).toHaveLength(0);
  });

  it("E29 forbidden subject (home) is refused even with a valid confirm", () => {
    const home = fs.realpathSync(os.homedir());
    const { registry, req, handle } = setup();
    registry.observe("S1", "p2", { path: path.join(home, "notes.txt"), subject: home });
    expect(handle("S1", req({ path: path.join(home, "notes.txt"), subject: home })).ok).toBe(false);
    expect(listGrants()).toHaveLength(0);
  });

  it("r6/B1: accepted and refused grant log lines are control-character free", () => {
    const evilDir = mk("evil\n[path-gate] grant accepted forged");
    const file = path.join(evilDir, "a.md");
    const { registry, req, handle, logs } = setup();
    registry.observe("S1", "p2", { path: file, subject: evilDir });
    expect(handle("S1", req({ path: file, subject: evilDir })).ok).toBe(true);
    // refusal path: wrong connection session id carrying a newline is not trusted/echoed raw either
    handle("S1\n[path-gate] grant accepted forged", req({ path: file, subject: evilDir }));
    expect(logs.length).toBeGreaterThan(1);
    for (const l of logs) expect(l, l).not.toMatch(/[\u0000-\u001f\u007f\u2028\u2029]/);
    expect(logs.filter((l) => l.startsWith("[path-gate] grant accepted"))).toHaveLength(1);
  });

  it("malformed request is refused", () => {
    const { handle, req } = setup();
    expect(handle("S1", req({ promptId: 5 as unknown as string })).ok).toBe(false);
  });

  it("per-session cap evicts the oldest entry", () => {
    const reg = createAgentConfirmRegistry({ now: () => t, capPerSession: 2 });
    reg.observe("S", "a", { path: "/a", subject: "/" });
    reg.observe("S", "b", { path: "/b", subject: "/" });
    reg.observe("S", "c", { path: "/c", subject: "/" });
    expect(reg.consume("S", "a", { path: "/a", subject: "/" }, () => true)).toMatchObject({ ok: false });
    expect(reg.consume("S", "c", { path: "/c", subject: "/" }, () => true)).toMatchObject({ ok: true });
  });
});

describe("grant-store-id", () => {
  it("E31 concurrent ensures create the file once and converge on one token", async () => {
    const dir = path.join(root, "dash");
    const ids = await Promise.all(Array.from({ length: 8 }, async () => ensureGrantStoreId(dir)));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(readGrantStoreId(dir)).toBe(ids[0]);
    expect((fs.statSync(path.join(dir, "grant-store-id")).mode & 0o777)).toBe(0o600);
  });

  it("r8: the identity is NOT announced when the grant store is overridden (the bridge could not read that store)", () => {
    const dir = path.join(root, "dash3");
    const id = ensureGrantStoreId(dir);
    expect(announceableGrantStoreId({}, dir)).toBe(id);
    expect(announceableGrantStoreId({ PI_ACCESS_GRANTS_STORE: "/elsewhere/grants.json" }, dir)).toBeNull();
    expect(announceableGrantStoreId({ PI_ACCESS_GRANTS_STORE: "   " }, dir)).toBe(id);
  });

  it("never overwrites an existing token; re-read is live", () => {
    const dir = path.join(root, "dash2");
    const first = ensureGrantStoreId(dir);
    expect(ensureGrantStoreId(dir)).toBe(first);
    fs.writeFileSync(path.join(dir, "grant-store-id"), "swapped");
    expect(readGrantStoreId(dir)).toBe("swapped");
  });
});
