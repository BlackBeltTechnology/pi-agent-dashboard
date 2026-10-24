/**
 * The containment decision carries the path it decided, on every return point of
 * `evaluateContainment`, and `decidePassive` repeats today's layer + grant decision
 * without recording a denial (test-plan #E3, #E4, #E5, #E6, #X1).
 *
 * See change: codeql-file-containment-barrier.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containmentAllows } from "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials, listPathDenials } from "../access-denials.js";
import { decidePassive, evaluateContainment } from "../containment-gate.js";

const h = vi.hoisted(() => ({
  secret: new Set<string>(),
  subjects: [] as string[],
  hold: vi.fn(),
}));

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
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "containment-path-")));
  k = path.join(root, "K");
  out = path.join(root, "OUT");
  fs.mkdirSync(k);
  fs.mkdirSync(out);
  for (const f of [path.join(k, "a.txt"), path.join(k, "b.txt"), path.join(out, "x.txt"), path.join(out, "y.txt")]) fs.writeFileSync(f, "x");
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

describe("evaluateContainment carries the decided path (#E4)", () => {
  it("layer allow", async () => {
    const p = path.join(k, "a.txt");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d).toMatchObject({ allowed: true, viaGrant: false, resolved: p });
  });

  it("grant allow", async () => {
    h.subjects = [out];
    const p = path.join(out, "x.txt");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d).toMatchObject({ allowed: true, viaGrant: true, resolved: p });
  });

  it("refusal", async () => {
    const p = path.join(out, "y.txt");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d).toMatchObject({ allowed: false, resolved: p });
  });

  it("dashboard-secret refusal", async () => {
    const p = path.join(k, "a.txt");
    h.secret.add(p);
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d).toMatchObject({ allowed: false, viaGrant: false, resolved: p });
  });

  it("allowGrant:false refusal (early return)", async () => {
    h.subjects = [out];
    const p = path.join(out, "x.txt");
    const d = await evaluateContainment(p, [k], { site: "t", allowGrant: false });
    expect(d).toMatchObject({ allowed: false, resolved: p });
  });

  it("quiet refusal", async () => {
    const p = path.join(out, "y.txt");
    const d = await evaluateContainment(p, [k], { site: "t", quiet: true });
    expect(d).toMatchObject({ allowed: false, resolved: p });
    expect(listPathDenials()).toHaveLength(0);
  });

  it("post-hold allow (#E5: operator-approved held read)", async () => {
    const p = path.join(out, "y.txt");
    h.hold.mockResolvedValue({ kind: "allow", verdict: "allow-once", subject: out });
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d).toMatchObject({ allowed: true, viaGrant: true, resolved: p });
    expect(containmentAllows(d, p)).toBe(true);
  });

  it("held then denied stays refused with its remedy (#X1)", async () => {
    const p = path.join(out, "y.txt");
    const d = await evaluateContainment(p, [k], { site: "t" });
    expect(d.allowed).toBe(false);
    expect(d.remedy?.denialId).toBeDefined();
    expect(containmentAllows(d, p)).toBe(false);
  });
});

describe("containmentAllows on real decisions (#E3)", () => {
  it("true only for the decided path", async () => {
    const a = path.join(k, "a.txt");
    const d = await evaluateContainment(a, [k], { site: "t" });
    expect(containmentAllows(d, a)).toBe(true);
    expect(containmentAllows(d, path.join(k, "b.txt"))).toBe(false);
  });
});

describe("decidePassive (#E6)", () => {
  it("inside an anchor: allowed with or without grants", async () => {
    const p = path.join(k, "a.txt");
    for (const allowGrant of [true, false]) {
      const d = await decidePassive(p, [k], { allowGrant });
      expect(d).toMatchObject({ allowed: true, viaGrant: false, resolved: p });
    }
  });

  it("granted path: allowed only with allowGrant", async () => {
    h.subjects = [out];
    const p = path.join(out, "x.txt");
    expect(await decidePassive(p, [k], { allowGrant: true })).toMatchObject({ allowed: true, viaGrant: true, resolved: p });
    expect(await decidePassive(p, [k], { allowGrant: false })).toMatchObject({ allowed: false, resolved: p });
  });

  it("uncovered path is refused and no denial is recorded", async () => {
    h.subjects = [out];
    const p = path.join(root, "elsewhere.txt");
    fs.writeFileSync(p, "x");
    const d = await decidePassive(p, [k], { allowGrant: true });
    expect(d).toMatchObject({ allowed: false, resolved: p });
    expect(listPathDenials()).toHaveLength(0);
    expect(h.hold).not.toHaveBeenCalled();
  });

  it("uses the supplied grant subjects instead of reading the store per call", async () => {
    h.subjects = [];
    const p = path.join(out, "x.txt");
    const d = await decidePassive(p, [k], { allowGrant: true, grantSubjects: [out] });
    expect(d).toMatchObject({ allowed: true, viaGrant: true });
  });
});
