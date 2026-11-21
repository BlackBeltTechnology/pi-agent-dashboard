/**
 * In-memory fake dashboard + real-git fixture for the ship-batch runner tests.
 *
 * REST: exactly the routes the runner uses (`/api/config`, groups, dependencies,
 * git worktree create/init/remove/orphan-cleanup, questions, sessions, archived
 * listing, archive). Worktree create/remove drive REAL git so teardown sees real
 * worktree state. Bus: session stream + `spawn` / `prompt` with call recording.
 * Clock: injected; `sleep` advances time instantly.
 *
 * See change: add-ship-batch-orchestrator.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "../args.ts";
import { type BusPort, type Deps, type RestResponse, Runner, type RunnerOptions, runMain } from "../runner.ts";
import type { SessionObs } from "../types.ts";

export const sh = (cwd: string, ...args: string[]): string => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};

export interface Fixture {
  root: string;
  repo: string;
  origin: string;
}

const tmpDirs: string[] = [];
export function cleanupFixtures(): void {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

/** A repo (branch `develop`) with a bare `origin`, an ignore rule for the hand-back file, and identity config. */
export function makeFixture(): Fixture {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ship-batch-")));
  tmpDirs.push(root);
  const repo = path.join(root, "repo");
  const origin = path.join(root, "origin.git");
  fs.mkdirSync(repo);
  sh(root, "init", "-q", "--bare", "-b", "develop", origin);
  sh(repo, "init", "-q", "-b", "develop");
  sh(repo, "config", "user.email", "t@example.com");
  sh(repo, "config", "user.name", "Tester");
  fs.writeFileSync(path.join(repo, ".gitignore"), "openspec/changes/*/SHIP_IT_BLOCKED.md\nnode_modules/\n.pi-test-harness.json\n");
  fs.mkdirSync(path.join(repo, ".pi"));
  fs.writeFileSync(path.join(repo, ".pi", "settings.json"), "{}\n");
  fs.writeFileSync(path.join(repo, "README.md"), "# t\n");
  sh(repo, "add", "-A");
  sh(repo, "commit", "-q", "-m", "init");
  sh(repo, "remote", "add", "origin", origin);
  sh(repo, "push", "-q", "-u", "origin", "develop");
  return { root, repo, origin };
}

/** Merge a change into `origin/develop` as ship-change would (archive dir appears). */
export function shipOnOrigin(fx: Fixture, change: string, date = "2026-11-21"): void {
  const clone = path.join(fx.root, `clone-${change}-${Date.now()}`);
  sh(fx.root, "clone", "-q", "-b", "develop", fx.origin, clone);
  sh(clone, "config", "user.email", "t@example.com");
  sh(clone, "config", "user.name", "Tester");
  const dir = path.join(clone, "openspec", "changes", "archive", `${date}-${change}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "proposal.md"), `# ${change}\n`);
  sh(clone, "add", "-A");
  sh(clone, "commit", "-q", "-m", `archive ${change}`);
  sh(clone, "push", "-q", "origin", "develop");
}

export interface Call {
  method: string;
  path: string;
  body?: unknown;
  /** Order stamp shared with `docker` / `bus` records. */
  seq: number;
}

type Handler = (body: Record<string, unknown>, path: string) => RestResponse | Promise<RestResponse> | undefined;

export class FakeDashboard {
  t = 1_700_000_000_000;
  seq = 0;
  calls: Call[] = [];
  /** Ordered log across REST / bus / docker for ordering assertions. */
  log: string[] = [];
  config: Record<string, unknown> = { spawnStrategy: "headless" };
  rest503 = new Map<string, number>(); // change → number of 503s left
  depStatus = new Map<string, number>(); // change → forced status
  edges: Record<string, { change: string; state: "open" | "satisfied" }[]> = {};
  assignments: Record<string, string> = {};
  changeOrder: Record<string, string[]> | undefined;
  groups = [{ id: "g", name: "G" }];
  active: { name: string; status: string }[] = [];
  questions = new Set<string>();
  sessions = new Map<string, SessionObs>();
  archived = new Set<string>();
  /** Per-session archive behaviour: default depends on status. */
  archiveMode = new Map<string, "pending" | "conflict" | "immediate">();
  handlers = new Map<string, Handler>();
  unreachable = false;
  autoArchive = false;
  busConnected = false;
  connectFailures = 0;
  connectAttempts = 0;
  spawned: { cwd: string; attachProposal: string; model: string; initialPrompt: string }[] = [];
  prompts: { id: string; text: string }[] = [];
  spawnError: Error | null = null;
  spawnTimeoutAdopts = false;
  private n = 0;

  constructor(readonly fx: Fixture) {}

  now = (): number => this.t;
  /** Optional world simulation, run after every (instant) sleep. */
  onSleep?: () => void | Promise<void>;
  /** Sessions whose archive intent is finished (ended + archived) at the next sleep. */
  pendingArchives = new Set<string>();
  sleep = async (ms: number): Promise<void> => {
    this.t += ms;
    for (const id of this.pendingArchives) this.endAndArchive(id);
    this.pendingArchives.clear();
    await this.onSleep?.();
  };
  tick(ms = 10_000): void {
    this.t += ms;
  }

  on(key: string, h: Handler): void {
    this.handlers.set(key, h);
  }

  callsTo(method: string, prefix: string): Call[] {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(prefix));
  }

  setStatus(id: string, status: SessionObs["status"]): void {
    const s = this.sessions.get(id);
    if (s) s.status = status;
  }

  addSession(id: string, cwd: string, status: SessionObs["status"] = "idle", startedAt = this.t): SessionObs {
    const s = { id, cwd, status, startedAt };
    this.sessions.set(id, s);
    return s;
  }

  worktree(change: string): string {
    return path.join(this.fx.repo, ".worktrees", `os-${change}`);
  }

  // ── REST ──────────────────────────────────────────────────────────

  rest = async (method: "GET" | "POST", url: string, body?: unknown): Promise<RestResponse> => {
    if (this.unreachable) throw new Error("ECONNREFUSED");
    const call: Call = { method, path: url, body, seq: ++this.seq };
    this.calls.push(call);
    this.log.push(`${method} ${url.split("?")[0]}`);
    const b = (body ?? {}) as Record<string, unknown>;
    const route = url.split("?")[0];
    for (const [key, h] of this.handlers) {
      const [m, ...rest] = key.split(" ");
      if (m === method && route.startsWith(rest.join(" "))) {
        const r = await h(b, url);
        if (r) return r;
      }
    }
    return this.defaultRoute(method, route, url, b);
  };

  private ok(data?: unknown): RestResponse {
    return { status: 200, json: { success: true, ...(data === undefined ? {} : { data }) } };
  }

  private fail(status: number, code: string): RestResponse {
    return { status, json: { success: false, code, error: code } };
  }

  private defaultRoute(method: string, route: string, url: string, b: Record<string, unknown>): RestResponse {
    const key = `${method} ${route}`;
    const table: Record<string, () => RestResponse> = {
      "GET /api/config": () => this.ok(this.config),
      "GET /api/openspec/groups": () =>
        this.ok({ schemaVersion: 1, groups: this.groups, assignments: this.assignments, changeOrder: this.changeOrder }),
      "GET /api/openspec/dependencies": () => this.dependencies(new URL(url, "http://x").searchParams.get("change") as string),
      "GET /api/questions": () => this.ok([...this.questions].map((sessionId) => ({ id: `q-${sessionId}`, sessionId }))),
      "GET /api/sessions": () => this.ok([...this.sessions.values()]),
      "POST /api/git/worktree": () => this.createWorktree(b),
      "POST /api/git/worktree/init": () => this.ok({ ran: false, skippedReason: "no_hook" }),
      "POST /api/git/worktree/orphan-cleanup": () => {
        fs.rmSync(String(b.path), { recursive: true, force: true });
        return this.ok();
      },
      "POST /api/git/worktree/remove": () => this.removeWorktree(String(b.cwd)),
    };
    const exact = table[key];
    if (exact) return exact();
    const id = decodeURIComponent(route.split("/").pop() as string);
    if (method === "GET" && route.startsWith("/api/sessions/archived/")) {
      return this.archived.has(id) ? this.ok({ item: {} }) : this.fail(404, "not_archived");
    }
    if (method === "POST" && /^\/api\/session\/[^/]+\/archive$/.test(route)) return this.archiveRoute(decodeURIComponent(route.split("/")[3]));
    return this.fail(404, `no fake route for ${method} ${route}`);
  }

  private dependencies(change: string): RestResponse {
    const left = this.rest503.get(change) ?? 0;
    if (left > 0) {
      this.rest503.set(change, left - 1);
      return this.fail(503, "pending");
    }
    const forced = this.depStatus.get(change);
    if (forced) return this.fail(forced, "unknown-change");
    return this.ok({ dependencies: { blockedBy: this.edges[change] ?? [] } });
  }

  private removeWorktree(cwd: string): RestResponse {
    const r = spawnSync("git", ["worktree", "remove", "--force", cwd], { cwd: this.fx.repo, encoding: "utf8" });
    return r.status === 0 ? this.ok({}) : this.fail(500, "remove_failed");
  }

  private archiveRoute(id: string): RestResponse {
    const s = this.sessions.get(id);
    if (!s) return this.fail(404, "not_found");
    const mode = this.archiveMode.get(id);
    if (mode === "conflict" || (!mode && s.status !== "ended" && s.status !== "idle")) return this.fail(409, "live");
    if (s.status === "ended" || mode === "immediate") {
      this.archived.add(id);
      this.sessions.delete(id);
      return this.ok();
    }
    // idle + alive → archive intent; the test (or `autoArchive`) ends it later.
    if (this.autoArchive) this.pendingArchives.add(id);
    return { status: 200, json: { success: true, pending: true } };
  }

  /** The idle session exited after an archive intent: ended + archived. */
  endAndArchive(id: string): void {
    this.archived.add(id);
    this.sessions.delete(id);
  }

  /** The intent expired: the session ended but was not archived. */
  endUnarchived(id: string): void {
    this.setStatus(id, "ended");
  }

  private createWorktree(b: Record<string, unknown>): RestResponse {
    const base = String(b.base);
    const newBranch = typeof b.newBranch === "string" ? b.newBranch : undefined;
    const branch = newBranch ?? base.replace(/^origin\//, "");
    const dir = path.join(String(b.cwd), ".worktrees", branch.replace("/", "-"));
    if (fs.existsSync(dir)) {
      const registered = spawnSync("git", ["worktree", "list", "--porcelain"], { cwd: String(b.cwd), encoding: "utf8" }).stdout.includes(dir);
      return this.fail(409, registered ? "branch_in_use" : "path_exists");
    }
    const args = newBranch
      ? ["worktree", "add", "-b", newBranch, dir, base]
      : base.startsWith("origin/")
        ? ["worktree", "add", "-b", branch, "--track", dir, base]
        : ["worktree", "add", dir, base];
    const r = spawnSync("git", args, { cwd: String(b.cwd), encoding: "utf8" });
    if (r.status !== 0) return this.fail(/already (checked out|used by worktree)/.test(r.stderr) ? 409 : 500, /already (checked out|used by worktree)/.test(r.stderr) ? "branch_in_use" : "create_failed");
    return this.ok({ path: dir, branch });
  }

  // ── bus ───────────────────────────────────────────────────────────

  bus: BusPort = {
    connect: async () => {
      this.connectAttempts++;
      if (this.unreachable || this.connectFailures > 0) {
        if (this.connectFailures > 0) this.connectFailures--;
        throw new Error("bus unreachable");
      }
      this.busConnected = true;
    },
    connected: () => this.busConnected && !this.unreachable,
    sessions: () => [...this.sessions.values()],
    spawn: async (opts) => {
      this.seq++;
      this.log.push("bus.spawn");
      if (this.spawnError) {
        if (this.spawnTimeoutAdopts) this.addSession(`s-${++this.n}`, opts.cwd, "streaming");
        throw this.spawnError;
      }
      this.spawned.push({ cwd: opts.cwd, attachProposal: opts.attachProposal, model: opts.model, initialPrompt: opts.initialPrompt });
      const id = `s-${++this.n}`;
      this.addSession(id, opts.cwd, "streaming");
      return id;
    },
    prompt: (id, text) => {
      this.log.push("bus.prompt");
      this.prompts.push({ id, text });
    },
    close: () => {
      this.busConnected = false;
    },
  };

  /** Drop the bus connection (dashboard restart). */
  disconnect(): void {
    this.busConnected = false;
  }

  // ── wiring ────────────────────────────────────────────────────────

  deps(over: Partial<Deps> = {}): Deps {
    return {
      rest: this.rest,
      bus: this.bus,
      now: this.now,
      sleep: this.sleep,
      out: () => {},
      err: () => {},
      hostname: "test-host",
      pid: process.pid,
      isAlive: () => false,
      dockerDown: async (wt) => {
        this.seq++;
        this.log.push(`docker.down ${wt}`);
      },
      listChanges: async () => this.active,
      hasTool: () => true,
      ...over,
    };
  }

  runner(argv: string[] = ["--group", "g"], over: Partial<Deps> = {}, opts: RunnerOptions = {}): Runner {
    const parsed = parseArgs(argv);
    if (!parsed.ok) throw new Error(parsed.error);
    return new Runner(this.deps(over), parsed.args, this.fx.repo, opts);
  }

  /** Connect the bus and plan, like `runMain` does before the loop. */
  async boot(runner: Runner, group = "g"): Promise<void> {
    await this.bus.connect();
    await runner.prepare(group);
  }

  main(argv: string[], over: Partial<Deps> = {}): Promise<number> {
    const parsed = parseArgs(argv);
    if (!parsed.ok) throw new Error(parsed.error);
    return runMain({ ...parsed.args, cwd: parsed.args.cwd ?? this.fx.repo }, this.deps(over));
  }
}

/** Group `g` with the given active, in-progress changes (all assigned to it). */
export function seedGroup(fd: FakeDashboard, changes: string[]): void {
  fd.active = changes.map((name) => ({ name, status: "in-progress" }));
  fd.assignments = Object.fromEntries(changes.map((c) => [c, "g"]));
  fd.changeOrder = { g: changes };
}

export const readState = (fx: Fixture, group = "g") =>
  JSON.parse(fs.readFileSync(path.join(fx.repo, ".worktrees", ".ship-batch", `${group}.json`), "utf8")) as import("../types.ts").BatchState;
