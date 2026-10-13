// Fixtures for the git-scope tests (change: add-kb-git-forge-scope): temp git
// repos made with real `git`, an isolated HOME + index dir, and a fake forge.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach } from "vitest";
import type { ForgeKind } from "../../config.js";
import type { ForgeAdapter, ForgeComments, ForgeEndpoint, ForgeItem, ForgePage, ItemKind, ListArgs, RateInfo } from "../../git-scope/forge/types.js";
import { GitScope, type GitScopeOptions } from "../../git-scope/scope.js";
import type { KbStore } from "../../types.js";

const AUTHOR = { GIT_AUTHOR_NAME: "Test Author", GIT_AUTHOR_EMAIL: "author@example.test", GIT_COMMITTER_NAME: "Test Author", GIT_COMMITTER_EMAIL: "author@example.test" };

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...AUTHOR, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
}

export interface Fixture {
  /** Isolated $HOME (global kb config lives here) */
  home: string;
  /** Per-test index base dir (`~/.pi/dashboard/kb/git` stand-in) */
  baseDir: string;
  tmp: string;
  repos: string[];
  /** Create a repo with an initial commit; returns its realpath. */
  repo(opts?: { remote?: string; name?: string; commits?: number }): string;
  commit(dir: string, subject: string, opts?: { body?: string; files?: Record<string, string>; author?: string; email?: string }): string;
}

/** Register per-test isolation. Returns an object whose fields are valid inside tests. */
export function useGitFixture(): Fixture {
  const fx = {} as Fixture;
  let prevHome: string | undefined;
  beforeEach(() => {
    fx.tmp = realpathSync(mkdtempSync(join(tmpdir(), "kb-gitscope-")));
    fx.home = join(fx.tmp, "home");
    fx.baseDir = join(fx.tmp, "index");
    fx.repos = [];
    mkdirSync(fx.home, { recursive: true });
    prevHome = process.env.HOME;
    process.env.HOME = fx.home;
    let counter = 0;
    fx.commit = (dir, subject, opts = {}) => {
      const files = opts.files ?? { [`f${++counter}.txt`]: `${subject}\n` };
      for (const [name, content] of Object.entries(files)) {
        mkdirSync(dirname(join(dir, name)), { recursive: true });
        writeFileSync(join(dir, name), content);
      }
      git(dir, "add", "-A");
      const msg = opts.body ? `${subject}\n\n${opts.body}` : subject;
      if (opts.author) {
        const env = { ...process.env, GIT_AUTHOR_NAME: opts.author, GIT_COMMITTER_NAME: opts.author, GIT_AUTHOR_EMAIL: opts.email ?? "author@example.test", GIT_COMMITTER_EMAIL: opts.email ?? "author@example.test", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
        execFileSync("git", ["commit", "-q", "-m", msg], { cwd: dir, env });
      } else git(dir, "commit", "-q", "-m", msg);
      return git(dir, "rev-parse", "HEAD").trim();
    };
    fx.repo = (opts = {}) => {
      const dir = join(fx.tmp, opts.name ?? `repo${fx.repos.length}`);
      mkdirSync(dir, { recursive: true });
      git(dir, "init", "-q", "-b", "main");
      git(dir, "config", "commit.gpgsign", "false");
      if (opts.remote) git(dir, "remote", "add", "origin", opts.remote);
      for (let i = 0; i < (opts.commits ?? 1); i++) fx.commit(dir, i === 0 ? "initial commit" : `commit ${i}`);
      fx.repos.push(dir);
      return realpathSync(dir);
    };
  });
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    rmSync(fx.tmp, { recursive: true, force: true });
  });
  return fx;
}

export function scopeFor(fx: Fixture, o: GitScopeOptions = {}): GitScope {
  return new GitScope({ baseDir: fx.baseDir, log: () => {}, ...o });
}

let nextTs = Date.parse("2026-09-01T00:00:00Z");
export function fakeItem(kind: ItemKind, number: number, title: string, over: Partial<ForgeItem> = {}): ForgeItem {
  nextTs += 1000;
  const updatedAt = over.updatedAt ?? new Date(nextTs).toISOString().replace(".000Z", "Z");
  return { kind, number, title, body: "", state: "open", author: "alice", labels: [], createdAt: updatedAt, updatedAt, ...over };
}

export class FakeForge implements ForgeAdapter {
  id: ForgeKind = "github";
  endpoints: ForgeEndpoint[] = ["issues"];
  sharedNumberSpace = true;
  items: ForgeItem[] = [];
  requests: Array<{ ep: ForgeEndpoint; since: string; page: number; etag: string | null }> = [];
  commentCalls: Array<{ kind: ItemKind; n: number }> = [];
  commentsResult: ForgeComments = { status: "ok", comments: [{ author: "bob", createdAt: "2026-09-02T00:00:00Z", body: "looks good" }], etag: "c1", rate: null };
  pageSize = 100;
  delayMs = 0;
  rate: RateInfo | null = null;
  etag: string | null = null;
  failWith: Error | null = null;
  /** Called after each list() answers, with the page (lets a test mutate state mid-sync). */
  onPage?: (n: number) => void;
  constructor(init: Partial<Pick<FakeForge, "id" | "endpoints" | "sharedNumberSpace">> = {}) {
    Object.assign(this, init);
  }
  async list(ep: ForgeEndpoint, a: ListArgs): Promise<ForgePage> {
    this.requests.push({ ep, since: a.since, page: a.page, etag: a.etag });
    if (this.delayMs) await sleepAbortable(this.delayMs, a.signal);
    if (this.failWith) throw this.failWith;
    if (a.etag && this.etag === a.etag) return { status: "not_modified", items: [], full: false, etag: a.etag, rate: this.rate };
    const wantKind: ItemKind | null = this.endpoints.length === 2 ? (ep === "merge_requests" ? "pr" : "issue") : null;
    const since = Date.parse(a.since);
    const all = this.items
      .filter((i) => (wantKind ? i.kind === wantKind : true) && Date.parse(i.updatedAt) >= since)
      .sort((x, y) => Date.parse(x.updatedAt) - Date.parse(y.updatedAt) || x.number - y.number);
    const slice = all.slice((a.page - 1) * this.pageSize, a.page * this.pageSize);
    this.onPage?.(this.requests.length);
    return { status: "ok", items: slice, full: slice.length >= this.pageSize, etag: this.etag, rate: this.rate };
  }
  async comments(kind: ItemKind, n: number): Promise<ForgeComments> {
    this.commentCalls.push({ kind, n });
    return this.commentsResult;
  }
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

export interface StoreStats {
  /** `replaceItem` paths, in call order. */
  replaced: string[];
  /** Duration (ms) of every `immediate()` write transaction. */
  txMs: number[];
  /** Optional fault injection: throw on the Nth replaceItem (1-based). */
  failOnReplace?: number;
}

/** An `openStore` seam that counts writes and times transactions (delegates to the real store). */
export function instrumentedStore(stats: StoreStats): NonNullable<GitScopeOptions["openStore"]> {
  return (_repo, _baseDir, _busy, openDefault): KbStore => {
    const real = openDefault();
    return new Proxy(real, {
      get(target, prop) {
        const v = Reflect.get(target, prop, target);
        if (prop === "replaceItem") {
          return (...a: Parameters<KbStore["replaceItem"] & object>) => {
            stats.replaced.push(a[1]);
            if (stats.failOnReplace && stats.replaced.length === stats.failOnReplace) throw new Error("injected fault");
            return (v as (...x: unknown[]) => void).apply(target, a);
          };
        }
        if (prop === "immediate") {
          return (fn: never) => {
            const t0 = performance.now();
            try {
              return (v as (f: never) => unknown).call(target, fn);
            } finally {
              stats.txMs.push(performance.now() - t0);
            }
          };
        }
        return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
}

/** Bulk-create `n` commits with `git fast-import` (one tiny file each). */
export function fastImport(dir: string, n: number): void {
  const lines: string[] = [];
  const t0 = 1_700_000_000;
  for (let i = 1; i <= n; i++) {
    lines.push("commit refs/heads/bulk", `committer Bulk <bulk@example.test> ${t0 + i} +0000`, `data <<EOM\nbulk commit ${i} marker${i}\nEOM`);
    if (i === 1) lines.push("deleteall");
    lines.push(`M 100644 inline dir${i % 50}/file${i}.txt`, "data <<EOM", `content ${i}`, "EOM", "");
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: dir, input: lines.join("\n"), env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" } });
}

/** A manual clock for the `now` seam (staleness, back-off, lease expiry — never real timers). */
export function fakeClock(start = Date.parse("2026-10-01T12:00:00Z")) {
  const c = { t: start, now: () => c.t, advance: (ms: number) => (c.t += ms) };
  return c;
}

/** A `gh api -i` / `glab api -i` style response on stdout (spike 1.1 shape). */
export function cliHttp(status: number, headers: Record<string, string>, body: unknown = ""): { code: number; stdout: string; stderr: string } {
  const reason = { 200: "OK", 304: "Not Modified", 403: "Forbidden", 404: "Not Found", 429: "Too Many Requests" }[status] ?? "Status";
  const head = [`HTTP/2.0 ${status} ${reason}`, ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { code: status >= 300 ? 1 : 0, stdout: `${head}\n\n${text}`, stderr: status >= 300 ? `gh: HTTP ${status}` : "" };
}
