/**
 * The containment decision carries the REAL path it decided on, only when it allowed: set on every allow
 * (layer ①, grant, post-hold), `undefined` on every refusal (test-plan #E31).
 *
 * Same mocking as `containment-decision-path.test.ts`; the real-path layers (`isAllowedReal` /
 * `isGrantAdmittedReal`) are NOT mocked, so `real` is what the production code computed.
 *
 * See change: close-local-listener-and-egress-gaps (D2).
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containmentAllows } from "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access-denials.js";
import { evaluateContainment } from "../containment-gate.js";

const h = vi.hoisted(() => ({ secret: new Set<string>(), subjects: [] as string[], hold: vi.fn() }));

vi.mock("../../lib/dashboard-state-guard.js", () => ({
  dashboardStateRefuses: async (p: string) => h.secret.has(p),
  currentCallerUnproven: () => false,
}));
vi.mock("../access-grants.js", () => ({ grantedSubjects: () => h.subjects }));
vi.mock("../denial-hold.js", () => ({ holdDenial: (...a: unknown[]) => h.hold(...a) }));

let root: string;
let k: string;
let out: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "containment-real-")));
  k = path.join(root, "K");
  out = path.join(root, "OUT");
  fs.mkdirSync(k);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(k, "a.txt"), "x");
  fs.writeFileSync(path.join(out, "x.txt"), "x");
  fs.writeFileSync(path.join(out, "y.txt"), "x");
  fs.symlinkSync(path.join(k, "a.txt"), path.join(k, "inlink"));
  h.secret.clear();
  h.subjects = [];
  h.hold.mockReset();
  h.hold.mockResolvedValue({ kind: "deny", reason: "no" });
  __resetPathDenials();
});
afterEach(() => {
  __resetPathDenials();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("T.31 evaluateContainment: `resolved` always, `real` only on allow", () => {
  it("allow (layer ①) carries the realpath of the decided path, not the link spelling", async () => {
    const p = path.join(k, "inlink");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d.resolved).toBe(p);
    expect(d).toMatchObject({ allowed: true, viaGrant: false, real: path.join(k, "a.txt") });
  });

  it("grant allow", async () => {
    h.subjects = [out];
    const p = path.join(out, "x.txt");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d.resolved).toBe(p);
    expect(d).toMatchObject({ allowed: true, viaGrant: true, real: p });
  });

  it("post-hold allow (allow-once, re-evaluated)", async () => {
    const p = path.join(out, "y.txt");
    h.hold.mockResolvedValue({ kind: "allow", verdict: "allow-once", subject: out });
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d.resolved).toBe(p);
    expect(d).toMatchObject({ allowed: true, viaGrant: true, real: p });
    expect(containmentAllows(d, p)).toBe(true);
  });

  it.each([
    ["plain refuse", (): [string, object] => [path.join(out, "y.txt"), {}]],
    ["dashboard-secret refuse", (): [string, object] => [path.join(k, "a.txt"), {}]],
    ["quiet refuse", (): [string, object] => [path.join(out, "y.txt"), { quiet: true }]],
    ["allowGrant:false refuse", (): [string, object] => [path.join(out, "x.txt"), { allowGrant: false }]],
  ])("%s: `resolved` set, `real` undefined", async (name, arrange) => {
    const [p, extra] = arrange();
    if (name === "dashboard-secret refuse") h.secret.add(p);
    if (name === "allowGrant:false refuse") h.subjects = [out];
    const d = await evaluateContainment(p, [k], { site: "t", ...extra });
    expect(d.allowed).toBe(false);
    expect(d.resolved).toBe(p);
    expect(d.real).toBeUndefined();
    expect(containmentAllows(d, p)).toBe(false);
  });
});
