import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessGrants, accessGrantsStorePath, listGrants, recordGrant } from "../access-grants.js";
import type { HostGateMode } from "../prompt-channel.js";
import {
  createDefaultProvisioningGrantStore,
  PROVISION_NO_REASON,
  PROVISION_TTL_MS,
  type ProvisioningDeps,
  type ProvisioningFs,
  ProvisioningRegistry,
  type ProvisionRequestView,
  toProvisionRequestMessage,
  validateProjectRoot,
} from "../provisioning.js";
import { __resetRefusalLedger, isRefused } from "../refusal-ledger.js";
import { YoloController } from "../yolo-session.js";

/**
 * Provisioning registry (change: add-access-provisioning, tasks 2.1/2.2;
 * test-plan #E3-#E6, #E8-#E11, #E13-#E17, #E20, #E21, #E28, #P1, #X5-#X8).
 * Real filesystem fixture + the real grant store (PI_ACCESS_GRANTS_STORE); time is injected.
 */

const MIN = 60_000;
const T0 = 1_000_000;

let tmp: string;
let home: string;
let w: string;
let clock: number;
let logs: string[];
let terminals: Array<[string, string]>;

const dir = (...segs: string[]) => {
  const p = path.join(...segs);
  fs.mkdirSync(p, { recursive: true });
  return p;
};
const touch = (p: string) => fs.writeFileSync(p, "x");

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prov-")));
  w = dir(tmp, "w");
  home = dir(tmp, "home");
  clock = T0;
  logs = [];
  terminals = [];
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  process.env.PI_ACCESS_REFUSALS_STORE = path.join(tmp, "access-refusals.json");
  __resetAccessGrants();
  __resetRefusalLedger();
  // project roots
  dir(w, "app", ".git");
  for (const n of ["p1", "p2", "p3", "p4", "p5"]) dir(w, n, ".git");
  // folders
  for (const n of ["lib", "lib2", "real"]) dir(w, n);
  dir(w, "app", "docs");
  touch(path.join(w, "app", "README"));
  fs.symlinkSync(path.join(w, "real"), path.join(w, "link"));
  fs.symlinkSync(path.join(w, "app"), path.join(w, "applink"));
  // fake $HOME
  for (const n of [".ssh/x", ".pi", ".aws/sub", ".gnupg", ".kube", ".docker", "Library/Keychains", "proj"]) dir(home, n);
  fs.symlinkSync(path.join(home, ".gnupg"), path.join(w, "creds"));
});

afterEach(() => {
  delete process.env.PI_ACCESS_GRANTS_STORE;
  delete process.env.PI_ACCESS_REFUSALS_STORE;
  __resetAccessGrants();
  __resetRefusalLedger();
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Harness {
  reg: ProvisioningRegistry;
  state: { kill: boolean; prompt: boolean; mode: HostGateMode; operators: number };
  setChoice: ReturnType<typeof vi.fn>;
}

function mk(over: Partial<ProvisioningDeps> = {}): Harness {
  const state = { kill: false, prompt: true, mode: "enforce" as HostGateMode, operators: 1 };
  const setChoice = vi.fn();
  const reg = new ProvisioningRegistry({
    now: () => clock,
    grants: createDefaultProvisioningGrantStore(),
    mirror: () => ({ setChoice }),
    ladder: {
      killSwitch: () => state.kill,
      promptEnabled: () => state.prompt,
      hostGateMode: () => state.mode,
      operatorCount: () => state.operators,
    },
    env: { homedir: home, platform: "darwin" },
    log: (l) => logs.push(l),
    onTerminal: (id, reason) => terminals.push([id, reason]),
    ...over,
  });
  return { reg, state, setChoice };
}

const ok = (r: ReturnType<ProvisioningRegistry["create"]>): ProvisionRequestView => {
  if (!r.ok) throw new Error(`create refused: ${r.error}`);
  return r.request;
};
const create = (h: Harness, lines: unknown[], root = path.join(w, "app"), remote: string[] = []) =>
  h.reg.create({ projectRoot: root, lines, remote });
const classes = (v: ProvisionRequestView) => v.lines.map((l) => l.classification);
const approveAll = (v: ProvisionRequestView) => ({
  lines: v.lines.map((l) => ({ lineId: l.lineId, verdict: "approve" as const })),
});
const rejectAll = () => ({ lines: [] });
const grantSubjects = () => listGrants().map((g) => g.subject);

/** Seed the persisted store with `n` distinct synthetic subjects (+ optional real ones). */
function seed(subjects: string[]) {
  fs.writeFileSync(
    accessGrantsStorePath(),
    JSON.stringify({ version: 1, grants: subjects.map((subject, i) => ({ subject, scope: "project", grantedAt: i + 1, origin: "seed" })) }),
  );
  __resetAccessGrants();
}
const synthetic = (n: number) => Array.from({ length: n }, (_, i) => `/seed/s${i}`);

describe("2.9 / #E3 classification decision table", () => {
  it("classifies each line by the first matching rule", () => {
    recordGrant({ subject: path.join(w, "lib") });
    const h = mk();
    const v = ok(
      create(h, [
        { path: "" },
        { path: "~bob/x" },
        { path: "a\0b" },
        { path: path.join(w, "missing") },
        { path: path.join(w, "app", "README") },
        { path: "~" },
        { path: "~/.aws" },
        { path: "~/Library" },
        { path: path.join(w, "app", "docs") },
        { path: path.join(w, "lib") },
        { path: path.join(w, "lib2") },
      ]),
    );
    expect(classes(v)).toEqual([
      "invalid", "invalid", "invalid", "missing", "missing", "forbidden", "sensitive", "sensitive", "in-root", "covered", "grantable",
    ]);
  });

  it("a line below the project root is in-root even when a grant covers it", () => {
    recordGrant({ subject: w });
    const v = ok(create(mk(), [{ path: path.join(w, "app", "docs") }, { path: path.join(w, "lib") }]));
    expect(classes(v)).toEqual(["in-root", "covered"]);
  });

  it("a non-string path and a >4096 character path are invalid", () => {
    const v = ok(create(mk(), [{ path: 42 }, { path: `/${"a".repeat(4096)}` }, "bare string", null]));
    expect(classes(v)).toEqual(["invalid", "invalid", "invalid", "invalid"]);
  });
});

describe("2.10 / #E4 real-path collapse", () => {
  it("collapses lines with the same real path and keeps the first reason", () => {
    const v = ok(create(mk(), [{ path: path.join(w, "link"), why: "a" }, { path: path.join(w, "real"), why: "b" }]));
    expect(v.lines).toHaveLength(1);
    expect(v.lines[0]).toMatchObject({ path: path.join(w, "real"), why: "a", classification: "grantable" });
  });
});

describe("2.11 / #E5 relative and home-rooted expansion", () => {
  it("expands against the project root and the home directory", () => {
    const v = ok(create(mk(), [{ path: "../lib" }, { path: "~/proj" }]));
    expect(v.lines.map((l) => [l.path, l.classification])).toEqual([
      [path.join(w, "lib"), "grantable"],
      [path.join(home, "proj"), "grantable"],
    ]);
  });
});

describe("2.12 / #E6 credential folders and their ancestors", () => {
  it("refuses credential folders, their ancestors and symlinks into them", () => {
    const v = ok(
      create(mk(), [
        { path: "~/.ssh/x" }, { path: "~/.pi" }, { path: "~/.aws/sub" }, { path: "~/.gnupg" }, { path: "~/.kube" },
        { path: "~/.docker" }, { path: "~/Library/Keychains" }, { path: "~/Library" },
      ]),
    );
    expect(classes(v)).toEqual([
      "forbidden", "forbidden", "sensitive", "sensitive", "sensitive", "sensitive", "sensitive", "sensitive",
    ]);
    expect(classes(v)).not.toContain("grantable");
  });

  it("a symlink into a credential folder is sensitive, and collapses onto the real folder", () => {
    const v = ok(create(mk(), [{ path: path.join(w, "creds") }]));
    expect(v.lines).toMatchObject([{ path: path.join(home, ".gnupg"), classification: "sensitive" }]);
    expect(ok(create(mk(), [{ path: path.join(w, "creds") }, { path: "~/.gnupg" }])).lines).toHaveLength(1);
  });

  it("Library/Keychains is a credential folder on macOS only", () => {
    const h = mk({ env: { homedir: home, platform: "linux" } });
    expect(classes(ok(create(h, [{ path: "~/Library" }])))).toEqual(["grantable"]);
  });
});

describe("D8 project-root validation helper", () => {
  it("applies the root decision table", () => {
    const opts = { env: { homedir: home, platform: "darwin" as const } };
    dir(w, "nogit");
    dir(w, "onlypi", ".pi");
    touch(path.join(w, "file.txt"));
    dir(home, ".git");
    const real = (p: string) => path.join(w, p);
    expect(validateProjectRoot("app", opts)).toEqual({ ok: false, reason: "not-absolute" });
    expect(validateProjectRoot(real("nogit"), opts)).toEqual({ ok: false, reason: "no-marker" });
    expect(validateProjectRoot(home, opts)).toEqual({ ok: false, reason: "forbidden" });
    expect(validateProjectRoot(real("file.txt"), opts)).toEqual({ ok: false, reason: "not-directory" });
    expect(validateProjectRoot(real("absent"), opts)).toEqual({ ok: false, reason: "missing" });
    expect(validateProjectRoot(real("onlypi"), opts)).toEqual({ ok: true, real: real("onlypi") });
    expect(validateProjectRoot(real("applink"), opts)).toEqual({ ok: true, real: real("app") });
  });
});

describe("2.14 / #E8 pending key aliasing", () => {
  it("a trailing slash and a symlink alias are the same pending root", () => {
    const h = mk();
    const first = ok(create(h, [{ path: "../lib" }]));
    for (const alias of [`${path.join(w, "app")}/`, path.join(w, "applink")]) {
      expect(create(h, [{ path: "../lib" }], alias)).toMatchObject({
        ok: false, status: 409, error: "pending-exists", requestId: first.requestId,
      });
    }
  });
});

describe("2.15 / #E9 pending-total bound", () => {
  it("accepts the 4th pending request and refuses the 5th with capacity", () => {
    const h = mk({ limits: { globalRateMax: 99 } });
    for (const n of ["app", "p1", "p2", "p3"]) ok(create(h, [{ path: "../lib" }], path.join(w, n)));
    expect(h.reg.list()).toHaveLength(4);
    expect(create(h, [{ path: "../lib" }], path.join(w, "p4"))).toMatchObject({ ok: false, status: 429, error: "capacity" });
  });
});

describe("2.16 / #E10 creation rate limits", () => {
  it("allows one creation per root per 60 s", async () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    await h.reg.settle(v.requestId, approveAll(v));
    clock = T0 + 59_000;
    expect(create(h, [{ path: "../lib2" }])).toMatchObject({ ok: false, status: 429, error: "rate-limited", retryAfterMs: 1000 });
    clock = T0 + 60_000;
    expect(create(h, [{ path: "../lib2" }]).ok).toBe(true);
  });

  it("allows 3 creations per 10 minutes across roots", () => {
    const h = mk();
    for (const [i, n] of ["p1", "p2", "p3"].entries()) {
      clock = T0 + i * 1000;
      ok(create(h, [{ path: "../lib" }], path.join(w, n)));
    }
    clock = T0 + 10 * MIN - 1000;
    expect(create(h, [{ path: "../lib" }], path.join(w, "p4"))).toMatchObject({ ok: false, status: 429, error: "rate-limited" });
    clock = T0 + 10 * MIN;
    expect(create(h, [{ path: "../lib" }], path.join(w, "p4")).ok).toBe(true);
  });
});

describe("2.17 / #E11 cooldown state machine", () => {
  type End = (h: Harness, v: ProvisionRequestView) => Promise<number>;
  const cases: Array<[string, End, boolean]> = [
    ["settled with no approval", async (h, v) => { await h.reg.settle(v.requestId, rejectAll()); return T0; }, true],
    ["dismissed", async (h, v) => { h.reg.dismiss(v.requestId); return T0; }, true],
    ["expired", async (h) => { clock = T0 + PROVISION_TTL_MS; h.reg.expire(); return T0 + PROVISION_TTL_MS; }, true],
    ["settled with one approval", async (h, v) => { await h.reg.settle(v.requestId, approveAll(v)); return T0; }, false],
  ];
  it.each(cases)("%s", async (_name, end, cools) => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    const endedAt = await end(h, v);
    clock = endedAt + MIN;
    const again = create(h, [{ path: "../lib2" }]);
    if (cools) {
      expect(again).toMatchObject({ ok: false, status: 429, error: "cooldown" });
      clock = endedAt + 5 * MIN;
      expect(create(h, [{ path: "../lib2" }]).ok).toBe(true);
    } else {
      expect(again.ok).toBe(true);
    }
  });
});

describe("D7 eligibility ladder order (registry side of #E12)", () => {
  it("the first failing rung wins, in order", () => {
    const h = mk();
    h.state.kill = true;
    h.state.prompt = false;
    h.state.mode = "report";
    h.state.operators = 0;
    const err = () => (create(h, [{ path: "../lib" }]) as { error: string; status: number });
    expect(err()).toMatchObject({ status: 503, error: "disabled" });
    h.state.kill = false;
    expect(err()).toMatchObject({ status: 409, error: "prompting-disabled" });
    h.state.prompt = true;
    expect(err()).toMatchObject({ status: 409, error: "report-mode" });
    h.state.mode = "enforce";
    expect(err()).toMatchObject({ status: 409, error: "no-operator" });
    h.state.operators = 1;
    expect(create(h, [{ path: "../lib" }]).ok).toBe(true);
  });

  it("empty and oversized requests are refused; remote goals alone are accepted", () => {
    const h = mk();
    expect(create(h, [])).toMatchObject({ status: 400, error: "empty" });
    expect(create(h, [], undefined, ["lan"]).ok).toBe(true);
    const lines = (n: number) => Array.from({ length: n }, () => ({ path: "../lib" }));
    expect(create(h, lines(33), path.join(w, "p1"))).toMatchObject({ status: 400, error: "too-many-lines" });
    expect(h.reg.list()).toHaveLength(1);
    expect(create(h, lines(32), path.join(w, "p1")).ok).toBe(true);
  });
});

describe("2.19 / #E13 YOLO never answers a provisioning line", () => {
  it("an unscoped YOLO session leaves the request pending and writes nothing", async () => {
    const yolo = new YoloController({
      now: () => clock,
      hostGateMode: () => "enforce",
      isRefused,
      ladder: async () => [],
      onLog: () => {},
    });
    await yolo.activate({ durationMs: 15 * MIN, base: w, unscoped: true });
    expect(yolo.status()?.unscoped).toBe(true);
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    clock += 30_000;
    expect(h.reg.get(v.requestId)?.status).toBe("pending");
    expect(yolo.history()).toHaveLength(0);
    expect(listGrants()).toHaveLength(0);
  });
});

describe("2.20 / #E14 a line swapped after display ends `changed`", () => {
  it("writes no grant and revokes nothing when the folder became a symlink", async () => {
    const secret = dir(w, "secret");
    const swap = dir(w, "swap");
    const revoke = vi.fn(() => true);
    const h = mk({ grants: { ...createDefaultProvisioningGrantStore(), revoke } });
    const v = ok(create(h, [{ path: swap }]));
    fs.rmSync(swap, { recursive: true });
    fs.symlinkSync(secret, swap);
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines[0]).toMatchObject({ outcome: "changed" });
    expect(grantSubjects()).toEqual([]);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("a swap that lands AFTER the async phase is still caught by the synchronous compare", async () => {
    const swap = dir(w, "swap2");
    const base = (await import("../provisioning.js")).defaultProvisioningFs;
    const racing: ProvisioningFs = { ...base, realpathStrict: (p) => (p === swap ? path.join(w, "secret") : base.realpathStrict(p)) };
    const h = mk({ fs: racing });
    const v = ok(create(h, [{ path: swap }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines[0]).toMatchObject({ outcome: "changed" });
    expect(grantSubjects()).toEqual([]);
  });

  it("a stored subject that differs from the shown path is revoked and ends `changed`", async () => {
    const wrong = path.join(w, "elsewhere");
    const revoke = vi.fn(() => true);
    const h = mk({
      grants: {
        list: () => [],
        cap: 200,
        record: (input) => ({ ok: true, grant: { subject: wrong, scope: "project", grantedAt: 1, origin: input.origin ?? "" } }),
        revoke,
      },
    });
    const v = ok(create(h, [{ path: "../lib" }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines[0]).toMatchObject({ outcome: "changed" });
    expect(revoke).toHaveBeenCalledWith(wrong, "project");
  });
});

describe("2.21 / #E15 project-root re-validation at settle", () => {
  it("a root that lost its marker refuses every approved line", async () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }, { path: "../lib2" }]));
    fs.rmSync(path.join(w, "app", ".git"), { recursive: true });
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => [l.outcome, l.reason])).toEqual([
      ["refused", "root-changed"],
      ["refused", "root-changed"],
    ]);
    expect(grantSubjects()).toEqual([]);
  });
});

describe("2.22 / #E16 approval writes a provisioned grant the bridge admits", () => {
  it("stores {subject, scope, via, origin} and the bridge GrantCache admits a path below it", async () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.status).toBe("settled");
    const lib = path.join(w, "lib");
    expect(listGrants()).toEqual([
      expect.objectContaining({ subject: lib, scope: "project", via: "provision", origin: path.join(w, "app") }),
    ]);
    // Bridge reader, loaded by computed path: a static import would put extension sources outside this package's tsc rootDir.
    const bridge = path.resolve(import.meta.dirname, "../../../../extension/src/path-gate/grant-cache.js");
    const { GrantCache } = (await import(/* @vite-ignore */ bridge)) as {
      GrantCache: new (o: { file: string }) => { get(): readonly string[] };
    };
    const subjects = new GrantCache({ file: accessGrantsStorePath() }).get();
    const x = path.join(lib, "x");
    expect(subjects.some((s) => path.relative(s, x) !== "" && !path.relative(s, x).startsWith(".."))).toBe(true);
  });
});

describe("2.23 / #E17 net-new capacity math without eviction", () => {
  const lib = () => path.join(w, "lib");
  const lib2 = () => path.join(w, "lib2");

  it("198 persisted + 2 net-new fills the store to 200", async () => {
    seed(synthetic(198));
    const h = mk();
    const v = ok(create(h, [{ path: lib() }, { path: lib2() }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => l.outcome)).toEqual(["granted", "granted"]);
    expect(listGrants()).toHaveLength(200);
  });

  it("199 persisted + 2 net-new refuses both with capacity and leaves the store unchanged", async () => {
    seed(synthetic(199));
    const before = fs.readFileSync(accessGrantsStorePath(), "utf8");
    const h = mk();
    const v = ok(create(h, [{ path: lib() }, { path: lib2() }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => [l.outcome, l.reason])).toEqual([
      ["refused", "capacity"],
      ["refused", "capacity"],
    ]);
    expect(fs.readFileSync(accessGrantsStorePath(), "utf8")).toBe(before);
  });

  it("199 persisted + 1 net-new + 1 already granted grants both (existing is idempotent)", async () => {
    seed(synthetic(198));
    const h = mk();
    const v = ok(create(h, [{ path: lib() }, { path: lib2() }]));
    recordGrant({ subject: lib() }); // granted meanwhile (e.g. via a denial prompt): 199
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => l.outcome)).toEqual(["granted", "granted"]);
    expect(listGrants()).toHaveLength(200);
  });
});

describe("2.24 / #E20 per-line pi-trust choice", () => {
  it("stores an explicit choice only for granted project-root lines", async () => {
    dir(w, "m1", ".git");
    dir(w, "m2", ".pi");
    dir(w, "m3", ".git");
    dir(w, "plain");
    const h = mk();
    const v = ok(create(h, ["m1", "m2", "m3", "plain"].map((n) => ({ path: path.join(w, n) }))));
    expect(v.lines.map((l) => l.projectRoot)).toEqual([true, true, true, undefined]);
    expect(toProvisionRequestMessage(v, clock).lines.map((l) => l.projectRoot)).toEqual([true, true, true, undefined]);
    const id = (i: number) => v.lines[i].lineId;
    const r = await h.reg.settle(v.requestId, {
      lines: [
        { lineId: id(0), verdict: "approve", piTrust: true },
        { lineId: id(1), verdict: "approve" },
        { lineId: id(2), verdict: "reject", piTrust: true },
        { lineId: id(3), verdict: "approve" },
      ],
    });
    expect(r.ok && r.request.lines.map((l) => l.outcome)).toEqual(["granted", "granted", "rejected", "granted"]);
    expect(h.setChoice.mock.calls).toEqual([
      ["accessGrants", path.join(w, "m1"), true],
      ["accessGrants", path.join(w, "m2"), false],
    ]);
  });

  it("stores no choice for a line that did not end granted", async () => {
    dir(w, "m4", ".git");
    seed(synthetic(200));
    const h = mk();
    const v = ok(create(h, [{ path: path.join(w, "m4") }]));
    await h.reg.settle(v.requestId, { lines: [{ lineId: v.lines[0].lineId, verdict: "approve", piTrust: true }] });
    expect(h.setChoice).not.toHaveBeenCalled();
  });
});

describe("2.25 / #E21 reasons are bounded and inert", () => {
  it("bounds, strips and marks reasons in views", () => {
    const why = [undefined, "x".repeat(200), "x".repeat(201), "x".repeat(500), "x\n[access-provision] settled id=evil", "<b>x</b>", "   "];
    const lines = why.map((y, i) => ({ path: dir(w, `r${i}`), why: y }));
    const v = ok(create(mk(), lines));
    const got = v.lines.map((l) => l.why);
    expect(got[0]).toBe(PROVISION_NO_REASON);
    expect(got[1]).toBe("x".repeat(200));
    expect(got[2]).toBe(`${"x".repeat(200)}…`);
    expect(got[3]).toBe(`${"x".repeat(200)}…`);
    expect(got[4]).toBe("x[access-provision] settled id=evil");
    expect(got[5]).toBe("<b>x</b>");
    expect(got[6]).toBe(PROVISION_NO_REASON);
  });

  it("a reason cannot forge a log line", () => {
    ok(create(mk(), [{ path: "../lib", why: "x\n[access-provision] settled id=evil" }]));
    expect(logs.some((l) => l.startsWith("[access-provision] settled id=evil"))).toBe(false);
    expect(logs.every((l) => !l.includes("\n") && l.startsWith("[access-provision] "))).toBe(true);
    const line = logs.find((l) => l.includes("evil"));
    expect(line).toContain(`why=${JSON.stringify("x[access-provision] settled id=evil")}`);
  });

  it("logs one transition line per created request with a JSON-quoted project", () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    expect(logs).toContain(
      `[access-provision] created id=${v.requestId} project=${JSON.stringify(path.join(w, "app"))} lines=1`,
    );
  });
});

describe("2.27 / #E28 terminal transitions are first-wins", () => {
  it.each(["settled", "dismissed", "expired"] as const)("a %s request refuses a second answer", async (how) => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    if (how === "settled") await h.reg.settle(v.requestId, rejectAll());
    if (how === "dismissed") h.reg.dismiss(v.requestId);
    if (how === "expired") {
      clock = T0 + PROVISION_TTL_MS;
      h.reg.expire();
    }
    const before = h.reg.get(v.requestId);
    expect(await h.reg.settle(v.requestId, approveAll(v))).toMatchObject({ ok: false, status: 409, error: "already-settled" });
    expect(h.reg.dismiss(v.requestId)).toMatchObject({ ok: false, status: 409, error: "already-settled" });
    expect(h.reg.get(v.requestId)).toEqual(before);
    expect(before?.status).toBe(how);
    expect(listGrants()).toEqual([]);
    expect(terminals).toEqual([[v.requestId, how]]);
  });

  it("two concurrent answers: exactly one applies (whichever reaches the sync section first)", async () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    const results = await Promise.all([h.reg.settle(v.requestId, approveAll(v)), h.reg.settle(v.requestId, approveAll(v))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toMatchObject([{ error: "already-settled", status: 409 }]);
    expect(grantSubjects()).toEqual([path.join(w, "lib")]);
    expect(terminals).toEqual([[v.requestId, "settled"]]);
  });

  it("an unknown id is not-found; a malformed response leaves the request pending", async () => {
    const h = mk();
    expect(await h.reg.settle("nope", rejectAll())).toMatchObject({ ok: false, status: 404, error: "not-found" });
    const v = ok(create(h, [{ path: "../lib" }]));
    expect(await h.reg.settle(v.requestId, { lines: "x" } as never)).toMatchObject({ ok: false, status: 400 });
    expect(h.reg.get(v.requestId)?.status).toBe("pending");
  });
});

describe("2.28 / #P1 the synchronous settle section is fast", () => {
  it("32 grantable lines against a 168-grant store: sync section < 50 ms", async () => {
    seed(synthetic(168));
    const names = Array.from({ length: 32 }, (_, i) => dir(w, `perf${i}`));
    const base = (await import("../provisioning.js")).defaultProvisioningFs;
    let lastAwait = 0;
    let sync = Number.NaN;
    const timed: ProvisioningFs = {
      ...base,
      inspectAsync: async (p) => {
        const f = await base.inspectAsync(p);
        lastAwait = performance.now();
        return f;
      },
    };
    const h = mk({
      fs: timed,
      onTerminal: () => {
        sync = performance.now() - lastAwait;
      },
    });
    const v = ok(create(h, names.map((n) => ({ path: n }))));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.every((l) => l.outcome === "granted")).toBe(true);
    expect(listGrants()).toHaveLength(200);
    expect(sync).toBeLessThan(50);
  });
});

describe("2.33 / #X5 the ladder is re-checked at settle", () => {
  it.each([
    ["host gate in report mode", (s: Harness["state"]) => { s.mode = "report"; }, "report-mode"],
    ["kill switch set", (s: Harness["state"]) => { s.kill = true; }, "disabled"],
    ["prompting disabled", (s: Harness["state"]) => { s.prompt = false; }, "prompting-disabled"],
  ])("%s refuses the answer and the request stays pending until expiry", async (_n, flip, error) => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    flip(h.state);
    expect(await h.reg.settle(v.requestId, approveAll(v))).toMatchObject({ ok: false, error });
    expect(h.reg.get(v.requestId)?.status).toBe("pending");
    expect(listGrants()).toEqual([]);
    clock = T0 + PROVISION_TTL_MS;
    expect(h.reg.get(v.requestId)?.status).toBe("expired");
    expect(listGrants()).toEqual([]);
  });
});

describe("2.34 / #X6 a mid-settle store write failure", () => {
  it("fails only that line; later lines still run and the store is not widened for it", async () => {
    const real = createDefaultProvisioningGrantStore();
    let calls = 0;
    const h = mk({
      grants: {
        ...real,
        record: (input) => {
          calls += 1;
          return calls === 2 ? { ok: false, error: "ENOSPC" } : real.record(input);
        },
      },
    });
    const names = ["lib", "lib2", "real"].map((n) => path.join(w, n));
    const v = ok(create(h, names.map((n) => ({ path: n }))));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => l.outcome)).toEqual(["granted", "failed", "granted"]);
    expect(grantSubjects().sort()).toEqual([names[0], names[2]].sort());
    expect(h.reg.get(v.requestId)?.status).toBe("settled");
  });

  it("a recordGrant that throws also ends only that line", async () => {
    const real = createDefaultProvisioningGrantStore();
    let calls = 0;
    const h = mk({
      grants: { ...real, record: (i) => { calls += 1; if (calls === 1) throw new Error("boom"); return real.record(i); } },
    });
    const v = ok(create(h, [{ path: path.join(w, "lib") }, { path: path.join(w, "lib2") }]));
    const r = await h.reg.settle(v.requestId, approveAll(v));
    expect(r.ok && r.request.lines.map((l) => l.outcome)).toEqual(["failed", "granted"]);
  });
});

describe("2.35 / #X7 expiry at the 10-minute boundary", () => {
  it("is pending at 9:59 and expired at 10:00 with a dismiss, no grant and a cooldown", () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    clock = T0 + PROVISION_TTL_MS - 1000;
    expect(h.reg.expire()).toEqual([]);
    expect(h.reg.get(v.requestId)?.status).toBe("pending");
    clock = T0 + PROVISION_TTL_MS;
    expect(h.reg.expire().map((r) => r.requestId)).toEqual([v.requestId]);
    expect(h.reg.get(v.requestId)?.status).toBe("expired");
    expect(terminals).toEqual([[v.requestId, "expired"]]);
    expect(listGrants()).toEqual([]);
    clock += MIN;
    expect(create(h, [{ path: "../lib" }])).toMatchObject({ ok: false, error: "cooldown" });
    expect(h.reg.stats()).toMatchObject({ expired: 1, pending: 0 });
  });
});

describe("2.36 / #X8 a restart loses pending requests", () => {
  it("a new registry instance reports 404-equivalent and the store is unchanged", () => {
    const h = mk();
    const v = ok(create(h, [{ path: "../lib" }]));
    const before = fs.existsSync(accessGrantsStorePath());
    const restarted = mk();
    expect(restarted.reg.get(v.requestId)).toBeUndefined();
    expect(restarted.reg.list()).toEqual([]);
    expect(fs.existsSync(accessGrantsStorePath())).toBe(before);
    expect(listGrants()).toEqual([]);
  });
});

describe("stats and per-line outcomes (#E27, #X10 registry side)", () => {
  it("settled request reports outcomes and the health counters add up", async () => {
    const h = mk({ limits: { globalRateMax: 99 } });
    const v = ok(create(h, [{ path: "../lib" }, { path: "../lib2" }], undefined, ["lan"]));
    const r = await h.reg.settle(v.requestId, { lines: [{ lineId: v.lines[0].lineId, verdict: "approve" }] });
    expect(r.ok && r.request).toMatchObject({
      status: "settled",
      lines: [{ outcome: "granted" }, { outcome: "rejected" }],
      remote: [{ target: "lan", outcome: "handed-off" }],
    });
    const e = ok(create(h, [{ path: "../lib" }], path.join(w, "p1")));
    clock += PROVISION_TTL_MS;
    h.reg.expire();
    expect(create(h, [], path.join(w, "p2"))).toMatchObject({ ok: false });
    h.reg.recordDroppedResponse();
    expect(h.reg.stats()).toEqual({ pending: 0, created: 2, approved: 1, rejected: 1, dismissed: 0, expired: 1, refused: 1, droppedResponses: 1 });
    expect(logs).toContain("[access-provision] response-dropped reason=no-capability");
    expect(logs.some((l) => l.startsWith(`[access-provision] expired id=${e.requestId} project=`))).toBe(true);
  });

  it("dismissAll dismisses every pending request and starts each cooldown", () => {
    const h = mk({ limits: { globalRateMax: 99 } });
    for (const n of ["p1", "p2", "p3"]) ok(create(h, [{ path: "../lib" }], path.join(w, n)));
    expect(h.reg.dismissAll()).toBe(3);
    expect(h.reg.list()).toEqual([]);
    expect(terminals.map((t) => t[1])).toEqual(["dismissed", "dismissed", "dismissed"]);
    clock += MIN;
    expect(create(h, [{ path: "../lib" }], path.join(w, "p1"))).toMatchObject({ error: "cooldown" });
  });
});
