import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessGrants, accessGrantsStorePath, listGrants } from "../access-grants.js";
import type { HostGateMode } from "../prompt-channel.js";
import {
  createDefaultProvisioningGrantStore,
  type ProvisioningDeps,
  type ProvisioningFs,
  ProvisioningRegistry,
  type ProvisionRequestView,
} from "../provisioning.js";
import { __resetRefusalLedger } from "../refusal-ledger.js";

/**
 * Budget lane (`*.budget.test.*`: excluded from blocking runs by `BUDGET_TEST_EXCLUDE`, collected when the
 * nightly `budget` job sets RUN_BUDGET_TESTS=1; no env gate of its own).
 *
 * Provisioning #P1 (test-plan #P1, #E28): the synchronous settle section is < 50 ms. The setup below is a
 * verbatim copy of `provisioning.test.ts` (design D6 "provisioning"); the functional grant assertions
 * (every line granted, 200 grants) stay asserted by the blocking file.
 *
 * Split from `provisioning.test.ts`. See change: stabilize-blocking-test-lanes.
 */

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
const approveAll = (v: ProvisionRequestView) => ({
  lines: v.lines.map((l) => ({ lineId: l.lineId, verdict: "approve" as const })),
});

/** Seed the persisted store with `n` distinct synthetic subjects (+ optional real ones). */
function seed(subjects: string[]) {
  fs.writeFileSync(
    accessGrantsStorePath(),
    JSON.stringify({ version: 1, grants: subjects.map((subject, i) => ({ subject, scope: "project", grantedAt: i + 1, origin: "seed" })) }),
  );
  __resetAccessGrants();
}
const synthetic = (n: number) => Array.from({ length: n }, (_, i) => `/seed/s${i}`);

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
