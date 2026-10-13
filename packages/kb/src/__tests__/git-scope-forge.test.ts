// Forge adapters + credentials + request shape (change: add-kb-git-forge-scope,
// test-plan #E20, #E23, #E24, #E26, #E27, #X1, #X4, #X14, #P5). Real adapters run
// against the `runCli` / `fetch` seams; no network and no forge login needed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliResult } from "../git-scope/deps.js";
import { cliHttp, FakeForge, fakeClock, fakeItem, scopeFor, useGitFixture } from "./helpers/git-fixture.js";

const fx = useGitFixture();
const fast = { forge: { minSyncIntervalSeconds: 1, hintedMinSyncIntervalSeconds: 1 } };
const search = (scope: ReturnType<typeof scopeFor>, cwd: string, query: string) => scope.search({ query }, { cwd });

function writeGlobalConfig(cfg: unknown) {
  mkdirSync(join(fx.home, ".pi", "dashboard"), { recursive: true });
  writeFileSync(join(fx.home, ".pi", "dashboard", "knowledge_base.json"), JSON.stringify(cfg));
}

const ghItem = (n: number, title: string, over: Record<string, unknown> = {}) => ({ number: n, title, body: "", state: "open", user: { login: "alice" }, labels: [], created_at: "2026-09-01T00:00:00Z", updated_at: `2026-09-01T00:00:0${n % 10}Z`, ...over });
const ghHeaders = (remaining = 4999, extra: Record<string, string> = {}) => ({ etag: 'W/"e1"', "x-ratelimit-limit": "5000", "x-ratelimit-remaining": String(remaining), "x-ratelimit-reset": String(Math.floor(Date.parse("2026-10-01T13:00:00Z") / 1000)), ...extra });

/** A CLI stub recording every invocation. */
function cliStub(handler: (args: string[], bin: string) => CliResult | Promise<CliResult>) {
  const calls: string[][] = [];
  return { calls, opts: { resolveBin: (name: string) => `/fake/bin/${name}`, runCli: async (bin: string, args: string[]) => (calls.push(args), handler(args, bin)) } };
}

describe("forge: GitHub through the gh seam", () => {
  it("E20: PRs and issues are searchable with their state", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const gh = cliStub(() =>
      cliHttp(200, ghHeaders(), [ghItem(5, "Add cache", { pull_request: {} }), ghItem(6, "Cache leak", { state: "closed" })]),
    );
    const r = await search(scopeFor(fx, gh.opts), dir, "cache");
    expect(r.text).toMatch(/\[git\] pr #5 \[open\]/);
    expect(r.text).toMatch(/\[git\] issue #6 \[closed\]/);
  });

  it("E27: one list request serves both kinds; args name the host, endpoint and since", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const gh = cliStub(() => cliHttp(200, ghHeaders(), [ghItem(5, "Add cache", { pull_request: {} }), ghItem(6, "Cache leak")]));
    await search(scopeFor(fx, gh.opts), dir, "cache");
    const lists = gh.calls.filter((a) => a.some((x) => x.includes("/issues?")));
    expect(lists).toHaveLength(1);
    expect(lists[0].slice(0, 4)).toEqual(["api", "-i", "--hostname", "github.com"]);
    expect(lists[0].join(" ")).toMatch(/repos\/a\/r\/issues\?state=all&sort=updated&direction=asc&since=.*&per_page=100&page=1/);
  });

  it("X1: missing CLI and unauthenticated CLI → commits kept, forge unavailable with the reason", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    const missing = await search(scopeFor(fx, { resolveBin: () => null }), dir, "initial");
    expect(missing.text).toContain("initial commit");
    expect(missing.text).toContain("forge unavailable: gh is not installed");

    const dir2 = fx.repo({ remote: "https://github.com/a/r2.git", name: "second" });
    const gh = cliStub(() => ({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run: gh auth login" }));
    const unauth = await search(scopeFor(fx, gh.opts), dir2, "initial");
    expect(unauth.text).toContain("initial commit");
    expect(unauth.text).toContain("forge unavailable: gh is not authenticated");
  });

  it("X14: a 304 advances lastSyncAt, writes nothing, records no error", async () => {
    const dir = fx.repo({ remote: "https://github.com/a/r.git" });
    let n = 0;
    const gh = cliStub((args) => {
      n++;
      if (args.some((a) => a.startsWith("If-None-Match:"))) return { ...cliHttp(304, ghHeaders(4990)), code: 1 };
      return cliHttp(200, ghHeaders(), [ghItem(5, "Add cache", { pull_request: {} })]);
    });
    const clock = fakeClock();
    const scope = scopeFor(fx, { ...gh.opts, now: clock.now, gitConfig: fast });
    await search(scope, dir, "cache");
    // The validator belongs to ONE exact `since`. The first sync moves the cursor, so the
    // second request (new `since`) is unconditional and yields the validator for the third.
    clock.advance(5000);
    await search(scope, dir, "cache");
    expect(n).toBe(2);
    expect(gh.calls[1].some((a) => a.startsWith("If-None-Match:"))).toBe(false);
    clock.advance(5000);
    const r = await search(scope, dir, "cache");
    expect(n).toBe(3);
    expect(gh.calls[2].some((a) => a === 'If-None-Match: W/"e1"')).toBe(true);
    expect(r.text).toContain("pr #5"); // data intact
    expect(r.text).toMatch(/forge synced just now/); // lastSyncAt advanced to the fake clock
    expect(r.text).not.toMatch(/unavailable|stale/);
  });
});

describe("forge: GitLab through the glab seam", () => {
  const glItem = (iid: number, title: string) => ({ iid, title, description: "", state: "opened", author: { username: "carol" }, labels: [], created_at: "2026-09-01T00:00:00Z", updated_at: `2026-09-01T00:00:0${iid}Z` });

  it("X4/P5: forge without rate info is bounded by the interval; steady state is one request per endpoint", async () => {
    const dir = fx.repo({ remote: "https://gitlab.com/g/r.git" });
    const gl = cliStub((args) => (args.some((a) => a.includes("/merge_requests?")) ? cliHttp(200, {}, [glItem(2, "Mr two")]) : cliHttp(200, {}, [glItem(1, "Issue one")])));
    const clock = fakeClock();
    const scope = scopeFor(fx, { ...gl.opts, now: clock.now, gitConfig: { forge: { minSyncIntervalSeconds: 100, hintedMinSyncIntervalSeconds: 100 } } });
    await search(scope, dir, "one");
    expect(gl.calls).toHaveLength(2); // first sync: issues + merge_requests, one page each
    clock.advance(10_000); // inside the interval
    await search(scope, dir, "one");
    expect(gl.calls).toHaveLength(2); // 0 requests
    clock.advance(100_000); // past the interval
    const r = await search(scope, dir, "mr");
    expect(gl.calls).toHaveLength(4); // exactly 2 more: one per endpoint
    expect(r.text).toMatch(/pr #2 \[open\]/);
    expect(gl.calls[2].slice(0, 4)).toEqual(["api", "-i", "--hostname", "gitlab.com"]);
    expect(gl.calls[2].join(" ")).toContain("projects/g%2Fr/");
  });
});

describe("forge: Gitea over HTTPS (fetch seam)", () => {
  const giteaBody = [{ number: 3, title: "Gitea thing", body: "", state: "open", user: { login: "dan" }, labels: [], created_at: "2026-09-01T03:00:00+02:00", updated_at: "2026-09-01T03:00:00+02:00", pull_request: null }];
  function fetchStub(status = 200) {
    const seen: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      seen.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(JSON.stringify(status === 200 ? giteaBody : { message: "boom" }), { status, headers: { ratelimit: '"baseline";r=1999;t=600', "ratelimit-policy": '"baseline";q=2000;w=600' } });
    }) as unknown as typeof globalThis.fetch;
    return { seen, fetch };
  }

  it("E23: a token goes only to a host listed as gitea in the GLOBAL hosts", async () => {
    const dirA = fx.repo({ remote: "https://codeberg.org/o/r.git", name: "a" });
    writeGlobalConfig({ git: { forge: { hosts: { "codeberg.org": "gitea" } } } });
    const a = fetchStub();
    await search(scopeFor(fx, { fetch: a.fetch, env: { GITEA_TOKEN: "s3cr3t" } }), dirA, "gitea");
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0].headers.authorization).toBe("token s3cr3t");
    expect(a.seen[0].url).toMatch(/^https:\/\/codeberg\.org\/api\/v1\/repos\/o\/r\/issues\?state=all&type=all&sort=leastupdate&since=/);

    writeGlobalConfig({});
    const dirB = fx.repo({ remote: "https://codeberg.org/o/r2.git", name: "b" });
    const b = fetchStub();
    await search(scopeFor(fx, { fetch: b.fetch, env: { GITEA_TOKEN: "s3cr3t" } }), dirB, "gitea");
    expect(b.seen).toHaveLength(1);
    expect(b.seen[0].headers.authorization).toBeUndefined();
  });

  it("E24: no cleartext — an http remote is still queried over https, never http", async () => {
    writeGlobalConfig({ git: { forge: { hosts: { "git.example.test": "gitea" } } } });
    const dir = fx.repo({ remote: "http://git.example.test/o/r.git" });
    const urls: string[] = [];
    const fetch = (async (url: string) => (urls.push(String(url)), Promise.reject(new TypeError("fetch failed")))) as unknown as typeof globalThis.fetch;
    const r = await search(scopeFor(fx, { fetch, env: { GITEA_TOKEN: "s3cr3t" } }), dir, "initial");
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
    expect(r.text).toContain("forge unavailable: https required");
    expect(r.text).toContain("initial commit");
  });

  it("E26: a credential is never persisted or logged, including after an error response", async () => {
    writeGlobalConfig({ git: { forge: { hosts: { "codeberg.org": "gitea" } } } });
    const dir = fx.repo({ remote: "https://codeberg.org/o/r.git" });
    const lines: string[] = [];
    const marker = "s3cr3t-marker-9f2c";
    const clock = fakeClock();
    const errScope = scopeFor(fx, { fetch: fetchStub(500).fetch, env: { GITEA_TOKEN: marker }, log: (l) => lines.push(l), now: clock.now, gitConfig: fast });
    await search(errScope, dir, "initial");
    clock.advance(5000);
    const okScope = scopeFor(fx, { fetch: fetchStub(200).fetch, env: { GITEA_TOKEN: marker }, log: (l) => lines.push(l), now: clock.now, gitConfig: fast });
    await search(okScope, dir, "gitea");
    await Promise.all([errScope.shutdown(), okScope.shutdown()]);
    const [key] = readdirSync(fx.baseDir);
    const dbFiles = readdirSync(join(fx.baseDir, key)).map((f) => readFileSync(join(fx.baseDir, key, f)).toString("latin1"));
    expect(dbFiles.some((b) => b.includes(marker))).toBe(false);
    expect(lines.join("\n")).not.toContain(marker);
    expect(readFileSync(join(fx.home, ".pi", "dashboard", "knowledge_base.json"), "utf8")).not.toContain(marker);
  });

  it("normalises zone-offset timestamps to UTC", async () => {
    writeGlobalConfig({ git: { forge: { hosts: { "codeberg.org": "gitea" } } } });
    const dir = fx.repo({ remote: "https://codeberg.org/o/r.git" });
    const r = await search(scopeFor(fx, { fetch: fetchStub().fetch }), dir, "gitea");
    expect(r.text).toContain("issue #3 [open] · 2026-09-01");
  });
});

void [FakeForge, fakeItem];
