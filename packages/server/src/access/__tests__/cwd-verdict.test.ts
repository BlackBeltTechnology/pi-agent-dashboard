/**
 * `holdCwdDenial` (the plugin seam) and the shared `cwd`-plane verdict re-run.
 *
 * REAL coordinator + REAL cwd plane; only the operator is simulated by answering
 * the broadcast `grant_request` through `onResponse`. A tiny Fastify route calls
 * the seam so `awaitHold` sees a live request/reply.
 *
 * Covers test-plan E24, E25, E26, E28 (re-run undecidable), E30, E31 and the
 * decision half of E27/E29. See change: harden-plugin-cwd-admission.
 */
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CwdHoldDecision, CwdHoldOrigin } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { GitProbeRunner } from "@blackbelt-technology/pi-dashboard-shared/platform/git.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessPlaneRegistry } from "../access-plane.js";
import { createCwdHold, resolveCwdVerdict } from "../cwd-verdict.js";
import { holdDenial, installGrantCoordinator } from "../denial-hold.js";
import { GrantCoordinator } from "../grant-coordinator.js";
import { createCwdPlane } from "../planes.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel } from "../prompt-channel.js";

let tmp: string;
let pinned: string[];
let sent: ServerToBrowserMessage[];
let coordinator: GrantCoordinator;
let capability: string;
let app: FastifyInstance;
let warn: ReturnType<typeof vi.fn>;
let hold: ReturnType<typeof createCwdHold>;
let holdSpy: ReturnType<typeof vi.fn>;
let pinOnAllowAlways = true;
let clock = 1_000_000;
let scheduled: Array<{ fn: () => void; ms: number }> = [];

function makeHold(over: { trusted?: boolean; admitRunner?: GitProbeRunner } = {}) {
  holdSpy = vi.fn((facts, target) => holdDenial(facts, target));
  return createCwdHold({
    pluginId: "mcp-client",
    trusted: over.trusted ?? true,
    known: () => pinned,
    logger: { warn: warn as never },
    hold: holdSpy as never,
    admitOptions: over.admitRunner ? { runner: over.admitRunner } : undefined,
  });
}

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-cwd-verdict-")));
  pinned = [];
  sent = [];
  warn = vi.fn();
  pinOnAllowAlways = true;
  clock = 1_000_000;
  scheduled = [];
  const planes = new AccessPlaneRegistry();
  planes.register(
    createCwdPlane({
      pinDirectory: (d) => {
        if (pinOnAllowAlways) pinned.push(d);
      },
    }),
  );
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
      const t = { fn, ms };
      scheduled.push(t);
      return { cancel: () => void (scheduled = scheduled.filter((x) => x !== t)) };
    },
  });
  installGrantCoordinator(coordinator);
  capability = issuePromptChannel("operator-sock");
  hold = makeHold();
  app = Fastify({ logger: false });
  app.get<{ Querystring: { cwd: string; origin: string; which?: string } }>("/hold", async (request, reply) => {
    const decision = await hold(request, reply, {
      cwd: request.query.cwd,
      origin: request.query.origin as CwdHoldOrigin,
    });
    return decision;
  });
});

afterEach(async () => {
  installGrantCoordinator(null);
  __resetPromptChannels();
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const call = (cwd: string, origin = "mcp:save") =>
  app.inject({
    method: "GET",
    url: `/hold?cwd=${encodeURIComponent(cwd)}&origin=${encodeURIComponent(origin)}`,
    headers: { [GRANT_CHANNEL_HEADER]: capability },
  });

async function nextPrompt(seen = 0) {
  for (let i = 0; i < 400; i++) {
    const prompts = sent.filter((m) => m.type === "grant_request");
    if (prompts.length > seen) {
      const p = prompts[seen];
      if (p.type === "grant_request") return p;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no grant_request was broadcast");
}

async function answer(verdict: "allow-once" | "allow-always" | "deny") {
  const p = await nextPrompt();
  await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict });
  return p;
}

const decisionOf = (res: { json(): unknown }) => res.json() as CwdHoldDecision;
const unknownDir = (name = "x") => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

describe("trust gate and closed origins", () => {
  it("E24: an untrusted plugin resolves refuse and nothing is raised", async () => {
    hold = makeHold({ trusted: false });
    const dir = unknownDir();
    const res = await call(dir);
    expect(decisionOf(res)).toEqual({ kind: "refuse" });
    expect(holdSpy).not.toHaveBeenCalled();
    expect(coordinator.registry.size).toBe(0);
    expect(sent).toEqual([]);
  });

  it("E25: an origin outside the closed set refuses, warns, and raises nothing", async () => {
    const dir = unknownDir();
    const res = await call(dir, "mcp:evil");
    expect(decisionOf(res)).toEqual({ kind: "refuse" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(holdSpy).not.toHaveBeenCalled();
    expect(coordinator.registry.size).toBe(0);
  });

  it("every origin of the closed set is accepted (and recorded under the plugin id)", async () => {
    const dir = unknownDir();
    const pending = call(dir, "kb:reindex");
    const p = await nextPrompt();
    expect(holdSpy).toHaveBeenCalledWith(
      expect.objectContaining({ plane: "cwd", origin: "plugin:mcp-client:kb:reindex", rawSubject: dir }),
      expect.anything(),
    );
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "deny" });
    expect(decisionOf(await pending)).toEqual({ kind: "refuse" });
  });
});

describe("E26: never prompt for an ungrantable subject", () => {
  it.each([
    ["a missing path", () => path.join(tmp, "nope", "missing")],
    ["a .git directory", () => {
      const g = path.join(tmp, "repo", ".git");
      fs.mkdirSync(g, { recursive: true });
      return g;
    }],
    ["an ungrantable subject ($HOME)", () => os.homedir()],
    ["a relative path", () => "relative/dir"],
  ])("%s → refuse, holdDenial not called", async (_label, make) => {
    const res = await call(make());
    expect(decisionOf(res)).toEqual({ kind: "refuse" });
    expect(holdSpy).not.toHaveBeenCalled();
    expect(coordinator.registry.size).toBe(0);
  });
});

describe("verdicts", () => {
  it("E27 (decision half): allow-always pins the directory and admits it", async () => {
    const dir = unknownDir();
    const pending = call(dir);
    await answer("allow-always");
    expect(decisionOf(await pending)).toEqual({ kind: "admit", canonCwd: dir, cwd: expect.any(String) });
    expect(pinned).toEqual([dir]);
  });

  it("E28: allow-always whose re-run is undecidable yields indeterminate, not refuse", async () => {
    pinOnAllowAlways = false; // the pin did not take effect: membership fails and admitCwd must decide
    hold = makeHold({
      admitRunner: async () => ({ ok: false, error: { kind: "timeout", timeoutMs: 1000, binary: "git" } }),
    });
    const dir = unknownDir();
    const pending = call(dir);
    await answer("allow-always");
    expect(decisionOf(await pending)).toEqual({ kind: "indeterminate" });
  });

  it("E29 (decision half): allow-once admits the single request and pins nothing", async () => {
    const dir = unknownDir();
    const pending = call(dir);
    await answer("allow-once");
    expect(decisionOf(await pending)).toEqual({ kind: "admit", canonCwd: dir, cwd: expect.any(String) });
    expect(pinned).toEqual([]);
  });

  it("E30: a symlink swapped in after an allow-once is not admitted", async () => {
    const dir = unknownDir("x");
    const other = unknownDir("y");
    const pending = call(dir);
    const p = await nextPrompt();
    fs.rmSync(dir, { recursive: true });
    fs.symlinkSync(other, dir, "dir");
    await coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-once" });
    expect(decisionOf(await pending)).toEqual({ kind: "refuse" });
  });

  it("E31: deny → refuse", async () => {
    const dir = unknownDir();
    const pending = call(dir);
    await answer("deny");
    expect(decisionOf(await pending)).toEqual({ kind: "refuse" });
  });

  it("E31: no coordinator installed → refuse", async () => {
    installGrantCoordinator(null);
    const dir = unknownDir();
    expect(decisionOf(await call(dir))).toEqual({ kind: "refuse" });
  });

  it("E31: the verdict expiring → refuse", async () => {
    const dir = unknownDir();
    const pending = call(dir);
    await nextPrompt();
    clock += 121_000; // past the entry TTL
    for (const t of [...scheduled]) t.fn();
    expect(decisionOf(await pending)).toEqual({ kind: "refuse" });
  });
});

describe("resolveCwdVerdict (shared re-run)", () => {
  it("admits when a session/pin for the cwd appeared while the dialog was open (canonical compare)", async () => {
    const dir = unknownDir();
    const link = path.join(tmp, "link-to-x");
    fs.symlinkSync(dir, link, "dir");
    // The request names the cwd through a symlink; the verdict subject is its real path.
    // The live known set already holds the real path (a session registered meanwhile).
    const out = await resolveCwdVerdict(
      link,
      { kind: "allow", verdict: "allow-once", subject: dir },
      { known: () => [dir] },
    );
    expect(out).toEqual({ kind: "admit", canonCwd: dir, cwd: expect.any(String) });
  });

  it.each(["allow-once", "allow-always"] as const)(
    "B1: a %s verdict never admits a DIFFERENT folder that is already known (swapped symlink)",
    async (verdict) => {
      const x = unknownDir("x");
      const y = unknownDir("y"); // a known folder
      // The operator answered for `x`; while the request was held `x` became a link to `y`.
      fs.rmSync(x, { recursive: true });
      fs.symlinkSync(y, x, "dir");
      const out = await resolveCwdVerdict(x, { kind: "allow", verdict, subject: x }, { known: () => [y] });
      expect(out).toEqual({ kind: "refuse" });
    },
  );

  it("refuses a deny / a missing path / an allow-once whose subject no longer matches", async () => {
    const dir = unknownDir();
    expect((await resolveCwdVerdict(dir, { kind: "deny", reason: "x" }, { known: () => [] })).kind).toBe("refuse");
    expect(
      (await resolveCwdVerdict(path.join(tmp, "gone"), { kind: "allow", verdict: "allow-once", subject: path.join(tmp, "gone") }, { known: () => [] })).kind,
    ).toBe("refuse");
    expect(
      (await resolveCwdVerdict(dir, { kind: "allow", verdict: "allow-once", subject: `${dir}-other` }, { known: () => [] })).kind,
    ).toBe("refuse");
  });

  it("r2 B2: an allow-always with an unresolvable known folder and no match is indeterminate, not refuse", async () => {
    const dir = unknownDir();
    const pin = unknownDir("pin");
    const { realpathAsync } = await import("@blackbelt-technology/pi-dashboard-shared/platform/git.js");
    const out = await resolveCwdVerdict(
      dir,
      { kind: "allow", verdict: "allow-always", subject: dir },
      {
        known: () => [pin],
        realpath: async (p) => (p === pin ? { kind: "error", code: "EACCES" } : realpathAsync(p)),
      },
    );
    expect(out).toEqual({ kind: "indeterminate" });
  });

  it("r3 B1: a known folder that FAILS to canonicalize never matches, even when its lexical path equals the cwd", async () => {
    const dir = unknownDir();
    const { realpathAsync } = await import("@blackbelt-technology/pi-dashboard-shared/platform/git.js");
    let calls = 0;
    const out = await resolveCwdVerdict(
      dir,
      { kind: "allow", verdict: "allow-always", subject: dir },
      {
        known: () => [dir],
        // call 1 = the cwd's own realpath (ok); call 2 = the known entry (the would-be match) fails.
        realpath: async (p) => (calls++ === 0 ? realpathAsync(p) : { kind: "error", code: "EACCES" }),
      },
    );
    expect(out).toEqual({ kind: "indeterminate" });
  });

  it.each(["allow-once", "allow-always"] as const)(
    "a symlink swapped DURING the verdict's async checks is not admitted (%s)",
    async (verdict) => {
      const x = unknownDir("x");
      const y = unknownDir("y");
      const out = await resolveCwdVerdict(
        x,
        { kind: "allow", verdict, subject: x },
        {
          // `known()` runs after the cwd's real path was first checked: swap the link in then.
          known: () => {
            fs.rmSync(x, { recursive: true });
            fs.symlinkSync(y, x, "dir");
            return [];
          },
          rerunAlways: async () => "admit",
        },
      );
      expect(out).toEqual({ kind: "refuse" });
    },
  );

  it("core site (no rerunAlways): an allow-always that is not in the known set is refused", async () => {
    const dir = unknownDir();
    expect(
      (await resolveCwdVerdict(dir, { kind: "allow", verdict: "allow-always", subject: dir }, { known: () => [] })).kind,
    ).toBe("refuse");
  });
});
