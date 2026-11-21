/**
 * Tests for `POST /api/file/write` — the markdown write surface.
 * Covers the authorization branches (403 out-of-scope, 403 symlink escape),
 * optimistic concurrency (409 mtime mismatch leaves the file unchanged),
 * the success path (atomic write + new mtime), and the global-scope branch.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants, grantedWriteSubjects, listGrants, recordGrant } from "../access/access-grants.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel } from "../access/prompt-channel.js";
import { runWithStateCaller } from "../lib/dashboard-state-guard.js";
import { registerFileRoutes } from "../routes/file-routes.js";

// A seam to run code between the write gate and the atomic write (the symlink-retarget race, #S70).
const raceHook = vi.hoisted(() => ({ beforeTask: null as null | (() => Promise<void>) }));
vi.mock("../lib/file-write-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/file-write-lock.js")>();
  return {
    ...actual,
    serializeWrite: async <T,>(key: string, task: () => Promise<T>): Promise<T> => {
      if (raceHook.beforeTask) await raceHook.beforeTask();
      return actual.serializeWrite(key, task);
    },
  };
});

function makeApp(cwds: string[]): FastifyInstance {
  const app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => cwds.map((cwd) => ({ cwd })) } as any,
    preferencesStore: { getPinnedDirectories: () => [] } as any,
    networkGuard: async () => undefined,
  });
  return app;
}

async function readMtime(p: string): Promise<number> {
  // Full-precision mtime token, matching the server's conflict check (no rounding).
  return (await fsp.stat(p)).mtimeMs;
}

async function write(app: FastifyInstance, body: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/file/write", payload: body });
}

describe("POST /api/file/write — directory scope", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-cwd-")));
    await fsp.writeFile(path.join(cwd, "AGENTS.md"), "# original\n", "utf-8");
    await fsp.writeFile(path.join(cwd, "notes.txt"), "x\n", "utf-8");
    await fsp.writeFile(path.join(cwd, "flow.mmd"), "graph TD\n  A-->B\n", "utf-8");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("writes an in-scope .md and returns the new mtime", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const mtime = await readMtime(target);
    const res = await write(app, { cwd, path: target, content: "# edited\n", mtime });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(typeof body.data.mtime).toBe("number");
    expect(await fsp.readFile(target, "utf-8")).toBe("# edited\n");
    expect(body.data.mtime).toBe(await readMtime(target));
  });

  it("md-read + write accept a .mmd in directory scope (apply-fix round trip)", async () => {
    const target = path.join(cwd, "flow.mmd");
    const read = await app.inject({
      method: "GET",
      url: `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(read.statusCode).toBe(200);
    const { content, mtime } = read.json().data;
    expect(content).toBe("graph TD\n  A-->B\n");
    const res = await write(app, { cwd, path: target, content: "flowchart TD\n  A-->B\n", mtime });
    expect(res.statusCode).toBe(200);
    expect(await fsp.readFile(target, "utf-8")).toBe("flowchart TD\n  A-->B\n");
  });

  it("rejects a non-markdown target with 403 and does not write", async () => {
    const target = path.join(cwd, "notes.txt");
    const res = await write(app, { cwd, path: target, content: "hacked", mtime: await readMtime(target) });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readFile(target, "utf-8")).toBe("x\n");
  });

  it("rejects an out-of-scope path with 403", async () => {
    const res = await write(app, { cwd, path: "/etc/passwd", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a symlink whose realpath escapes the cwd with 403", async () => {
    const outside = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-out-")));
    try {
      const secret = path.join(outside, "secret.md");
      await fsp.writeFile(secret, "# secret\n");
      const link = path.join(cwd, "escape.md");
      await fsp.symlink(secret, link);
      const res = await write(app, { cwd, path: link, content: "# pwned\n", mtime: await readMtime(link) });
      expect(res.statusCode).toBe(403);
      expect(await fsp.readFile(secret, "utf-8")).toBe("# secret\n");
    } finally {
      await fsp.rm(outside, { recursive: true, force: true });
    }
  });

  it("returns 409 on mtime mismatch and leaves the file unchanged", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const staleMtime = (await readMtime(target)) - 5000;
    const res = await write(app, { cwd, path: target, content: "# clobbered\n", mtime: staleMtime });
    expect(res.statusCode).toBe(409);
    expect(await fsp.readFile(target, "utf-8")).toBe("# original\n");
  });

  it("rejects a write to an unregistered session cwd with 403", async () => {
    const res = await write(app, { cwd: "/nope", path: "/nope/x.md", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("unknown session path");
  });
});

// The split-pane editors (MarkdownViewer, EditableSpreadsheetTab) load their
// concurrency token from `GET /api/file`, not `md-read`. That token must
// round-trip through the write check on filesystems with sub-ms mtimes.
// See change: fix-editor-mtime-token-precision.
describe("GET /api/file → POST /api/file/write — token round-trip", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-rt-")));
    await fsp.writeFile(path.join(cwd, "notes.md"), "# original\n", "utf-8");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  async function loadToken(rel: string): Promise<number> {
    const res = await app.inject({
      method: "GET",
      url: `/api/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(rel)}`,
    });
    expect(res.statusCode).toBe(200);
    return res.json().data.mtime;
  }

  it("saves a file with a fractional mtime using the token /api/file returned", async () => {
    const target = path.join(cwd, "notes.md");
    // Sub-millisecond mtime, as APFS/ext4 report (1700000000000.5 ms).
    await fsp.utimes(target, 1700000000.0005, 1700000000.0005);
    expect(Number.isInteger(await readMtime(target))).toBe(false);

    const mtime = await loadToken("notes.md");
    const res = await write(app, { cwd, path: "notes.md", content: "# edited\n", mtime });
    expect(res.statusCode).toBe(200);
    expect(await fsp.readFile(target, "utf-8")).toBe("# edited\n");
  });

  it("still returns 409 when the file changed on disk after /api/file loaded it", async () => {
    const target = path.join(cwd, "notes.md");
    await fsp.utimes(target, 1700000000.0005, 1700000000.0005);
    const mtime = await loadToken("notes.md");

    await fsp.writeFile(target, "# external\n", "utf-8");
    await fsp.utimes(target, 1700000100.25, 1700000100.25);

    const res = await write(app, { cwd, path: "notes.md", content: "# mine\n", mtime });
    expect(res.statusCode).toBe(409);
    expect(await fsp.readFile(target, "utf-8")).toBe("# external\n");
  });
});

describe("POST /api/file/write — global scope", () => {
  let app: FastifyInstance;
  let home: string;
  let agentDir: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-home-")));
    agentDir = path.join(home, ".pi", "agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.writeFile(path.join(agentDir, "MEMORY.md"), "# mem\n", "utf-8");
    await fsp.writeFile(path.join(agentDir, "flow.mmd"), "graph TD\n", "utf-8");
    await fsp.mkdir(path.join(home, "Documents"), { recursive: true });
    await fsp.writeFile(path.join(home, "Documents", "secret.md"), "# s\n", "utf-8");
    // Point the guard's default home (os.homedir → $HOME on POSIX) at the fake home.
    realHome = process.env.HOME;
    process.env.HOME = home;
    app = makeApp([]);
    await app.ready();
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    await app.close();
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("writes a global-scope .md under ~/.pi/agent (no cwd)", async () => {
    const target = path.join(agentDir, "MEMORY.md");
    const mtime = await readMtime(target);
    const res = await write(app, { path: target, content: "# updated\n", mtime });
    expect(res.statusCode).toBe(200);
    expect(await fsp.readFile(target, "utf-8")).toBe("# updated\n");
  });

  it("rejects a global-scope Mermaid source with 403 (directory scope only)", async () => {
    const target = path.join(agentDir, "flow.mmd");
    const res = await write(app, { path: target, content: "x\n", mtime: await readMtime(target) });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readFile(target, "utf-8")).toBe("graph TD\n");
  });

  it("rejects a global-scope path outside ~/.pi/agent with 403", async () => {
    const target = path.join(home, "Documents", "secret.md");
    const res = await write(app, { path: target, content: "# x\n", mtime: await readMtime(target) });
    expect(res.statusCode).toBe(403);
    expect(await fsp.readFile(target, "utf-8")).toBe("# s\n");
  });

  it("rejects a relative path in global scope with 400", async () => {
    const res = await write(app, { path: "MEMORY.md", content: "x", mtime: 1 });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /api/file/md-read", () => {
  let app: FastifyInstance;
  let cwd: string;
  let home: string;
  let agentDir: string;
  let realHome: string | undefined;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mr-cwd-")));
    await fsp.writeFile(path.join(cwd, "AGENTS.md"), "# agents\n", "utf-8");
    await fsp.writeFile(path.join(cwd, "notes.txt"), "x\n", "utf-8");
    home = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "mr-home-")));
    agentDir = path.join(home, ".pi", "agent");
    await fsp.mkdir(agentDir, { recursive: true });
    await fsp.writeFile(path.join(agentDir, "MEMORY.md"), "# mem\n", "utf-8");
    realHome = process.env.HOME;
    process.env.HOME = home;
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    if (realHome !== undefined) process.env.HOME = realHome;
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
    await fsp.rm(home, { recursive: true, force: true });
  });

  it("reads an in-scope .md in directory scope with content + mtime", async () => {
    const target = path.join(cwd, "AGENTS.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.content).toBe("# agents\n");
    expect(body.data.mtime).toBe(await readMtime(target));
  });

  it("reads a global-scope .md under ~/.pi/agent (no cwd)", async () => {
    const target = path.join(agentDir, "MEMORY.md");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.content).toBe("# mem\n");
  });

  it("rejects a non-markdown target with 403", async () => {
    const target = path.join(cwd, "notes.txt");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a global path outside ~/.pi/agent with 403", async () => {
    const outside = path.join(home, "secret.md");
    await fsp.writeFile(outside, "# s\n");
    const res = await app.inject({
      method: "GET",
      url: `/api/file/md-read?path=${encodeURIComponent(outside)}`,
    });
    expect(res.statusCode).toBe(403);
  });
});

// See change: gate-changed-on-disk-by-content (test-plan #E9, #E10).
describe("POST /api/file/write — sha1 round-trip + body limit", () => {
  let app: FastifyInstance;
  let cwd: string;

  beforeEach(async () => {
    cwd = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "fw-sha-")));
    await fsp.writeFile(path.join(cwd, "doc.md"), "# original\n", "utf-8");
    app = makeApp([cwd]);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await fsp.rm(cwd, { recursive: true, force: true });
  });

  it("E9: returns mtime, UTF-8 byte size and a sha1 equal to the digest endpoint's", async () => {
    const target = path.join(cwd, "doc.md");
    const content = "\uFEFF# Héllo wörld — ✓\r\nline two\r\n";
    const res = await write(app, { cwd, path: target, content, mtime: await readMtime(target) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    const bytes = Buffer.from(content, "utf8");
    expect(data.size).toBe(bytes.length);
    expect(data.mtime).toBe(await readMtime(target));
    expect(data.sha1).toBe(createHash("sha1").update(bytes).digest("hex"));
    expect(await fsp.readFile(target)).toEqual(bytes);

    const dig = await app.inject({
      method: "GET",
      url: `/api/file/digest?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`,
    });
    expect(dig.statusCode).toBe(200);
    expect(dig.json().data.sha1).toBe(data.sha1);
  });

  it("E10: accepts a 20 MiB .md (above Fastify's 1 MiB default) and refuses content over the 256 MiB ceiling with 413", async () => {
    const target = path.join(cwd, "doc.md");
    const twenty = "a".repeat(20 * 1024 * 1024);
    const ok = await write(app, { cwd, path: target, content: twenty, mtime: await readMtime(target) });
    expect(ok.statusCode).toBe(200);
    expect(typeof ok.json().data.sha1).toBe("string");
    expect((await fsp.stat(target)).size).toBe(20 * 1024 * 1024);

    const over = "a".repeat(256 * 1024 * 1024 + 1);
    const before = await readMtime(target);
    const res = await write(app, { cwd, path: target, content: over, mtime: before });
    expect(res.statusCode).toBe(413);
    expect((await fsp.stat(target)).size).toBe(20 * 1024 * 1024);
    expect(await readMtime(target)).toBe(before);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// fix-file-link-editor-routing 3c: a text doc OUTSIDE the session cwd is writable only through a
// WRITE-mode grant or a fresh write prompt (D2). The coordinator has REAL planes; only the operator is
// simulated, by answering the broadcast `grant_request` (same wiring as denial-prompt-binding.test.ts).
// test-plan #S25-#S33, #S70, #S71, #S77.
// ---------------------------------------------------------------------------
describe("POST /api/file/write — outside the cwd (write-mode grants)", () => {
  let tmp: string;
  let cwd: string;
  let outside: string;
  let sent: ServerToBrowserMessage[];
  let coordinator: GrantCoordinator;
  let capability: string;
  let app: FastifyInstance;
  let clock: number;
  let timers: Array<{ fn: () => void; at: number; cancelled: boolean }>;
  let dashDir: string;
  let realHome: string | undefined;
  let stateCaller: { gatedAdmitted: () => boolean; unproven: () => boolean } | null;

  beforeEach(async () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "fw-outside-")));
    cwd = path.join(tmp, "session");
    outside = path.join(tmp, "outside");
    fs.mkdirSync(cwd, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(cwd, "in.md"), "# in\n");
    fs.writeFileSync(path.join(outside, "x.md"), "# x\n");
    realHome = process.env.HOME;
    process.env.HOME = path.join(tmp, "home");
    dashDir = path.join(process.env.HOME, ".pi", "dashboard");
    fs.mkdirSync(path.join(dashDir, "local"), { recursive: true });
    process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
    __resetAccessGrants();
    __resetPathDenials();
    sent = [];
    clock = 1_000_000;
    timers = [];
    stateCaller = null;
    raceHook.beforeTask = null;
    const planes = new AccessPlaneRegistry();
    planes.register(createFilesystemPlane());
    coordinator = new GrantCoordinator({
      planes,
      broadcast: (m) => sent.push(m),
      hostGateMode: () => "enforce",
      promptEnabled: () => true,
      killSwitch: () => false,
      operatorChannels: () => 1,
      onTransition: () => {},
      now: () => clock,
      schedule: (fn, ms) => {
        const job = { fn, at: clock + ms, cancelled: false };
        timers.push(job);
        return { cancel: () => (job.cancelled = true) };
      },
    });
    installGrantCoordinator(coordinator);
    capability = issuePromptChannel("operator-sock");
    app = Fastify({ logger: false });
    // Production installs the caller per request (`server.ts`); a test may scope one.
    app.addHook("onRequest", (_req, _reply, done) => (stateCaller ? runWithStateCaller(stateCaller, done) : done()));
    registerFileRoutes(app, {
      sessionManager: { listAll: () => [{ cwd }] } as never,
      preferencesStore: { getPinnedDirectories: () => [] } as never,
      networkGuard: async () => undefined,
    });
    await app.ready();
  });

  afterEach(async () => {
    raceHook.beforeTask = null;
    vi.restoreAllMocks();
    await app.close();
    installGrantCoordinator(null);
    __resetPromptChannels();
    delete process.env.PI_ACCESS_GRANTS_STORE;
    if (realHome !== undefined) process.env.HOME = realHome;
    __resetAccessGrants();
    __resetPathDenials();
    fs.chmodSync(outside, 0o755);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const mtimeOf = (p: string) => fs.statSync(p).mtimeMs;
  const sha = (p: string) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const prompts = () =>
    sent.filter(
      (m): m is Extract<ServerToBrowserMessage, { type: "grant_request" }> & { action?: "read" | "write" } =>
        m.type === "grant_request",
    );

  async function nextPrompt(n = 1) {
    for (let i = 0; i < 400; i++) {
      if (prompts().length >= n) return prompts()[n - 1];
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("no grant_request was broadcast");
  }
  const answer = (p: { promptId: string; plane: string; subject: string }, verdict: "allow-once" | "allow-always" | "deny") =>
    coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict });
  const post = (body: Record<string, unknown>, headers: Record<string, string> = { [GRANT_CHANNEL_HEADER]: capability }) =>
    app.inject({ method: "POST", url: "/api/file/write", payload: { cwd, ...body }, headers });
  /** A pending POST; resolves with the response. */
  const held = (target: string, content = "# edited\n", mtime = mtimeOf(target)) => post({ path: target, content, mtime });
  /** Settle a response promise without awaiting a hold that should NOT happen. */
  const settled = (p: Promise<unknown>) => Promise.race([p.then(() => true), new Promise((r) => setTimeout(() => r(false), 150))]);

  it("S25 a dashboard-state path is refused before any grant or prompt (always tier and trust-gated tier)", async () => {
    const alwaysTier = path.join(dashDir, "local", "notes.md");
    const gatedTier = path.join(dashDir, "config.md");
    fs.writeFileSync(alwaysTier, "# s\n");
    fs.writeFileSync(gatedTier, "# s\n");
    // `~/.pi` is a forbidden grant subject: no write grant can ever cover the state dir.
    expect(recordGrant({ subject: dashDir, mode: "write" }).ok).toBe(false);
    stateCaller = { gatedAdmitted: () => false, unproven: () => false };
    for (const target of [alwaysTier, gatedTier]) {
      const res = await held(target);
      expect(res.statusCode, target).toBe(403);
      expect(res.json().denialId, "no remedy, nothing to grant").toBeUndefined();
      expect(sha(target)).toBe(createHash("sha256").update("# s\n").digest("hex"));
    }
    expect(prompts()).toEqual([]);
  });

  describe("S27 outside-cwd matrix", () => {
    it("no grant + prompt-eligible → suspends with hold action 'write'; deny → 403 with the remedy", async () => {
      const target = path.join(outside, "x.md");
      const before = sha(target);
      const pending = held(target);
      const prompt = await nextPrompt();
      expect(prompt.action).toBe("write");
      expect(prompt.plane).toBe("filesystem");
      await answer(prompt, "deny");
      const res = await pending;
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("path outside working directory — write not granted");
      expect(res.json().denialId).toEqual(expect.any(String));
      expect(sha(target)).toBe(before);
    });

    it("a READ grant on the directory does not admit the write: it still prompts", async () => {
      const target = path.join(outside, "x.md");
      recordGrant({ subject: outside }); // read mode
      const pending = held(target);
      const prompt = await nextPrompt();
      expect(prompt.action).toBe("write");
      await answer(prompt, "deny");
      expect((await pending).statusCode).toBe(403);
    });

    it("a path under a bound checkout root (worktree parent / repo) does not admit the write", async () => {
      const repo = path.join(tmp, "repo");
      fs.mkdirSync(path.join(repo, "sub"), { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: repo });
      fs.writeFileSync(path.join(repo, "root.md"), "# r\n");
      // The session cwd is a SUBDIRECTORY of the repo: reads reach the checkout root, writes must not.
      const sub = path.join(repo, "sub");
      const app2 = Fastify({ logger: false });
      registerFileRoutes(app2, {
        sessionManager: { listAll: () => [{ cwd: sub }] } as never,
        preferencesStore: { getPinnedDirectories: () => [] } as never,
        networkGuard: async () => undefined,
      });
      await app2.ready();
      try {
        const target = path.join(repo, "root.md");
        const pending = app2.inject({
          method: "POST",
          url: "/api/file/write",
          headers: { [GRANT_CHANNEL_HEADER]: capability },
          payload: { cwd: sub, path: target, content: "# w\n", mtime: mtimeOf(target) },
        });
        const prompt = await nextPrompt();
        expect(prompt.action).toBe("write");
        await answer(prompt, "deny");
        expect((await pending).statusCode).toBe(403);
        expect(fs.readFileSync(target, "utf8")).toBe("# r\n");
      } finally {
        await app2.close();
      }
    });

    it("a write grant → 200 + mtime, no prompt", async () => {
      const target = path.join(outside, "x.md");
      recordGrant({ subject: outside, mode: "write" });
      const res = await held(target);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.mtime).toBe(mtimeOf(target));
      expect(fs.readFileSync(target, "utf8")).toBe("# edited\n");
      expect(prompts()).toEqual([]);
    });

    it("a bare caller without the prompt capability → immediate 403, nothing prompted, nothing written", async () => {
      const target = path.join(outside, "x.md");
      const res = await post({ path: target, content: "# e\n", mtime: mtimeOf(target) }, {});
      expect(res.statusCode).toBe(403);
      expect(prompts()).toEqual([]);
      expect(fs.readFileSync(target, "utf8")).toBe("# x\n");
    });

    it("an unproven bare-loopback caller (D8) is refused at once and never prompted", async () => {
      stateCaller = { gatedAdmitted: () => true, unproven: () => true };
      const target = path.join(outside, "x.md");
      const res = await held(target);
      expect(res.statusCode).toBe(403);
      expect(prompts()).toEqual([]);
    });

    it("an in-cwd write is unchanged: 200, no prompt", async () => {
      const target = path.join(cwd, "in.md");
      const res = await held(target);
      expect(res.statusCode).toBe(200);
      expect(prompts()).toEqual([]);
    });
  });

  it("S28 allow once writes once and persists nothing; allow always persists a write grant", async () => {
    const target = path.join(outside, "x.md");
    const first = held(target, "# once\n");
    await answer(await nextPrompt(1), "allow-once");
    const ok = await first;
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.mtime).toBe(mtimeOf(target));
    expect(listGrants()).toEqual([]);

    // The second write prompts again (past the registry's 120 s post-answer backoff, which swallows a repeat).
    clock += 130_000;
    const second = held(target, "# twice\n");
    const p2 = await nextPrompt(2);
    expect(fs.readFileSync(target, "utf8")).toBe("# once\n");
    await answer(p2, "allow-always");
    expect((await second).statusCode).toBe(200);
    expect(grantedWriteSubjects()).toEqual([outside]);
    expect(listGrants()[0]).toMatchObject({ mode: "write", via: "prompt" });

    // …and later writes need no prompt.
    sent = [];
    expect((await held(target, "# third\n")).statusCode).toBe(200);
    expect(prompts()).toEqual([]);
  });

  it("S29 deny writes nothing; an unanswered hold expires to the same 403", async () => {
    const target = path.join(outside, "x.md");
    const before = sha(target);
    const denied = held(target);
    await answer(await nextPrompt(1), "deny");
    const res = await denied;
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ success: false, error: "path outside working directory — write not granted" });
    for (const key of ["reason", "hint", "subject", "denialId", "ancestors"]) expect(res.json(), key).toHaveProperty(key);
    expect(sha(target)).toBe(before);

    // Expiry: never answered; the entry's TTL runs out (after the 120 s post-answer backoff).
    clock += 130_000;
    const expiring = held(target);
    await nextPrompt(2);
    clock += 130_000;
    for (const t of timers) if (!t.cancelled && t.at <= clock) t.fn();
    const expired = await expiring;
    expect(expired.statusCode).toBe(403);
    expect(expired.json().error).toBe("path outside working directory — write not granted");
    expect(sha(target)).toBe(before);
  });

  it("S30 a nonexistent outside doc prompts BEFORE any stat, then 404, and creates nothing", async () => {
    const missing = path.join(outside, "missing.md");
    const listing = fs.readdirSync(outside).sort();
    const pending = post({ path: missing, content: "# new\n", mtime: 1 });
    // The request is suspended on the prompt: a stat-first route would already have answered 404.
    const prompt = await nextPrompt();
    expect(await settled(pending)).toBe(false);
    await answer(prompt, "allow-once");
    const res = await pending;
    expect(res.statusCode).toBe(404);
    expect(fs.readdirSync(outside).sort()).toEqual(listing);
  });

  it("S31 the gate precedes the mtime check: equal → 200; either off-by-one → 409 and the file is unchanged", async () => {
    const target = path.join(outside, "x.md");
    recordGrant({ subject: outside, mode: "write" });
    const disk = mtimeOf(target);
    for (const delta of [-1, 1]) {
      const res = await post({ path: target, content: "# stale\n", mtime: disk + delta });
      expect(res.statusCode, `mtime ${delta}`).toBe(409);
      expect(fs.readFileSync(target, "utf8")).toBe("# x\n");
    }
    expect((await post({ path: target, content: "# fresh\n", mtime: disk })).statusCode).toBe(200);
    expect(prompts()).toEqual([]);
  });

  it("S32 global scope (no cwd) is unchanged: ~/.pi/agent writes, everything else is a 403 with NO prompt", async () => {
    const agent = path.join(process.env.HOME as string, ".pi", "agent");
    const docs = path.join(process.env.HOME as string, "Documents");
    fs.mkdirSync(agent, { recursive: true });
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(agent, "a.md"), "# a\n");
    fs.writeFileSync(path.join(agent, "f.mmd"), "graph TD\n");
    fs.writeFileSync(path.join(docs, "s.md"), "# s\n");
    const g = (target: string) =>
      app.inject({
        method: "POST",
        url: "/api/file/write",
        headers: { [GRANT_CHANNEL_HEADER]: capability },
        payload: { path: target, content: "# g\n", mtime: mtimeOf(target) },
      });
    expect((await g(path.join(agent, "a.md"))).statusCode).toBe(200);
    expect((await g(path.join(docs, "s.md"))).statusCode).toBe(403);
    expect((await g(path.join(agent, "f.mmd"))).statusCode).toBe(403);
    expect(prompts()).toEqual([]);
  });

  it("S33 a `..` traversal into a sibling suspends for a write prompt; deny writes nothing", async () => {
    const sibling = path.join(tmp, "sibling");
    fs.mkdirSync(sibling);
    const evil = path.join(sibling, "evil.adoc");
    fs.writeFileSync(evil, "= evil\n");
    const pending = post({ path: `${cwd}/../sibling/evil.adoc`, content: "= pwned\n", mtime: mtimeOf(evil) });
    const prompt = await nextPrompt();
    expect(prompt.action).toBe("write");
    await answer(prompt, "deny");
    expect((await pending).statusCode).toBe(403);
    expect(fs.readFileSync(evil, "utf8")).toBe("= evil\n");
  });

  it("S70 a symlink repointed DURING the hold is refused: both targets stay byte-identical", async () => {
    const a = path.join(tmp, "A");
    const b = path.join(tmp, "B");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "x.md"), "# a\n");
    fs.writeFileSync(path.join(b, "y.md"), "# b\n");
    const link = path.join(outside, "link.md");
    fs.symlinkSync(path.join(a, "x.md"), link);

    const pending = post({ path: link, content: "# pwned\n", mtime: mtimeOf(path.join(a, "x.md")) });
    const prompt = await nextPrompt();
    expect(prompt.subject).toBe(a); // the grant would name the REAL target's directory
    fs.rmSync(link);
    fs.symlinkSync(path.join(b, "y.md"), link); // repointed while the operator decides
    await answer(prompt, "allow-always");
    const res = await pending;
    expect([403, 409]).toContain(res.statusCode);
    expect(fs.readFileSync(path.join(a, "x.md"), "utf8")).toBe("# a\n");
    expect(fs.readFileSync(path.join(b, "y.md"), "utf8")).toBe("# b\n");
  });

  it("S70 a symlink repointed between the gate and the atomic write is refused (realpath re-bind)", async () => {
    const a = path.join(tmp, "A2");
    const b = path.join(tmp, "B2");
    fs.mkdirSync(a);
    fs.mkdirSync(b);
    fs.writeFileSync(path.join(a, "x.md"), "# a\n");
    fs.writeFileSync(path.join(b, "y.md"), "# b\n");
    const link = path.join(outside, "link2.md");
    fs.symlinkSync(path.join(a, "x.md"), link);
    recordGrant({ subject: a, mode: "write" });
    raceHook.beforeTask = async () => {
      raceHook.beforeTask = null;
      fs.rmSync(link);
      fs.symlinkSync(path.join(b, "y.md"), link);
    };
    const res = await post({ path: link, content: "# pwned\n", mtime: mtimeOf(path.join(a, "x.md")) });
    expect([403, 409]).toContain(res.statusCode);
    expect(fs.readFileSync(path.join(a, "x.md"), "utf8")).toBe("# a\n");
    expect(fs.readFileSync(path.join(b, "y.md"), "utf8")).toBe("# b\n");
  });

  it.skipIf(process.getuid?.() === 0)("S71 an atomic-write failure outside the cwd answers non-2xx, keeps the original and leaves no tmp file", async () => {
    const target = path.join(outside, "x.md");
    recordGrant({ subject: outside, mode: "write" });
    const mtime = mtimeOf(target);
    fs.chmodSync(outside, 0o555);
    const res = await post({ path: target, content: "# nope\n", mtime });
    fs.chmodSync(outside, 0o755);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error).toEqual(expect.any(String));
    expect(fs.readFileSync(target, "utf8")).toBe("# x\n");
    expect(fs.readdirSync(outside).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });

  it("S77 concurrent writes for one directory: allow-once admits only the first; allow-always releases both", async () => {
    fs.writeFileSync(path.join(outside, "a.md"), "# a\n");
    fs.writeFileSync(path.join(outside, "b.md"), "# b\n");
    const a = path.join(outside, "a.md");
    const b = path.join(outside, "b.md");

    const first = held(a, "# a2\n");
    const prompt = await nextPrompt(1);
    const joiner = held(b, "# b2\n");
    for (let i = 0; i < 400 && (coordinator.registry.list(clock)[0]?.hits ?? 0) < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(coordinator.registry.list(clock)).toHaveLength(1);
    await answer(prompt, "allow-once");
    expect((await first).statusCode).toBe(200);
    const refused = await joiner;
    expect(refused.statusCode).toBe(403);
    expect(fs.readFileSync(b, "utf8")).toBe("# b\n");
    expect(listGrants()).toEqual([]);
    // A third write prompts again (past the 120 s post-answer backoff).
    clock += 130_000;
    const third = held(b, "# b3\n");
    const p3 = await nextPrompt(2);

    // allow-always on the third + a joiner → both released.
    const joiner2 = held(a, "# a3\n", mtimeOf(a));
    for (let i = 0; i < 400 && (coordinator.registry.list(clock)[0]?.hits ?? 0) < 2; i++) await new Promise((r) => setTimeout(r, 5));
    await answer(p3, "allow-always");
    expect((await third).statusCode).toBe(200);
    expect((await joiner2).statusCode).toBe(200);
    expect(listGrants().filter((g) => g.mode === "write")).toHaveLength(1);
  });
});
