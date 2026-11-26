/**
 * Tier 5 (`/preview/<pid>/`, D8) lifetime, bounds and races: the absolute-expiry window, idle expiry, the 32/256 pid
 * caps and their legacy fallback, slot release, and mint / sweep / revocation races.
 * See change: serve-live-previews-on-capability-origin (test-plan #E79-#E82, #X17-#X19, #X21).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { dev, type Harness, HOUR, LOCAL, MIN, type Mint, makeHarness, T0, type Who } from "./helpers/preview-path-harness.js";

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(async () => {
  await h.close();
});

const TUNNEL = { "x-forwarded-for": "198.51.100.7" };
const SEC = 1000;
const status = async (pid: string, headers: Record<string, string> = {}) => (await h.get(`/preview/${pid}/x`, headers)).status;
const local = { genuinelyLocal: true };
/** Move the fake clock to `T0 + offset`, touching `pid` every 20 min so the 30-min idle expiry never fires on the way. */
function advanceTo(offsetMs: number, keepAlive: string[]) {
  const to = T0 + offsetMs;
  while (h.clock.now < to) {
    h.clock.now = Math.min(h.clock.now + 20 * MIN, to);
    for (const pid of keepAlive) h.paths.validate(pid, local);
  }
}
const mintPid = async (who: Who, id = "vite-5173") => {
  const m = await h.mint(who, id);
  if (!m.pid) throw new Error(`tier-5 expected: ${JSON.stringify(m.json)}`);
  return m;
};
/** `n` principals-worth of pids: principal `${prefix}${k}` creates 32 distinct targets each. */
async function fill(prefix: string, principals: number, perPrincipal = 32) {
  const pids = new Map<string, string>();
  for (let k = 0; k < principals; k++) {
    for (let i = 0; i < perPrincipal; i++) {
      const id = `${prefix}${k}-${i}`;
      h.addTarget(id);
      const m = await h.mint(dev(`${prefix}${k}`), id);
      if (!m.pid) throw new Error(`mint ${id} unexpectedly refused: ${JSON.stringify(m.json)}`);
      pids.set(id, m.pid);
    }
  }
  return pids;
}

describe("T.E79 / #E79 — absolute-expiry window (20 min before the 12 h cap)", () => {
  const cases: Array<[string, number, "same" | "new"]> = [
    ["+2 h (spec scenario)", 2 * HOUR, "same"],
    ["+11 h 39 m 59 s (just outside the window)", 11 * HOUR + 39 * MIN + 59 * SEC, "same"],
    ["+11 h 40 m 00 s (the inclusive edge: exactly 20 min left)", 11 * HOUR + 40 * MIN, "new"],
    ["+11 h 40 m 01 s", 11 * HOUR + 40 * MIN + SEC, "new"],
    ["+11 h 45 m (spec scenario)", 11 * HOUR + 45 * MIN, "new"],
    ["+11 h 59 m 59 s", 11 * HOUR + 59 * MIN + 59 * SEC, "new"],
    ["+12 h 00 m 00 s (absolute expiry)", 12 * HOUR, "new"],
  ];
  for (const [name, offset, expectation] of cases) {
    it(`T.E79 re-mint at ${name} → ${expectation} pid`, async () => {
      const first = await mintPid(dev("P"));
      advanceTo(offset, [first.pid as string]);
      const again = await mintPid(dev("P"));
      if (expectation === "same") expect(again.pid).toBe(first.pid);
      else expect(again.pid).not.toBe(first.pid);
      expect(h.paths.currentPid("vite-5173")).toBe(again.pid); // one CURRENT pid per target
      expect(again.json.expiresAt).toBe(expectation === "same" ? first.json.expiresAt : T0 + offset + 12 * HOUR);
    });
  }

  it("T.E79 the superseded pid keeps serving until its own absolute expiry and is never returned by a later mint; the new mint says to restart", async () => {
    const first = await mintPid(dev("P"));
    const oldPid = first.pid as string;
    expect(first.json.restartRequired).toBeUndefined();
    advanceTo(11 * HOUR + 45 * MIN, [oldPid]);
    const next = await mintPid(dev("P"));
    const newPid = next.pid as string;
    expect(newPid).not.toBe(oldPid);
    expect(next.json.restartRequired).toBe(true); // Q9: the running site was started under the OLD base
    expect(await status(oldPid)).toBe(200); // the old base still serves
    expect(await status(newPid)).toBe(200);
    // later mints (any principal) return the new pid, never the superseded one
    advanceTo(11 * HOUR + 50 * MIN, [oldPid, newPid]);
    expect((await mintPid(dev("P"))).pid).toBe(newPid);
    expect((await mintPid(dev("Q"))).pid).toBe(newPid);
    expect(h.paths.currentPid("vite-5173")).toBe(newPid);
    // the old pid dies at ITS 12 h mark, the new one lives on
    advanceTo(11 * HOUR + 59 * MIN + 59 * SEC, [oldPid, newPid]);
    expect(await status(oldPid)).toBe(200);
    advanceTo(12 * HOUR, [oldPid, newPid]);
    expect(await status(oldPid)).toBe(404);
    expect(await status(newPid)).toBe(200);
    expect(h.logs.filter((l) => l.includes("pid dropped reason=expired"))).toHaveLength(1);
  });
});

describe("T.E80 / #E80 — idle boundary (30 min)", () => {
  it("T.E80 admitted at 29:59 (and the request refreshes lastUsedAt); 404 at 30:00 and 30:01", async () => {
    const m = await mintPid(dev("P"));
    const pid = m.pid as string;
    h.clock.now = T0 + 29 * MIN + 59 * SEC;
    expect(await status(pid)).toBe(200);
    // refreshed: a further 29:59 later it is still admitted (it would be long dead without the refresh)
    h.clock.now += 29 * MIN + 59 * SEC;
    expect(await status(pid)).toBe(200);
    // idle for exactly 30:00 → expired (inclusive edge)
    h.clock.now += 30 * MIN;
    expect(await status(pid)).toBe(404);
    expect(h.paths.validate(pid, local)).toBeNull();
  });

  it("T.E80 30:01 after the last use → 404", async () => {
    const pid = (await mintPid(dev("P"))).pid as string;
    h.clock.now = T0 + 30 * MIN + SEC;
    expect(await status(pid)).toBe(404);
  });

  it("T.E80 a 404'd probe does NOT refresh lastUsedAt: unknown pid, a non-admitted (tunnel) peer and a CORS preflight peek", async () => {
    const pid = (await mintPid(LOCAL)).pid as string; // localBound: a tunnel peer is refused
    h.clock.now = T0 + 29 * MIN + 59 * SEC;
    expect(await status("A".repeat(22))).toBe(404);
    expect(await status(pid, TUNNEL)).toBe(404);
    const pre = await h.get(`/preview/${pid}/x`, { origin: "null", "access-control-request-method": "GET" }, "OPTIONS");
    expect(pre.status).toBe(204); // a preflight is answered, but is not an accepted request
    h.clock.now = T0 + 30 * MIN + SEC;
    expect(await status(pid)).toBe(404); // none of the probes extended the idle expiry
  });
});

describe("T.E81 / #E81 — pid bounds (32 per principal, 256 in total)", () => {
  it("T.E81 a principal creating 31, 32, 33 distinct targets: #32 ok, #33 refused → tier `legacy`; no live pid evicted", async () => {
    const pids: string[] = [];
    for (let i = 1; i <= 33; i++) {
      const id = `t${i}`;
      h.addTarget(id);
      const m = await h.mint(dev("P"), id);
      expect(m.statusCode, id).toBe(200);
      if (i <= 32) {
        expect(m.json.tier, id).toBe(5);
        pids.push(m.pid as string);
      } else {
        expect(m.json.tier).toBe("legacy");
        expect(m.json.path).toMatch(/^\/live\/t33\/~c\/[A-Za-z0-9_-]+\/$/);
        expect(m.pid).toBeUndefined();
      }
    }
    expect(h.paths.size()).toBe(32);
    for (const pid of pids) expect(await status(pid), pid).toBe(200); // nothing evicted
    // counting is creator/adopter only: Q joins P's pid at Q's own cap of 32 → same pid, no new pid, no refusal
    for (let i = 1; i <= 32; i++) {
      h.addTarget(`q${i}`);
      expect((await h.mint(dev("Q"), `q${i}`)).json.tier).toBe(5);
    }
    expect(h.paths.size()).toBe(64);
    const join = await h.mint(dev("Q"), "t1");
    expect(join.pid).toBe(pids[0]);
    expect(h.paths.size()).toBe(64); // a join creates nothing
    // …and Q is still at its cap for NEW pids, P unchanged
    h.addTarget("q33");
    expect((await h.mint(dev("Q"), "q33")).json.tier).toBe("legacy");
  });

  it("T.E81 server cap 256 (across 9 principals): #255 and #256 ok, #257 refused → legacy; joining at the cap is still allowed; nothing evicted", async () => {
    const pids = await fill("S", 8); // 8 × 32 = 256
    expect(pids.size).toBe(256);
    expect(h.paths.size()).toBe(256);
    h.addTarget("overflow");
    const refused = await h.mint(dev("S8"), "overflow");
    expect(refused.json.tier).toBe("legacy");
    expect(refused.statusCode).toBe(200);
    expect(h.paths.size()).toBe(256);
    // joining an existing pid at the server cap creates nothing: allowed
    const join = await h.mint(dev("S8"), "S0-0");
    expect(join.pid).toBe(pids.get("S0-0"));
    for (const [id, pid] of [...pids].filter((_, i) => i % 17 === 0)) expect(await status(pid), id).toBe(200);
    // the 255th / 256th were issued: boundary — drop two and the 255th/256th slots refill, the 257th is refused again
    h.targets.delete("S7-31");
    h.targets.delete("S7-30");
    h.addTarget("n1");
    h.addTarget("n2");
    h.addTarget("n3");
    expect((await h.mint(dev("S8"), "n1")).json.tier).toBe(5); // 255
    expect((await h.mint(dev("S8"), "n2")).json.tier).toBe(5); // 256
    expect((await h.mint(dev("S8"), "n3")).json.tier).toBe("legacy"); // 257
  }, 60_000);
});

describe("T.E82 / #E82 — cap accounting on release", () => {
  it("T.E82 a principal at 32: a pid dropped by target removal frees a slot, the next mint gets a tier-5 pid", async () => {
    await fill("P", 1);
    h.addTarget("extra");
    expect((await h.mint(dev("P0"), "extra")).json.tier).toBe("legacy"); // at the cap
    h.targets.delete("P0-3"); // target removed → its pid drops
    const m = await h.mint(dev("P0"), "extra");
    expect(m.json.tier).toBe(5);
    expect(h.logs.some((l) => l.includes("pid dropped reason=target-removed"))).toBe(true);
    h.addTarget("extra2");
    expect((await h.mint(dev("P0"), "extra2")).json.tier).toBe("legacy"); // 32 again
  });

  it("T.E82 a holder revocation frees the creator's slot only when the pid drops, not while a joiner is merely present", async () => {
    await fill("P", 1);
    const joined = await h.mint(dev("Q"), "P0-5"); // Q joins P's pid: P's count is unchanged
    expect(joined.json.tier).toBe(5);
    h.addTarget("extra");
    expect((await h.mint(dev("P0"), "extra")).json.tier).toBe("legacy"); // still 32 with Q joined
    expect((await h.mint(dev("Q"), "P0-5")).pid).toBe(joined.pid); // joiner re-mint: nothing changes
    expect((await h.mint(dev("P0"), "extra")).json.tier).toBe("legacy");
    h.revoke(dev("Q")); // Q is a holder: revoking it drops the shared pid for everyone
    const m = await h.mint(dev("P0"), "extra");
    expect(m.json.tier).toBe(5);
    expect(await status(joined.pid as string)).toBe(404);
  });
});

describe("T.X17 / #X17 — race: mint vs expiry", () => {
  type Op = "mint" | "sweep" | "request";
  const orders: Op[][] = [
    ["mint", "sweep", "request"],
    ["mint", "request", "sweep"],
    ["sweep", "mint", "request"],
    ["sweep", "request", "mint"],
    ["request", "mint", "sweep"],
    ["request", "sweep", "mint"],
  ];
  /** The two legal outcomes: the mint refreshed the pid (request 200), or the sweep won (request 404, NEW pid). */
  const expectLegalOutcome = async (pid: string, mintRes: Mint, requestRes: Awaited<ReturnType<Harness["get"]>>) => {
    expect(mintRes.statusCode).toBe(200);
    expect(mintRes.json.tier).toBe(5);
    const minted = mintRes.pid as string;
    if (requestRes.status === 200) {
      expect(minted, "request 200 ⇒ the mint refreshed the same pid").toBe(pid);
    } else {
      expect(requestRes.status).toBe(404);
      expect(minted, "request 404 ⇒ the sweep won and the mint issued a NEW pid").not.toBe(pid);
      expect(h.paths.validate(pid, local), "a deleted pid never routes").toBeNull();
    }
    // never a returned pid that then 404s immediately
    expect(await status(minted)).toBe(200);
  };
  for (const order of orders) {
    for (const tickAt of ["start", "end"] as const) {
      it(`T.X17 ${order.join(" → ")} with the clock crossing the idle edge at the ${tickAt}: exactly two legal outcomes`, async () => {
        const first = await mintPid(dev("P"));
        const pid = first.pid as string;
        h.clock.now = T0 + 30 * MIN - 1; // idle 30 min − ε
        let mintP: Promise<Mint> | undefined;
        let requestP: Promise<Awaited<ReturnType<Harness["get"]>>> | undefined;
        let sweepP: Promise<void> | undefined;
        const launch: Record<Op, () => void> = {
          mint: () => void (mintP = Promise.resolve().then(() => h.mint(dev("P")))),
          sweep: () => void (sweepP = Promise.resolve().then(() => h.paths.sweep())),
          request: () => void (requestP = Promise.resolve().then(() => h.get(`/preview/${pid}/x`))),
        };
        const tick = () => Promise.resolve().then(() => void (h.clock.now = T0 + 30 * MIN + 1));
        const ticks: Array<Promise<void>> = [];
        if (tickAt === "start") ticks.push(tick());
        for (const op of order) launch[op]();
        if (tickAt === "end") ticks.push(tick());
        const [mintRes, requestRes] = await Promise.all([mintP, requestP, sweepP, ...ticks]);
        await expectLegalOutcome(pid, mintRes as Mint, requestRes as Awaited<ReturnType<Harness["get"]>>);
      });
    }
  }

  it("T.X17 no exception when many pids expire while mints and sweeps iterate the table", async () => {
    for (let i = 0; i < 40; i++) {
      h.addTarget(`r${i}`);
      await mintPid(dev(`R${i % 8}`), `r${i}`);
    }
    h.clock.now = T0 + 30 * MIN; // all 40 are exactly at the idle edge
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < 40; i++) {
      ops.push(Promise.resolve().then(() => h.paths.sweep()));
      ops.push(h.mint(dev(`R${i % 8}`), `r${i}`));
    }
    const settled = await Promise.allSettled(ops);
    expect(settled.filter((s) => s.status === "rejected")).toEqual([]);
    expect(h.paths.size()).toBe(40); // each target ended with exactly one current pid
  });
});

describe("T.X18 / #X18 — race: mint vs holder revocation", () => {
  for (const variant of ["revoke first", "mint first", "revocation lands while the mint is in flight"] as const) {
    it(`T.X18 P's mint races Q's device revocation (${variant}): the response never contains a dropped-and-unreachable pid`, async () => {
      const q = await mintPid(dev("Q"));
      const oldPid = q.pid as string;
      const revoke = () => Promise.resolve().then(() => h.revoke(dev("Q")));
      let res: Mint;
      if (variant === "revoke first") res = (await Promise.all([revoke(), h.mint(dev("P"))]))[1];
      else if (variant === "mint first") res = (await Promise.all([h.mint(dev("P")), revoke()]))[0];
      else {
        // deterministic "mint in flight": Q's device is revoked right after the store answered the mint
        const orig = h.paths.mint.bind(h.paths);
        h.paths.mint = (...args: Parameters<typeof orig>) => {
          const out = orig(...args);
          h.revoke(dev("Q"));
          return out;
        };
        res = await h.mint(dev("P"));
        h.paths.mint = orig;
      }
      expect(res.statusCode).toBe(200);
      expect(res.json.tier).toBe(5);
      const pid = res.pid as string;
      if (pid === oldPid) {
        // mint won: a pre-revocation pid, which the revocation then drops
        expect(await status(pid)).toBe(404);
      } else {
        expect(await status(pid)).toBe(200); // revocation won: a fresh, live pid
        expect(await status(oldPid)).toBe(404);
      }
      expect(variant === "revocation lands while the mint is in flight" ? pid === oldPid : true).toBe(true);
      // the holder set has no revoked principal: the next P mint is live and stays live (Q would drop it again otherwise)
      const next = await mintPid(dev("P"));
      expect(next.pid).not.toBe(oldPid);
      expect(await status(next.pid as string)).toBe(200);
      h.paths.sweep();
      expect(await status(next.pid as string)).toBe(200);
      expect(h.paths.validate(oldPid, local)).toBeNull();
    });
  }
});

describe("T.X19 / #X19 — race: concurrent first mints for one target", () => {
  for (const order of ["PQ", "QP"]) {
    it(`T.X19 ${order}: one pid is created, the other joins; both return the same path; per-principal counters exact`, async () => {
      const mints = order === "PQ" ? [h.mint(dev("P")), h.mint(dev("Q"))] : [h.mint(dev("Q")), h.mint(dev("P"))];
      const [first, second] = await Promise.all(mints);
      expect(first.pid).toBeDefined();
      expect(second.json.path).toBe(first.json.path);
      expect(h.paths.size()).toBe(1);
      expect([first.json.restartRequired, second.json.restartRequired]).toEqual([undefined, undefined]); // no predecessor
      // counters: the pid counts against exactly ONE creator. Each principal now creates 32 more targets:
      // the creator gets 31 then a refusal, the joiner (count 0) gets all 32.
      const outcome: Record<string, number> = { P: 0, Q: 0 };
      for (const who of ["P", "Q"]) {
        for (let i = 0; i < 32; i++) {
          const id = `${who}-${i}`;
          h.addTarget(id);
          if ((await h.mint(dev(who), id)).json.tier === 5) outcome[who]++;
        }
      }
      expect([outcome.P, outcome.Q].sort()).toEqual([31, 32]);
    });
  }
});

describe("T.X21 / #X21 — cap refusal falls back to legacy", () => {
  const legacyWorks = async (m: Awaited<ReturnType<Harness["mint"]>>, id: string) => {
    expect(m.statusCode).toBe(200); // not 5xx
    expect(m.json).toMatchObject({ success: true, tier: "legacy" });
    expect(m.json.path).toMatch(new RegExp(`^/live/${id}/~c/[A-Za-z0-9_-]+/$`));
    const r = await h.get(String(m.json.path));
    expect(r.status).toBe(200); // the client can frame it
    expect(h.up.seen.at(-1)?.url).toBe("/"); // legacy strips the capability segment
  };

  it("T.X21 principal at 32: the 33rd target gets a working legacy URL, nothing evicted, log without the raw pid", async () => {
    const pids = await fill("P", 1);
    h.addTarget("extra");
    const m = await h.mint(dev("P0"), "extra");
    await legacyWorks(m, "extra");
    for (const pid of pids.values()) expect(h.paths.validate(pid, local)?.tier).toBe(5);
    const all = h.logs.join("\n");
    expect(all).toMatch(/\[live-preview\] mint tier=legacy target=extra .*reason=pid-cap/);
    for (const pid of pids.values()) expect(all).not.toContain(pid);
    expect(all).not.toContain("pid dropped");
  });

  it("T.X21 server at 256: a further principal's mint gets a working legacy URL, nothing evicted, log without the raw pid", async () => {
    const pids = await fill("S", 8);
    h.addTarget("extra");
    const m = await h.mint(dev("S8"), "extra");
    await legacyWorks(m, "extra");
    expect(h.paths.size()).toBe(256);
    const all = h.logs.join("\n");
    expect(all).toMatch(/\[live-preview\] mint tier=legacy target=extra .*reason=pid-cap/);
    for (const pid of pids.values()) expect(all).not.toContain(pid);
    expect(all).not.toContain("pid dropped");
  }, 60_000);
});
