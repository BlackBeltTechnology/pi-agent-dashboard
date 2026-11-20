/**
 * A read admitted only after an operator hold carries the real path the re-evaluation decided on, and its
 * open is bound to it like any other: swapped for an outside link after the verdict it is refused (no byte
 * read), unswapped it is served as before.
 *
 * Same wiring as `denial-prompt-outcome.test.ts`: the coordinator has REAL planes and only the operator is
 * simulated, by answering the broadcast `grant_request`.
 *
 * See change: close-local-listener-and-egress-gaps (D2; test-plan #E23, #E33).
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { containmentAllows } from "@blackbelt-technology/pi-dashboard-shared/containment-guard.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPathDenials } from "../access/access-denials.js";
import { __resetAccessGrants } from "../access/access-grants.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { evaluateContainment } from "../access/containment-gate.js";
import { installGrantCoordinator } from "../access/denial-hold.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import { __resetPromptChannels, GRANT_CHANNEL_HEADER, issuePromptChannel } from "../access/prompt-channel.js";
import { registerFileRoutes } from "../routes/file-routes.js";

const MARKER = "HELD-OUTSIDE-MARKER-31c9";

let tmp: string;
let cwd: string;
let outside: string;
let target: string;
let sent: ServerToBrowserMessage[];
let coordinator: GrantCoordinator;
let capability: string;
let app: FastifyInstance;

beforeEach(async () => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prompt-binding-")));
  cwd = path.join(tmp, "session");
  outside = path.join(tmp, "outside");
  target = path.join(outside, "d", "a.png");
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "png-original");
  process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
  __resetAccessGrants();
  __resetPathDenials();
  sent = [];
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
  });
  installGrantCoordinator(coordinator);
  capability = issuePromptChannel("operator-sock");
  app = Fastify({ logger: false });
  registerFileRoutes(app, {
    sessionManager: { listAll: () => [{ cwd }] } as never,
    preferencesStore: { getPinnedDirectories: () => [] } as never,
    networkGuard: async () => undefined,
  });
  await app.ready();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await app.close();
  installGrantCoordinator(null);
  __resetPromptChannels();
  delete process.env.PI_ACCESS_GRANTS_STORE;
  __resetAccessGrants();
  __resetPathDenials();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function nextPrompt() {
  for (let i = 0; i < 200; i++) {
    const p = sent.find((m) => m.type === "grant_request");
    if (p && p.type === "grant_request") return p;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("no grant_request was broadcast");
}

const answerAllowOnce = (p: { promptId: string; plane: string; subject: string }) =>
  coordinator.onResponse({ promptId: p.promptId, plane: p.plane, subject: p.subject, verdict: "allow-once" });

const urlFor = (route: string) => `${route}?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(target)}`;
const heldGet = (route: string) => app.inject({ method: "GET", url: urlFor(route), headers: { [GRANT_CHANNEL_HEADER]: capability } });

/** Instruments handles opened on `target` and swaps it for an outside link right before the open completes. */
function swapOnOpen() {
  const state = { swapped: false, handles: [] as Array<{ reads: number; closes: number }> };
  const realOpen = fsp.open.bind(fsp);
  vi.spyOn(fsp, "open").mockImplementation((async (p: Parameters<typeof fsp.open>[0], ...rest: unknown[]) => {
    const hit = String(p) === target;
    if (hit && !state.swapped) {
      state.swapped = true;
      const elsewhere = path.join(tmp, "elsewhere.png");
      fs.writeFileSync(elsewhere, MARKER);
      fs.rmSync(target);
      fs.symlinkSync(elsewhere, target);
    }
    const fh = await (realOpen as (...a: unknown[]) => Promise<Awaited<ReturnType<typeof fsp.open>>>)(p, ...rest);
    if (hit) {
      const rec = { reads: 0, closes: 0 };
      state.handles.push(rec);
      for (const m of ["read", "readFile", "createReadStream"] as const) {
        const orig = (fh[m] as (...a: unknown[]) => unknown).bind(fh);
        (fh as unknown as Record<string, unknown>)[m] = (...a: unknown[]) => {
          rec.reads++;
          return orig(...a);
        };
      }
      const close = fh.close.bind(fh);
      fh.close = (() => {
        rec.closes++;
        return close();
      }) as typeof fh.close;
    }
    return fh;
  }) as never);
  return state;
}

describe("a held, operator-allowed read is opened bound to the re-evaluated real path", () => {
  it.each(["/api/file", "/api/file/raw"])("T.23 %s: swapped to an outside link after the verdict → 403, no byte read", async (route) => {
    const state = swapOnOpen();
    const pending = heldGet(route);
    await answerAllowOnce(await nextPrompt());
    const res = await pending;
    expect(state.swapped).toBe(true);
    expect(res.statusCode).toBe(403);
    expect(res.json().success).toBe(false);
    expect(res.body).not.toContain(MARKER);
    for (const h of state.handles) {
      expect(h.reads).toBe(0);
      expect(h.closes).toBe(1);
    }
  });

  it.each(["/api/file", "/api/file/raw"])("T.33 %s: refused → suspended → allowed once → served exactly as before", async (route) => {
    const pending = heldGet(route);
    await answerAllowOnce(await nextPrompt());
    const res = await pending;
    expect(res.statusCode).toBe(200);
    if (route === "/api/file/raw") expect(res.body).toBe("png-original");
    else expect(res.json().data.type).toBe("file");
  });

  it("T.33 the returned decision carries the same `resolved` and a `real`, and containmentAllows is true", async () => {
    const hold = {
      request: { raw: new EventEmitter(), headers: { [GRANT_CHANNEL_HEADER]: capability }, ip: "127.0.0.1" },
      reply: { raw: new EventEmitter() },
    };
    const pending = evaluateContainment(target, [cwd], { site: "test:held", hold: hold as never });
    await answerAllowOnce(await nextPrompt());
    const decision = await pending;
    expect(decision).toMatchObject({ allowed: true, viaGrant: true, resolved: target, real: fs.realpathSync(target) });
    expect(containmentAllows(decision, target)).toBe(true);
  });
});
