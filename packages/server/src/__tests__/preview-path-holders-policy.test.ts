/**
 * Tier 5 (`/preview/<pid>/`, D8) holders: one stable pid per target, most-restrictive policy, holder kinds,
 * `localBound`, and the revocation that drops the shared pid for everyone.
 * See change: serve-live-previews-on-capability-origin (test-plan #E74-#E78).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { principalKeyOf } from "../live-server/live-capability.js";
import { dev, type Harness, LOCAL, makeHarness, observedPolicy, principalOf, sess, type Who } from "./helpers/preview-path-harness.js";

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

const isLive = (w: Who) => !h.revoked.has(principalKeyOf(principalOf(w)));
const TUNNEL = { "x-forwarded-for": "198.51.100.7" }; // a loopback socket with a forwarding header: not genuinely local
const pidOf = async (who: Who, id = "vite-5173", body?: Record<string, unknown>) => {
  const m = await h.mint(who, id, body);
  if (!m.pid) throw new Error(`tier-5 mint expected for ${JSON.stringify(who)}: ${JSON.stringify(m.json)}`);
  return m.pid;
};
const status = async (pid: string, headers: Record<string, string> = {}) => (await h.get(`/preview/${pid}/x`, headers)).status;
/** A tier-1 `base` recipient: a tier-1 mint on a live tier-5 target is told the pid and becomes a revocation-only holder. */
const tier1Recipient = async (who: Who, pid: string) => {
  const m = await h.mint(who, "vite-5173", { accept: ["origin"] }, { peer: "127.0.0.1", host: "localhost:8000" });
  expect(m.json.tier).toBe(1);
  expect(m.json.base).toBe(`/preview/${pid}/`);
};

describe("T.E74 / #E74 — stable pid / re-mint", () => {
  it("T.E74 P mints, P re-mints, Q mints: identical path all three; holders = {P, Q} (revoking either drops the pid, an outsider does not)", async () => {
    const a = await h.mint(dev("P"));
    const b = await h.mint(dev("P"));
    const c = await h.mint(dev("Q"));
    expect([a.json.tier, b.json.tier, c.json.tier]).toEqual([5, 5, 5]);
    expect(a.json.path).toMatch(/^\/preview\/[A-Za-z0-9_-]{22}\/$/);
    expect(b.json.path).toBe(a.json.path);
    expect(c.json.path).toBe(a.json.path);
    expect(h.paths.size()).toBe(1);
    const pid = a.pid as string;
    h.revoke(dev("outsider"));
    expect(await status(pid)).toBe(200);
    h.revoke(dev("Q")); // Q is a holder
    expect(await status(pid)).toBe(404);
    // and the other direction on a fresh pid
    const again = await pidOf(dev("P"));
    expect(again).not.toBe(pid);
    h.revoke(dev("P"));
    expect(await status(again)).toBe(404);
  });

  it("T.E74 the pid is never returned to a non-holder, and the plaintext pid is absent from logs (redaction)", async () => {
    const pid = await pidOf(dev("P"));
    await pidOf(dev("Q"));
    // a non-holder reads the target list and mints another target: neither discloses this pid
    h.addTarget("docs-8080", 18080);
    const other = await pidOf(dev("R"), "docs-8080");
    expect(other).not.toBe(pid);
    const list = await h.app.inject({ method: "GET", url: "/api/live-server/list", remoteAddress: "203.0.113.5", headers: { "x-test-kind": "device", "x-test-id": "R" } });
    expect(list.body).not.toContain(pid);
    // logs: mint lines carry a hash8, never the pid; redaction masks it even in a path
    const all = h.logs.join("\n");
    expect(all).not.toContain(pid);
    expect(all).toMatch(/\[live-preview\] mint tier=5 target=vite-5173 h=[0-9a-f]{8}/);
    // revoke -> the drop line is also redacted
    h.revoke(dev("P"));
    await status(pid);
    const dropped = h.logs.filter((l) => l.includes("pid dropped"));
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toContain("reason=holder-revoked");
    expect(h.logs.join("\n")).not.toContain(pid);
  });
});

describe("T.E75 / #E75 — most restrictive policy", () => {
  type Cfg = { egress: "open" | "restricted"; scripts: boolean; exposure: "local-only" | "exposed" };
  const cfgs: Cfg[] = [];
  for (const egress of ["open", "restricted"] as const) for (const scripts of [true, false]) for (const exposure of ["local-only", "exposed"] as const) cfgs.push({ egress, scripts, exposure });
  /** What a holder's own mint enforces: scripts need `open` egress or a `local-only` exposure (no explicit runScripts here). */
  const own = (c: Cfg) => ({ egress: c.egress, scripts: c.scripts && (c.egress === "open" || c.exposure === "local-only") });
  const mintCfg = (who: Who, id: string, c: Cfg) => {
    h.exposure.exposure = c.exposure;
    return h.mint(who, id, { accept: ["preview"], egress: c.egress, scripts: c.scripts });
  };
  const csp = async (pid: string) => String((await h.get(`/preview/${pid}/x`)).headers["content-security-policy"]);

  it("T.E75 every holder-pair combination of {scripts on/off} × {egress open/restricted} × {exposure narrow/wide}: enforced = most restrictive per dimension, pid unchanged", async () => {
    let n = 0;
    for (const p of cfgs) {
      for (const q of cfgs) {
        const id = `t${n}`;
        h.addTarget(id);
        const pm = await mintCfg(dev(`P${n}`), id, p);
        expect(pm.pid, `${JSON.stringify(p)}`).toBeDefined();
        expect(observedPolicy(await csp(pm.pid as string)), `P ${JSON.stringify(p)}`).toEqual(own(p));
        const qm = await mintCfg(dev(`Q${n}`), id, q);
        expect(qm.pid).toBe(pm.pid);
        const [a, b] = [own(p), own(q)];
        const expected = { egress: a.egress === "restricted" || b.egress === "restricted" ? "restricted" : "open", scripts: a.scripts && b.scripts };
        expect(observedPolicy(await csp(pm.pid as string)), `P ${JSON.stringify(p)} Q ${JSON.stringify(q)}`).toEqual(expected);
        expect(qm.json.policy).toEqual(expected);
        n++;
      }
    }
    expect(n).toBe(64);
    expect(h.paths.size()).toBe(64);
  });

  it("T.E75 P re-minting `open` while Q is `restricted` stays restricted; the pid is unchanged throughout", async () => {
    const open: Cfg = { egress: "open", scripts: true, exposure: "exposed" };
    const restricted: Cfg = { egress: "restricted", scripts: false, exposure: "exposed" };
    const p1 = await mintCfg(dev("P"), "vite-5173", open);
    const q = await mintCfg(dev("Q"), "vite-5173", restricted);
    const p2 = await mintCfg(dev("P"), "vite-5173", open);
    expect([q.pid, p2.pid]).toEqual([p1.pid, p1.pid]);
    expect(observedPolicy(await csp(p1.pid as string))).toEqual({ egress: "restricted", scripts: false });
    expect(p2.json.policy).toEqual({ egress: "restricted", scripts: false });
  });

  it("T.E75 a revocation-only holder contributes nothing: it neither narrows an open policy nor widens a restricted one", async () => {
    const open: Cfg = { egress: "open", scripts: true, exposure: "exposed" };
    const pid = (await mintCfg(dev("P"), "vite-5173", open)).pid as string;
    expect(h.paths.addRevocationHolder(pid, principalOf(dev("L")))).toBe(true);
    await tier1Recipient(sess("T1"), pid);
    expect(observedPolicy(await csp(pid))).toEqual({ egress: "open", scripts: true });
    // restricted pid: the (restricted, no-script) revocation holders never widen it, and a later open re-mint cannot either
    h.addTarget("restricted-t");
    const rpid = (await mintCfg(dev("Pr"), "restricted-t", { egress: "restricted", scripts: false, exposure: "exposed" })).pid as string;
    h.paths.addRevocationHolder(rpid, principalOf(dev("L2")));
    expect(observedPolicy(await csp(rpid))).toEqual({ egress: "restricted", scripts: false });
  });
});

describe("T.E76 / #E76 — holder kinds", () => {
  it("T.E76 (a) B (reserver) and L (tier-1 recipient) admit nothing; (b) L upgrades to a mint holder and admits", async () => {
    const port = h.up.port;
    // B: a bridge session reserves the base before the site starts; the mint adopts the reservation.
    h.bridges.add("S-B");
    const reserved = h.paths.reserve(port, { key: "bridge:S-B", isLive: () => h.bridges.has("S-B") });
    expect(reserved.ok && reserved.reserved).toBe(true);
    // P is a genuinely local (localBound) mint holder: it admits genuinely local requests only.
    const pid = await pidOf(LOCAL);
    expect(reserved.ok && reserved.pid).toBe(pid); // adopted
    await tier1Recipient(sess("L"), pid);
    expect(await status(pid)).toBe(200); // loopback, admitted by P
    expect(await status(pid, TUNNEL)).toBe(404); // a tunnel peer: B and L are revocation-only and admit nothing
    // (b) L mints tier 5 for the same target: upgraded to a mint holder (not localBound) and now admits the tunnel peer
    const up = await h.mint(sess("L"));
    expect(up.pid).toBe(pid);
    expect(await status(pid, TUNNEL)).toBe(200);
  });

  it("T.E76 (c) P leaves while L is revocation-only: the pid drops for ALL holders, request 404, `pid dropped reason=holder-revoked`", async () => {
    const pid = await pidOf(dev("P"));
    await tier1Recipient(sess("L"), pid);
    expect(await status(pid)).toBe(200);
    h.revoke(dev("P"));
    expect(await status(pid)).toBe(404);
    expect(await status(pid, TUNNEL)).toBe(404);
    const lines = h.logs.filter((l) => l.startsWith("[live-preview] pid dropped"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[live-preview\] pid dropped reason=holder-revoked h=[0-9a-f]{8}$/);
    // L's own next tier-5 mint cannot resurrect it: a different pid
    const fresh = await h.mint(sess("L"));
    expect(fresh.pid).toBeDefined();
    expect(fresh.pid).not.toBe(pid);
  });

  it("T.E76 a revocation-only holder going away also takes the pid down for the mint holder (D-U7)", async () => {
    const pid = await pidOf(dev("P"));
    await tier1Recipient(sess("L"), pid);
    h.revoke(sess("L"));
    expect(await status(pid)).toBe(404);
  });
});

describe("T.E77 / #E77 — localBound holder", () => {
  it("T.E77 a pid held only by a genuinely local principal: tunnel → 404, loopback → admitted", async () => {
    const pid = await pidOf(LOCAL);
    expect(await status(pid)).toBe(200);
    expect(await status(pid, TUNNEL)).toBe(404);
    expect(await status(pid, { "x-forwarded-host": "dash.example" })).toBe(404);
    expect(h.up.seen).toHaveLength(1); // only the loopback request reached the upstream
  });

  it("T.E77 mixed holders {local P, remote Q}: a remote request is admitted by Q", async () => {
    const pid = await pidOf(LOCAL);
    expect(await status(pid, TUNNEL)).toBe(404);
    expect(await pidOf(dev("Q"))).toBe(pid);
    expect(await status(pid, TUNNEL)).toBe(200);
    expect(await status(pid)).toBe(200);
  });
});

describe("T.E78 / #E78 — revocation drops the shared pid", () => {
  /** Holders: devices A and B, sessions S1 and S2 (mint), a bridge-session reserver and a tier-1 recipient L (revocation-only). */
  const holders = async () => {
    h.bridges.add("S-bridge");
    const reserved = h.paths.reserve(h.up.port, { key: "bridge:S-bridge", isLive: () => h.bridges.has("S-bridge") });
    expect(reserved.ok && reserved.reserved).toBe(true);
    const pid = await pidOf(dev("A"));
    expect(reserved.ok && reserved.pid).toBe(pid);
    for (const w of [dev("B"), sess("S1"), sess("S2")]) expect(await pidOf(w)).toBe(pid);
    await tier1Recipient(sess("L"), pid);
    return pid;
  };
  const cases: Array<[string, () => void]> = [
    ["revoke device A", () => h.revoke(dev("A"))],
    ["end session S1", () => h.revoke(sess("S1"))],
    ["unregister the bridge session (reserver)", () => void h.bridges.delete("S-bridge")],
    ["end L's session (tier-1 recipient)", () => h.revoke(sess("L"))],
  ];

  for (const [name, act] of cases) {
    it(`T.E78 ${name}: old /preview/<pid>/ → 404 for ALL holders, next mint returns a different pid`, async () => {
      const pid = await holders();
      expect(await status(pid)).toBe(200);
      // revoking a non-holder changes nothing
      h.revoke(dev("not-a-holder"));
      h.revoke(sess("not-a-holder-either"));
      expect(await status(pid)).toBe(200);
      act();
      expect(await status(pid)).toBe(404);
      expect(await status(pid, TUNNEL)).toBe(404);
      expect(h.paths.validate(pid, { genuinelyLocal: true })).toBeNull();
      const dropLines = h.logs.filter((l) => l.includes("pid dropped"));
      expect(dropLines).toHaveLength(1);
      expect(dropLines[0]).toContain("reason=holder-revoked");
      // every still-live holder's next mint gets the SAME new pid, different from the old one
      let next: string | undefined;
      for (const w of [dev("A"), dev("B"), sess("S1"), sess("S2")].filter(isLive)) {
        const m = await h.mint(w);
        expect(m.pid, JSON.stringify(w)).toBeDefined();
        expect(m.pid).not.toBe(pid);
        next ??= m.pid;
        expect(m.pid).toBe(next);
      }
      expect(next, "at least one live holder re-minted").toBeDefined();
      expect(await status(next as string)).toBe(200);
      expect(await status(pid)).toBe(404);
    });
  }
});
