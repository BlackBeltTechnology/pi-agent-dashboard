// Forge sync coordination (change: add-kb-git-forge-scope, test-plan #P1, #P4, #P6,
// #X2, #X3, #X5, #X6, #X7, #X13). Fake adapter + fake clock; no network, no real waits
// except the one latency budget (P1).

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ForgeRateLimited } from "../git-scope/forge/types.js";
import { SqliteFtsStore } from "../sqlite-store.js";
import { FakeForge, fakeClock, fakeItem, instrumentedStore, type StoreStats, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const GH = "https://github.com/a/r.git";
const search = (scope: ReturnType<typeof scopeFor>, cwd: string, query = "item") => scope.search({ query, limit: 100 }, { cwd });
const cfg = (forge: Record<string, number> = {}) => ({ forge: { minSyncIntervalSeconds: 100, hintedMinSyncIntervalSeconds: 100, ...forge } });
const prs = (n: number, same?: string) => Array.from({ length: n }, (_, i) => fakeItem("pr", i + 1, `item ${i + 1}`, same ? { updatedAt: same } : {}));
const itemCount = (): { rows: number; distinct: number } => {
  const [key] = readdirSync(fx.baseDir);
  const s = new SqliteFtsStore(join(fx.baseDir, key, "index.db"));
  const out = s.read((db) => db.prepare("SELECT COUNT(*) AS rows, COUNT(DISTINCT path) AS d FROM chunks WHERE path LIKE 'pr/%'").get() as { rows: number; d: number });
  s.close();
  return { rows: Number(out.rows), distinct: Number(out.d) };
};

describe("sync budget and latency", () => {
  it("P1: a slow forge never blocks a search past the wait budget", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.delayMs = 5000;
    forge.items = prs(1);
    const scope = scopeFor(fx, { adapterFor: () => forge, gitConfig: { searchWaitMs: 2000 } });
    const t0 = Date.now();
    const r = await search(scope, dir);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(r.text).toContain("forge syncing");
    await scope.shutdown(); // aborts the background request
  });

  it("P4: ten searches from three separate store instances inside the interval make zero requests", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(2);
    const clock = fakeClock();
    const scopes = [0, 1, 2].map(() => scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: cfg() }));
    await search(scopes[0], dir);
    const after = forge.requests.length;
    expect(after).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      clock.advance(1000);
      await search(scopes[i % 3], dir);
    }
    expect(forge.requests.length).toBe(after);
  });

  it("P6: the page cap resumes on the next sync without loss or duplication", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(750);
    const st: StoreStats = { replaced: [], txMs: [] };
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, openStore: instrumentedStore(st), now: clock.now, gitConfig: cfg({ pagesPerSync: 5 }) });
    await search(scope, dir);
    expect(forge.requests).toHaveLength(5);
    expect(st.replaced.filter((p) => p.startsWith("pr/"))).toHaveLength(500);
    clock.advance(200_000);
    await search(scope, dir);
    expect(forge.requests.length).toBeLessThanOrEqual(10);
    expect(new Set(st.replaced.filter((p) => p.startsWith("pr/"))).size).toBe(750);
    expect(itemCount()).toEqual({ rows: 750, distinct: 750 });
  });
});

describe("observability", () => {
  it("6.1: one structured line per sync; never a credential", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(3);
    forge.rate = { remaining: 4321, limit: 5000, resetAt: Date.now() + 3_600_000 };
    const lines: string[] = [];
    const scope = scopeFor(fx, { adapterFor: () => forge, log: (l) => lines.push(l), env: { GITEA_TOKEN: "tok-marker-77" }, gitConfig: cfg() });
    await search(scope, dir);
    const syncLines = lines.filter((l) => l.startsWith("forge="));
    expect(syncLines).toHaveLength(1);
    expect(syncLines[0]).toMatch(/^forge=github endpoints=issues requests=1 not_modified=0 items=3 remaining=4321\/5000 cursor=\{.*\} capped=false stopped=no ms=\d+$/);
    expect(lines.join("\n")).not.toContain("tok-marker-77");
  });
});

describe("failure reporting and cached data", () => {
  it("a generic forge failure is a FORGE status; commits stay fresh and the key is not shared", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.failWith = new Error("boom");
    const scope = scopeFor(fx, { adapterFor: () => forge, gitConfig: cfg() });
    const r = await search(scope, dir);
    expect(r.text).toContain("commits fresh");
    expect(r.text).toMatch(/forge stale: forge sync failed: boom/);
    expect(r.text).not.toMatch(/commits stale/);
  });

  it("git.forge.enabled:false keeps the cached PRs/issues (no purge, no re-sync cost later)", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(2);
    await search(scopeFor(fx, { adapterFor: () => forge, gitConfig: cfg() }), dir);
    const off = scopeFor(fx, { adapterFor: () => forge, gitConfig: { forge: { enabled: false } } });
    const r = await search(off, dir);
    expect(r.text).toContain("[git] pr #1");
    expect(r.text).toContain("forge disabled");
    expect(itemCount().distinct).toBe(2);
  });

  it("a store that cannot open, or a busy database, never throws out of search", async () => {
    const dir = fx.repo({ remote: GH });
    const broken = scopeFor(fx, { openStore: () => { throw new Error("EACCES: permission denied"); } });
    const r1 = await search(broken, dir);
    expect(r1.text).toContain("index unavailable: EACCES");
    const busy = scopeFor(fx, {
      openStore: (_r, _b, _m, openDefault) => {
        const real = openDefault();
        return new Proxy(real, {
          get: (t, p) => (p === "immediate" ? () => { throw new Error("database is locked"); } : (typeof t[p as keyof typeof t] === "function" ? (t[p as keyof typeof t] as (...a: unknown[]) => unknown).bind(t) : t[p as keyof typeof t])),
        });
      },
    });
    const r2 = await search(busy, dir);
    expect(r2.text).toContain("(git:"); // a normal result with a status footer, not a rejection
  });
});

describe("rate floor and back-off", () => {
  it("X2/X3: below the floor no request is made; after the reset the observation expires", async () => {
    const dir = fx.repo({ remote: GH });
    const clock = fakeClock();
    const forge = new FakeForge();
    forge.items = prs(1);
    forge.rate = { remaining: 50, limit: 5000, resetAt: clock.t + 3_600_000 };
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: cfg() });
    await search(scope, dir);
    const n = forge.requests.length;
    clock.advance(200_000); // interval passed, rate still low
    const r = await search(scope, dir);
    expect(forge.requests.length).toBe(n);
    expect(r.text).toContain("stale: rate floor");
    clock.advance(3_600_000); // reset time passed
    await search(scope, dir);
    expect(forge.requests.length).toBeGreaterThan(n);
  });

  it("X5: a 429 suspends syncing until retry-after", async () => {
    const dir = fx.repo({ remote: GH });
    const clock = fakeClock();
    const forge = new FakeForge();
    forge.items = prs(1);
    forge.failWith = new ForgeRateLimited(clock.t + 120_000);
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: cfg({ minSyncIntervalSeconds: 1, hintedMinSyncIntervalSeconds: 1 }) });
    await search(scope, dir);
    expect(forge.requests).toHaveLength(1);
    clock.advance(60_000);
    const mid = await search(scope, dir);
    expect(forge.requests).toHaveLength(1);
    expect(mid.text).toContain("stale: back-off");
    forge.failWith = null;
    clock.advance(61_000);
    await search(scope, dir);
    expect(forge.requests).toHaveLength(2);
  });
});

describe("cursor and crash safety", () => {
  it("X6: an interrupted page loses nothing — earlier pages persist, the failed page is re-requested", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(250);
    const st: StoreStats = { replaced: [], txMs: [], failOnReplace: 1 + 100 + 100 + 40 }; // initial commit + page 1 + page 2 + 40 items into page 3
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, openStore: instrumentedStore(st), now: clock.now, gitConfig: cfg({ minSyncIntervalSeconds: 1, hintedMinSyncIntervalSeconds: 1 }) });
    await search(scope, dir);
    expect(itemCount().distinct).toBe(199); // pages 1–2 applied (page 2 re-reads the inclusive boundary item); page 3 rolled back as a unit
    st.failOnReplace = 0;
    clock.advance(10_000);
    await search(scope, dir);
    expect(forge.requests[3].since).toBe(forge.items[198].updatedAt); // resumed at the last applied page
    expect(itemCount()).toEqual({ rows: 250, distinct: 250 });
  });

  it("X7: items sharing one update time still progress (cohort paging)", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = prs(250, "2026-09-15T10:00:00Z");
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: cfg({ pagesPerSync: 1, minSyncIntervalSeconds: 1, hintedMinSyncIntervalSeconds: 1 }) });
    for (let i = 0; i < 3; i++) {
      await search(scope, dir);
      clock.advance(10_000);
    }
    expect(itemCount()).toEqual({ rows: 250, distinct: 250 });
    expect(forge.requests.map((r) => r.page)).toEqual([1, 2, 3]);
  });
});

describe("comments", () => {
  it("X13: comments are cached within the interval and withheld below the rate floor", async () => {
    const dir = fx.repo({ remote: GH });
    const forge = new FakeForge();
    forge.items = [fakeItem("pr", 12, "item twelve")];
    const clock = fakeClock();
    const scope = scopeFor(fx, { adapterFor: () => forge, now: clock.now, gitConfig: cfg() });
    await search(scope, dir);
    const first = await scope.get({ path: "pr/12" }, { cwd: dir });
    expect(first.text).toContain("looks good");
    expect(first.text).toContain("forge-authored");
    expect(forge.commentCalls).toHaveLength(1);
    clock.advance(10_000);
    await scope.get({ path: "pr/12" }, { cwd: dir });
    expect(forge.commentCalls).toHaveLength(1); // served from cache

    forge.items.push(fakeItem("pr", 13, "item thirteen"));
    forge.rate = { remaining: 10, limit: 5000, resetAt: clock.t + 3_600_000 };
    clock.advance(200_000);
    await search(scope, dir); // sync stores the low rate
    const third = await scope.get({ path: "pr/13" }, { cwd: dir });
    expect(third.text).toContain("item thirteen"); // fields still returned
    expect(third.text).toContain("comments unavailable");
    expect(forge.commentCalls).toHaveLength(1);
  });
});
