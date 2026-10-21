/**
 * Server side of the dashboard-trust → pi mirror: durable registry, per-entry
 * choices, snapshot writer, revoke/grant ordering and fault behaviour.
 *
 * Covers test-plan #E1–#E4 (registry half) #E19 #E20 #E22 #E26 #X5–#X9.
 * See change: mirror-dashboard-trust-to-pi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PiTrustMirrorConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { hookDefHash } from "@blackbelt-technology/pi-dashboard-shared/worktree-init-hook.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPiTrustMirrorService, type PiTrustMirrorServiceDeps, SNAPSHOT_WARN_ENTRIES } from "../access/pi-trust-mirror-service.js";
import { __resetSessionTrust, listPersistedTrust, recordTrust, revokeTrust } from "../git-worktree/worktree-init-trust.js";

let root: string;
const NO_DENY = () => ({ exact: [], subtree: [] });
const baseCfg = (): PiTrustMirrorConfig => ({
  enabled: true,
  coverInteractive: false,
  liveQuery: true,
  sources: { worktreeInit: true, workflow: true, pinned: true, folderWorkspaces: true, accessGrants: false, yolo: true },
});

interface Stores {
  pinned: string[];
  workspaceFolders: string[];
  grants: Array<{ subject: string }>;
}

function setup(over: Partial<PiTrustMirrorServiceDeps> = {}, stores: Partial<Stores> = {}, cfg = baseCfg()) {
  const st: Stores = { pinned: [], workspaceFolders: [], grants: [], ...stores };
  const svc = createPiTrustMirrorService({
    getConfig: () => cfg,
    listPinned: () => st.pinned,
    listWorkspaceFolders: () => st.workspaceFolders,
    listWorktreeTrust: () => listPersistedTrust(),
    listPersistedGrants: () => st.grants,
    snapshotPath: path.join(root, "cfg", "pi-trust-mirror.json"),
    overridesPath: path.join(root, "cfg", "pi-trust-overrides.json"),
    home: path.join(root, "home"),
    denyRules: NO_DENY,
    warn: () => {},
    ...over,
  });
  return { svc, st, cfg };
}

function mkdir(...p: string[]): string {
  const d = path.join(root, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-mirror-svc-")));
  fs.mkdirSync(path.join(root, "home"));
  process.env.HOME = path.join(root, "home");
  __resetSessionTrust();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const hook = { gate: "true", run: { type: "script" as const, command: "echo" } };
function repoWithHook(name: string, h = hook): string {
  const r = mkdir(name);
  fs.mkdirSync(path.join(r, ".pi"), { recursive: true });
  fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: h }));
  return r;
}

describe("registry (#E1 #E3 #E4 #E26)", () => {
  it("#E1 pinned entry counts with default; choice false drops it; choice true on a disabled source adds it", () => {
    const d = mkdir("Documents");
    const { svc, cfg } = setup({}, { pinned: [d] });
    expect(svc.evaluate().counted.map((c) => c.snapshotEntry.key)).toEqual([d]);
    svc.setChoice("pinned", d, false);
    expect(svc.evaluate().ignored[0]).toMatchObject({ reason: "source-off" });
    svc.setChoice("pinned", d, true);
    cfg.sources.pinned = false;
    expect(svc.evaluate().counted).toHaveLength(1);
  });

  it("#E3 edited hook stops counting until the current hook is re-trusted", () => {
    const r = repoWithHook("repo");
    recordTrust(r, hookDefHash(hook));
    const { svc } = setup();
    expect(svc.evaluate().counted).toHaveLength(1);
    const edited = { ...hook, gate: "false" };
    fs.writeFileSync(path.join(r, ".pi", "settings.json"), JSON.stringify({ worktreeInit: edited }));
    expect(svc.evaluate().ignored[0]).toMatchObject({ reason: "hook-changed" });
    recordTrust(r, hookDefHash(edited));
    expect(svc.evaluate().counted).toHaveLength(1);
  });

  it("#E4 server-lifetime trust never appears in the registry or the snapshot bytes", () => {
    const sessionRepo = repoWithHook("session-repo");
    recordTrust(sessionRepo, hookDefHash(hook), "session");
    const pinned = mkdir("pinned");
    const { svc } = setup({}, { pinned: [pinned] });
    svc.rewriteSnapshot();
    const bytes = fs.readFileSync(path.join(root, "cfg", "pi-trust-mirror.json"), "utf8");
    expect(bytes).toContain(pinned);
    expect(bytes).not.toContain("session-repo");
    expect(svc.evaluate().counted).toHaveLength(1);
  });

  it("#E26 a worktree-init entry keyed through a symlink is translated to the canonical key", () => {
    const real = repoWithHook("real-repo");
    const link = path.join(root, "link");
    fs.symlinkSync(root, link);
    recordTrust(path.join(link, "real-repo"), hookDefHash(hook));
    const { svc } = setup();
    const [c] = svc.evaluate().counted;
    expect(c.snapshotEntry.key).toBe(real);
    expect(c.snapshotEntry.configRoot).toBe(path.join(link, "real-repo"));
  });

  it("workflow source reports not installed; non-project-root grant is ignored", () => {
    const g = mkdir("grantdir");
    const { svc } = setup({}, { grants: [{ subject: g }] }, { ...baseCfg(), sources: { ...baseCfg().sources, accessGrants: true } });
    const ev = svc.evaluate();
    expect(ev.sourcesNotInstalled).toContain("workflow");
    expect(ev.ignored[0]).toMatchObject({ reason: "not-project-root" });
  });
});

describe("#E22 choice lifecycle", () => {
  it("choice survives the folder moving between workspaces; pre-existing pin has no choice", () => {
    const a = mkdir("a");
    const b = mkdir("b");
    const { svc, st } = setup({}, { pinned: [a, b] });
    svc.setChoice("pinned", a, false);
    st.workspaceFolders = [a]; // moved into a workspace — a different source row, same pin
    expect(svc.choiceFor("pinned", a)).toBe(false);
    expect(svc.choiceFor("pinned", b)).toBeUndefined();
    const ev = svc.evaluate();
    expect(ev.candidates.find((c) => c.key === b && c.sourceKind === "pinned")?.choice).toBeUndefined();
  });
});

describe("snapshot writer (#E19 #E20)", () => {
  it("#E19 mode 0600, durable only, generation strictly increases", () => {
    const d = mkdir("p");
    const { svc, st } = setup({}, { pinned: [d] });
    const g1 = svc.rewriteSnapshot();
    const file = path.join(root, "cfg", "pi-trust-mirror.json");
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    st.pinned.push(mkdir("q"));
    const g2 = svc.rewriteSnapshot();
    expect(g2).toBeGreaterThan(g1);
    expect(svc.readSnapshot()?.entries).toHaveLength(2);
  });

  it("#E20 warns above 5,000 counted entries, not at 5,000", () => {
    const base = mkdir("many");
    const dirs: string[] = [];
    for (let i = 0; i < SNAPSHOT_WARN_ENTRIES; i++) dirs.push(path.join(base, `d${i}`));
    // 5,000 distinct paths that exist: reuse one folder through symlink-free sub-dirs.
    for (const d of dirs) fs.mkdirSync(d);
    const warn = vi.fn();
    const { svc, st } = setup({ warn }, { pinned: dirs });
    svc.rewriteSnapshot();
    expect(warn).not.toHaveBeenCalled();
    st.pinned.push(mkdir("many", "extra"));
    svc.rewriteSnapshot();
    expect(warn).toHaveBeenCalledTimes(1);
  }, 60_000);
});

describe("fault behaviour (#X5–#X9)", () => {
  const eacces = () => Object.assign(new Error("EACCES"), { code: "EACCES" });
  const enospc = () => Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });

  it("#X5 failed snapshot write blocks the revoke; the source write never happens", () => {
    const r = mkdir("r");
    const writeSource = vi.fn();
    const { svc } = setup({}, { pinned: [r] });
    svc.rewriteSnapshot();
    const before = fs.readFileSync(path.join(root, "cfg", "pi-trust-mirror.json"), "utf8");
    const failing = setup({ writeAtomic: () => { throw eacces(); } }, { pinned: [r] });
    expect(() => failing.svc.revoke("pinned", r, writeSource)).toThrow(/EACCES/);
    expect(writeSource).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(root, "cfg", "pi-trust-mirror.json"), "utf8")).toBe(before);
  });

  it("#X6 failed choice write fails the grant; nothing is pinned and the snapshot is unchanged", () => {
    const r = mkdir("r");
    const pinned: string[] = [];
    const { svc } = setup({ writeAtomic: () => { throw enospc(); } }, { pinned });
    expect(() => svc.grant("pinned", r, false, () => pinned.push(r))).toThrow(/ENOSPC/);
    expect(pinned).toEqual([]);
    expect(fs.existsSync(path.join(root, "cfg", "pi-trust-mirror.json"))).toBe(false);
  });

  it("failed source write rolls the choice back", () => {
    const r = mkdir("r");
    const { svc } = setup({}, { pinned: [] });
    expect(() => svc.grant("pinned", r, false, () => { throw new Error("store down"); })).toThrow(/store down/);
    expect(svc.choiceFor("pinned", r)).toBeUndefined();
  });

  it("#X7 unreadable choices file → entries do not count, reason choice-unreadable", () => {
    const r = mkdir("r");
    fs.mkdirSync(path.join(root, "cfg"), { recursive: true });
    fs.writeFileSync(path.join(root, "cfg", "pi-trust-overrides.json"), "{");
    const { svc } = setup({}, { pinned: [r] });
    const ev = svc.evaluate();
    expect(ev.counted).toHaveLength(0);
    expect(ev.ignored[0]).toMatchObject({ reason: "choice-unreadable" });
    expect(ev.choicesReadable).toBe(false);
  });

  it("#X8 worktree-store write failure is reported (strict) and the snapshot is already without the entry", () => {
    const r = repoWithHook("wt");
    const hash = hookDefHash(hook);
    recordTrust(r, hash);
    const { svc } = setup();
    svc.rewriteSnapshot();
    expect(svc.readSnapshot()?.entries).toHaveLength(1);
    // Make the persisted store read-only so the strict write fails.
    const storeFile = path.join(root, "home", ".pi", "dashboard", "worktree-init-trust.json");
    fs.chmodSync(storeFile, 0o400);
    try {
      if (process.getuid?.() === 0) return; // root ignores file modes (CI containers)
      expect(() => svc.revoke("worktreeInit", r, () => revokeTrust(r, hash, { strict: true }))).toThrow();
      expect(svc.readSnapshot()?.entries).toHaveLength(0);
    } finally {
      fs.chmodSync(storeFile, 0o600);
    }
  });

  it("#X9 boot rebuild picks up a pin missing from a stale snapshot, with a higher generation", () => {
    const r = mkdir("r");
    const { svc, st } = setup();
    const g1 = svc.rewriteSnapshot();
    expect(svc.readSnapshot()?.entries).toHaveLength(0);
    st.pinned.push(r); // pin persisted, snapshot stale (crash before rewrite)
    const rebooted = setup({}, { pinned: [r] }).svc;
    const g2 = rebooted.rebuildAtBoot();
    expect(g2).toBeGreaterThan(g1);
    expect(rebooted.readSnapshot()?.entries.map((e) => e.key)).toEqual([r]);
  });
});
