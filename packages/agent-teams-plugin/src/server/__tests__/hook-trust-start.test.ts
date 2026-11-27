/**
 * Hook trust on the START path (tasks 5.5, 5.6): the confirmation is bound to the hash of the bytes that are
 * snapshotted, keyed on `realpath(cwd)`, survives a restart, and never reaches a running team's frozen hooks.
 * Test-plan #R11 (12.23) #D7 (12.25, start half) #D11 (12.26).
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFakeRuntimeHost } from "../../__tests__/harness/index.js";
import type { Team } from "../../shared/types.js";
import { createExtensionPoints } from "../extension-points.js";
import { hashHooks } from "../hook-hash.js";
import { createTeamsRuntime } from "../runtime.js";
import { createStartEnv, type StartEnv } from "./start-env.js";
import { md } from "./template-env.js";

const gated = (command: string): string => md({ name: "gated", spawn: "lead", hooks: { TaskCompleted: [{ command }] } });
const hashFor = (command: string): string => hashHooks({ TaskCompleted: [{ command, timeoutMs: 10_000 }] }, 10_000);
const trustFile = (e: StartEnv): string => path.join(e.fake.dataDir, "hook-trust.json");
const entries = (e: StartEnv): Array<{ cwd: string; hash: string }> => (fs.existsSync(trustFile(e)) ? (JSON.parse(fs.readFileSync(trustFile(e), "utf8")) as { entries: Array<{ cwd: string; hash: string }> }).entries : []);

describe("start races with a template edit (12.23, #R11)", () => {
  it("a retry with the hash that was shown, after the file changed, is hash_mismatch: nothing recorded, nothing started", async () => {
    const e = await createStartEnv();
    const file = e.tpl("project", "gated", gated("echo one"));
    const shown = await e.start({ template: "gated", goal: "g" });
    expect(shown).toMatchObject({ ok: false, error: "hooks_untrusted", details: { hash: hashFor("echo one"), commands: [{ event: "TaskCompleted", command: "echo one", timeoutMs: 10_000 }] } });
    fs.writeFileSync(file, gated("echo two"));
    const retry = await e.start({ template: "gated", goal: "g", trustHooks: shown.details.hash });
    expect(retry).toMatchObject({ ok: false, error: "hash_mismatch", details: { hash: hashFor("echo two") } });
    expect(entries(e)).toEqual([]);
    expect(e.rt.store.list()).toHaveLength(0);
  });

  it("an edit between the listing's cache fill and the start (same size, same mtime) is still seen: the start re-reads, the snapshot and the recorded hash agree", async () => {
    const e = await createStartEnv();
    const file = e.tpl("project", "gated", gated("echo aaa"));
    const at = new Date(1_700_000_000_000);
    fs.utimesSync(file, at, at);
    expect((await e.templates()).data.templates[0]).toMatchObject({ name: "gated", valid: true }); // cache filled
    fs.writeFileSync(file, gated("echo bbb")); // same size, same inode
    fs.utimesSync(file, at, at); // same mtime
    const shown = await e.start({ template: "gated", goal: "g" });
    expect(shown).toMatchObject({ ok: false, error: "hooks_untrusted", details: { hash: hashFor("echo bbb") } });
    const started = await e.start({ template: "gated", goal: "g", trustHooks: shown.details.hash });
    expect(started).toMatchObject({ ok: true });
    const team = e.rt.store.list()[0] as Team;
    expect(team.hooks?.TaskCompleted?.[0]?.command).toBe("echo bbb");
    expect(entries(e).map((x) => x.hash)).toEqual([hashHooks(team.hooks as never, 10_000)]);
  });
});

describe("hook-trust.json across restart and realpath (12.25, #D7 start half)", () => {
  async function reboot(e: StartEnv) {
    await e.rt.persistence.flush();
    e.rt.dispose();
    const fake = createFakeRuntimeHost({ dataDir: e.fake.dataDir, config: { maxActiveTeams: 50 } });
    createTeamsRuntime(fake.host, {
      clock: e.clock,
      ext: createExtensionPoints(),
      templatesHost: { isProjectTrusted: () => true, knownFolderCwds: () => [e.cwd], resolvePiAgentDir: () => e.agentDir },
    });
    return fake;
  }

  it("a confirmation is keyed on realpath(cwd): it survives a restart, a symlink path reuses it, a moved project and an edited hook set ask again, a revoke persists", async () => {
    const e = await createStartEnv();
    const file = e.tpl("project", "gated", gated("echo keep"));
    const shown = await e.start({ template: "gated", goal: "g" });
    expect((await e.start({ template: "gated", goal: "g", trustHooks: shown.details.hash })).ok).toBe(true);
    expect(entries(e)).toEqual([expect.objectContaining({ cwd: e.cwd, hash: hashFor("echo keep") })]);

    const link = path.join(e.root, "link");
    fs.symlinkSync(e.cwd, link);
    const moved = path.join(e.root, "moved");
    fs.mkdirSync(path.join(moved, ".pi", "teams"), { recursive: true });
    fs.copyFileSync(file, path.join(moved, ".pi", "teams", "gated.md"));

    const fake = await reboot(e);
    const startAt = (cwd: string, args: Record<string, unknown> = {}) => fake.call(fake.addSession(`S-${Math.random()}`, { cwd }), "team.start", { template: "gated", goal: "g", ...args });
    expect(await startAt(link)).toMatchObject({ ok: true }); // symlink path → same realpath → no prompt
    expect(await startAt(moved)).toMatchObject({ ok: false, error: "hooks_untrusted" }); // a different directory does not inherit it
    fs.writeFileSync(file, gated("echo changed"));
    expect(await startAt(e.cwd)).toMatchObject({ ok: false, error: "hooks_untrusted", details: { hash: hashFor("echo changed") } });
    fs.writeFileSync(file, gated("echo keep"));
    expect(await startAt(e.cwd)).toMatchObject({ ok: true });

    // revoke through the store file (what DELETE hook-trust does) and restart again
    fs.writeFileSync(trustFile(e), JSON.stringify({ version: 1, entries: [] }));
    const fake2 = await reboot({ ...e, rt: { persistence: { flush: async () => undefined }, dispose: () => undefined }, fake } as unknown as StartEnv);
    expect(await fake2.call(fake2.addSession("S-after", { cwd: e.cwd }), "team.start", { template: "gated", goal: "g" })).toMatchObject({ ok: false, error: "hooks_untrusted" });
  });
});

describe("trust revoked while a team runs (12.26, #D11)", () => {
  it("the frozen hooks keep gating the live team; the next START asks again (hooks_untrusted) or is refused (project_untrusted)", async () => {
    const e = await createStartEnv();
    e.tpl("project", "gated", gated("echo frozen-gate >&2; exit 2"));
    const lead = e.newSession();
    const shown = await e.start({ template: "gated", goal: "g" }, lead);
    expect(await e.start({ template: "gated", goal: "g", trustHooks: shown.details.hash }, lead)).toMatchObject({ ok: true });
    const team = e.rt.store.list()[0] as Team;
    e.addMember(team, "alice", "busy");
    e.rt.ops.createTask(team, { title: "t", description: "d", owner: "alice" }, { actor: "lead" });
    e.rt.store.patchTask(team.id, "1", { status: "in_progress" });
    const blocked = () => e.call("alice", "TaskUpdate", { id: "1", status: "completed", result: "done" });
    expect(await blocked()).toMatchObject({ ok: false, error: "hook_blocked", message: expect.stringContaining("frozen-gate") });

    // DELETE hook-trust: the next start asks again, the live team is untouched
    expect((await e.rest("DELETE", `/hook-trust?cwd=${encodeURIComponent(e.cwd)}`)).body).toMatchObject({ removed: 1 });
    expect(await e.start({ template: "gated", goal: "g" })).toMatchObject({ ok: false, error: "hooks_untrusted" });
    expect(await blocked()).toMatchObject({ ok: false, error: "hook_blocked" });

    // project trust revoked: the next start is refused outright, the live team still runs its frozen hooks
    e.setTrusted(false);
    expect(await e.start({ template: "gated", goal: "g" })).toMatchObject({ ok: false, error: "project_untrusted" });
    expect(await blocked()).toMatchObject({ ok: false, error: "hook_blocked" });
    expect(e.rt.store.list()[0]?.hooks?.TaskCompleted?.[0]?.command).toContain("frozen-gate");
  });
});
