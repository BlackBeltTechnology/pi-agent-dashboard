/**
 * Hook TOFU trust store + trust decisions (design D7): canonical hash, fail-closed corrupt file,
 * serialised atomic writes, realpath keying across restart/symlink, hash-bound confirmation and
 * revocation that never touches a running team. The `team.start` wiring itself (template re-read,
 * list-cache invalidation, `project_untrusted`) is phase C; these rows are asserted one level below
 * it, on `decideHookTrust` / the store.
 * See change: add-agent-teams-templates-hooks (test-plan #E30, #X13, #R7, #R11, #D7, #D11).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FakeClock } from "../../__tests__/harness/index.js";
import { capturingLogger, tmpDataDir } from "../../__tests__/harness/store-env.js";
import type { TeamHooks } from "../../shared/types.js";
import { hashHooks } from "../hook-hash.js";
import {
  createHookTrustStore,
  decideHookTrust,
  describeHooks,
  HOOK_TRUST_FILE,
  type HookTrustFs,
  nodeHookTrustFs,
  revokeHookTrust,
  trustHook,
} from "../hook-trust.js";
import { parseTemplate } from "../template-parse.js";
import { createHarness, FakeProcs, task } from "./hook-fakes.js";

const DEFAULT_MS = 10_000;
const hooks = (command = "npm test", timeoutMs?: number): TeamHooks => ({ TaskCompleted: [{ command, ...(timeoutMs ? { timeoutMs } : {}) }] });
const newStore = (dataDir = tmpDataDir(), fsOver: Partial<HookTrustFs> = {}) => {
  const { logger, logs } = capturingLogger();
  return { store: createHookTrustStore({ dataDir, logger, fs: { ...nodeHookTrustFs, ...fsOver } }), logs, dataDir, file: path.join(dataDir, HOOK_TRUST_FILE) };
};
const realDir = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agent-teams-proj-")));

describe("hook hash canonicalisation (12.8, #E30)", () => {
  const hashOf = (hooksYaml: string) => {
    const out = parseTemplate(`---\nname: t\ndescription: d\nmembers:\n  - { name: alice }\nhooks:\n${hooksYaml}---\nbody\n`, "t");
    expect(out.errors).toEqual([]);
    return hashHooks(out.core?.hooks as TeamHooks, DEFAULT_MS);
  };
  const base = hashOf("  TaskCompleted:\n    - command: npm test\n      timeoutMs: 5000\n  TeammateIdle:\n    - command: ./idle.sh\n");

  it("comments, whitespace, key order and event order are cosmetic", () => {
    expect(hashOf("  # gate\n  TaskCompleted:\n    - { timeoutMs: 5000,   command: npm test }   # tests\n  TeammateIdle:\n    - command: ./idle.sh\n")).toBe(base);
    expect(hashOf("  TeammateIdle:\n    - command: ./idle.sh\n  TaskCompleted:\n    - command: npm test\n      timeoutMs: 5000\n")).toBe(base);
  });

  it("an explicit timeoutMs equal to the effective default does not change the hash", () => {
    expect(hashOf("  TaskCompleted:\n    - command: a\n")).toBe(hashOf(`  TaskCompleted:\n    - { command: a, timeoutMs: ${DEFAULT_MS} }\n`));
  });

  it("a 1-char command change, a timeoutMs change and a command order change differ", () => {
    const two = (a: string, b: string) => hashOf(`  TaskCompleted:\n    - command: ${a}\n    - command: ${b}\n`);
    expect(two("a", "b")).not.toBe(two("a", "c"));
    expect(two("a", "b")).not.toBe(two("b", "a"));
    expect(base).not.toBe(hashOf("  TaskCompleted:\n    - command: npm test\n      timeoutMs: 5001\n  TeammateIdle:\n    - command: ./idle.sh\n"));
  });

  it("the hash covers the effective default: a changed hookTimeoutMs re-asks", () => {
    expect(hashHooks(hooks("a"), 10_000)).not.toBe(hashHooks(hooks("a"), 9000));
  });
});

describe("hook-trust.json corrupt / unreadable (12.16, #X13)", () => {
  const decide = (store: ReturnType<typeof newStore>["store"], h: TeamHooks, trustHooks?: string) =>
    decideHookTrust(store, { cwd: "/p", source: "project", hooks: h, defaultTimeoutMs: DEFAULT_MS, trustHooks });

  it.each([
    ["a lone brace", "{"],
    ["empty", ""],
    ["wrong shape", JSON.stringify({ entries: "nope" })],
    ["wrong entry shape", JSON.stringify({ entries: [{ cwd: 1 }] })],
  ])("%s: no confirmations (hooks_untrusted), one error line, later confirm rewrites a valid file atomically", async (_name, content) => {
    const t = newStore();
    fs.writeFileSync(t.file, content);
    expect(await decide(t.store, hooks())).toMatchObject({ ok: false, error: "hooks_untrusted" });
    expect(await decide(t.store, hooks())).toMatchObject({ ok: false, error: "hooks_untrusted" });
    expect(t.logs.error).toHaveLength(1); // logged once
    const shown = describeHooks(hooks(), DEFAULT_MS);
    expect(await decide(t.store, hooks(), shown.hash)).toMatchObject({ ok: true });
    const file = JSON.parse(fs.readFileSync(t.file, "utf8")) as { entries: unknown[] };
    expect(file.entries).toHaveLength(1);
    expect(fs.readdirSync(t.dataDir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(await decide(t.store, hooks())).toMatchObject({ ok: true });
  });

  it("EACCES on read: fail closed, error logged once; ENOENT: no error at all", async () => {
    const eacces = newStore(undefined, { readFile: async () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" })) });
    expect(await decide(eacces.store, hooks())).toMatchObject({ error: "hooks_untrusted" });
    expect(await decide(eacces.store, hooks())).toMatchObject({ error: "hooks_untrusted" });
    expect(eacces.logs.error).toHaveLength(1);
    expect(eacces.logs.error[0]).toContain("EACCES");
    const missing = newStore();
    expect(await decide(missing.store, hooks())).toMatchObject({ error: "hooks_untrusted" });
    expect(missing.logs.error).toEqual([]);
  });

  it("a hook-less template never touches the store (a corrupt file cannot break its start)", async () => {
    const t = newStore(undefined, { readFile: async () => Promise.reject(new Error("must not read")) });
    expect(await decideHookTrust(t.store, { cwd: "/p", source: "project", hooks: {}, defaultTimeoutMs: DEFAULT_MS })).toEqual({ ok: true });
    expect(await decideHookTrust(t.store, { cwd: "/p", source: "project", hooks: { TaskCompleted: [] }, defaultTimeoutMs: DEFAULT_MS })).toEqual({ ok: true });
    expect(t.logs.error).toEqual([]);
  });

  it("a failing write records nothing and leaves no tmp file", async () => {
    const t = newStore(undefined, { rename: async () => Promise.reject(new Error("disk full")) });
    await expect(t.store.trust("/p", "h")).rejects.toThrow("disk full");
    expect(await t.store.isTrusted("/p", "h")).toBe(false);
    expect(fs.readdirSync(t.dataDir)).toEqual([]);
  });
});

describe("hook-trust writes under concurrency (12.22, #R7)", () => {
  it("20 concurrent confirms + 5 concurrent revokes: exactly the un-revoked remain, valid JSON at every read", async () => {
    const t = newStore();
    const cwds = Array.from({ length: 20 }, (_, i) => `/proj/${i}`);
    let reads = 0;
    const poll = setInterval(() => {
      if (!fs.existsSync(t.file)) return;
      JSON.parse(fs.readFileSync(t.file, "utf8")); // never torn
      reads++;
    }, 1);
    await Promise.all(cwds.map((c, i) => t.store.trust(c, `hash-${i}`)));
    await Promise.all(cwds.slice(0, 5).map((c, i) => t.store.revoke(c, `hash-${i}`)));
    clearInterval(poll);
    const onDisk = JSON.parse(fs.readFileSync(t.file, "utf8")) as { entries: Array<{ cwd: string; hash: string }> };
    expect(onDisk.entries.map((e) => e.cwd).sort()).toEqual(cwds.slice(5).sort());
    expect(reads).toBeGreaterThanOrEqual(0);
  });

  it("interleaved confirm/revoke in one burst loses no update", async () => {
    const t = newStore();
    await t.store.trust("/a", "h1");
    await Promise.all([t.store.trust("/a", "h2"), t.store.trust("/b", "h1"), t.store.revoke("/a", "h1"), t.store.trust("/c", "h9")]);
    expect((await t.store.list()).map((e) => `${e.cwd}:${e.hash}`).sort()).toEqual(["/a:h2", "/b:h1", "/c:h9"]);
  });

  it("revoke without a hash removes only that cwd", async () => {
    const t = newStore();
    await t.store.trust("/a", "h1");
    await t.store.trust("/a", "h2");
    await t.store.trust("/b", "h1");
    expect(await revokeHookTrust(t.store, { cwd: "/a" })).toEqual({ removed: 2 });
    expect((await t.store.list()).map((e) => e.cwd)).toEqual(["/b"]);
    expect(await revokeHookTrust(t.store, { cwd: "/a" })).toEqual({ removed: 0 });
  });
});

describe("hash-bound confirmation (12.23, #R11 — store level)", () => {
  const input = (h: TeamHooks, trustHooks?: string) => ({ cwd: "/p", source: "project" as const, hooks: h, defaultTimeoutMs: DEFAULT_MS, trustHooks });

  it("hooks_untrusted carries the hash and the exact commands; confirming with that hash records it", async () => {
    const t = newStore();
    const first = await decideHookTrust(t.store, input(hooks("npm test", 5000)));
    expect(first).toMatchObject({ ok: false, error: "hooks_untrusted", commands: [{ event: "TaskCompleted", command: "npm test", timeoutMs: 5000 }] });
    const hash = (first as { hash: string }).hash;
    expect(await decideHookTrust(t.store, input(hooks("npm test", 5000), hash))).toMatchObject({ ok: true });
    expect(await decideHookTrust(t.store, input(hooks("npm test", 5000)))).toMatchObject({ ok: true });
  });

  it("the file is edited between the prompt (H1) and the confirm: hash_mismatch, nothing recorded", async () => {
    const t = newStore();
    const h1 = describeHooks(hooks("npm test"), DEFAULT_MS).hash;
    const out = await decideHookTrust(t.store, input(hooks("npm test && curl evil"), h1));
    expect(out).toMatchObject({ ok: false, error: "hash_mismatch" });
    expect(await t.store.list()).toEqual([]);
    expect(await decideHookTrust(t.store, input(hooks("npm test && curl evil")))).toMatchObject({ error: "hooks_untrusted" });
  });

  it("user-source hooks are trusted without a confirmation; a stale POST hash is refused", async () => {
    const t = newStore();
    expect(await decideHookTrust(t.store, { ...input(hooks()), source: "user" })).toEqual({ ok: true });
    const current = describeHooks(hooks(), DEFAULT_MS).hash;
    expect(await trustHook(t.store, { cwd: "/p", hash: "stale", currentHash: current })).toEqual({ ok: false, error: "hash_mismatch" });
    expect(await trustHook(t.store, { cwd: "/p", hash: current, currentHash: undefined })).toEqual({ ok: false, error: "hash_mismatch" });
    expect(await t.store.list()).toEqual([]);
    expect(await trustHook(t.store, { cwd: "/p", hash: current, currentHash: current })).toEqual({ ok: true });
    expect(await t.store.isTrusted("/p", current)).toBe(true);
  });
});

describe("hook-trust across restart and realpath (12.25, #D7 — store level)", () => {
  it("keyed on realpath(cwd): a symlink path reuses it, another dir does not, an edit re-asks, revoke persists", async () => {
    const dataDir = tmpDataDir();
    const proj = realDir();
    const other = realDir();
    const link = path.join(os.tmpdir(), `agent-teams-link-${process.pid}-${Date.now()}`);
    fs.symlinkSync(proj, link);
    const hash = describeHooks(hooks(), DEFAULT_MS).hash;
    await newStore(dataDir).store.trust(proj, hash);

    const restarted = newStore(dataDir).store; // a fresh process over the same file
    expect(await restarted.isTrusted(proj, hash)).toBe(true);
    expect(await restarted.isTrusted(link, hash)).toBe(true); // symlinked start path
    expect(await restarted.isTrusted(other, hash)).toBe(false);
    expect(await restarted.isTrusted(proj, describeHooks(hooks("npm test && x"), DEFAULT_MS).hash)).toBe(false); // hook edit re-asks
    expect(await decideHookTrust(restarted, { cwd: link, source: "project", hooks: hooks(), defaultTimeoutMs: DEFAULT_MS })).toMatchObject({ ok: true });

    await restarted.revoke(link, hash);
    expect(await newStore(dataDir).store.isTrusted(proj, hash)).toBe(false); // revocation persisted
    fs.unlinkSync(link);
  });

  it("a moved project does not inherit the confirmation (the old path string keeps it: same path, same hash)", async () => {
    const dataDir = tmpDataDir();
    const proj = realDir();
    const hash = "h";
    await newStore(dataDir).store.trust(proj, hash);
    const moved = `${proj}-moved`;
    fs.renameSync(proj, moved);
    expect(await newStore(dataDir).store.isTrusted(moved, hash)).toBe(false);
    expect(await newStore(dataDir).store.isTrusted(proj, hash)).toBe(true);
  });
});

describe("trust revoked while a team runs (12.26, #D11 — hook + store level)", () => {
  it("the live team's frozen hooks keep running after DELETE hook-trust; the next start asks again", async () => {
    const t = newStore();
    const frozen = hooks("npm test");
    const hash = describeHooks(frozen, DEFAULT_MS).hash;
    await t.store.trust("/p", hash);
    expect(await decideHookTrust(t.store, { cwd: "/p", source: "project", hooks: frozen, defaultTimeoutMs: DEFAULT_MS })).toMatchObject({ ok: true });

    const clock = new FakeClock(0);
    const procs = new FakeProcs(clock);
    procs.script([{ code: 2, stderr: "still gating" }]);
    const h = createHarness({ clock, io: procs.io() });
    const team = h.makeTeam({ hooks: frozen }); // frozen at start
    team.tasks = [task({ id: "3", owner: "alice" })];

    await revokeHookTrust(t.store, { cwd: "/p", hash });
    const res = await h.gates.taskCompleted(h.input("TaskUpdate", team, "alice", { id: "3", status: "completed" }));
    expect(res).toMatchObject({ block: true, feedback: "still gating" }); // the live team is untouched
    expect(team.hooks).toEqual(frozen);
    expect(await decideHookTrust(t.store, { cwd: "/p", source: "project", hooks: frozen, defaultTimeoutMs: DEFAULT_MS })).toMatchObject({ ok: false, error: "hooks_untrusted" });
  });
});
