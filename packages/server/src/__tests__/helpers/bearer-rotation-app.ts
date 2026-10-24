/**
 * Shared harness for the browser-bearer expiry / rotation scenarios
 * (AE34..AE75, AP1..AP5, AX1..AX13). Real `registerBearerAuth` + device-session
 * + rotate route + tier gate + network guard around a real
 * `PairedDeviceRegistry`; tests drive time with `vi.setSystemTime`.
 * See change: harden-auth-credentials (D5).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { vi } from "vitest";
import { registerBearerAuth, registerDeviceSessionRoutes } from "../../auth/bearer-auth.js";
import { createRouteTierGate } from "../../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../../pairing/paired-devices.js";
import { registerBearerRotateRoute } from "../../routes/pairing-routes.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const REMOTE = "203.0.113.9";
export const LOOPBACK = "127.0.0.1";
/** Fixed fake clock origin (never the real clock). */
export const T0 = Date.UTC(2030, 0, 1, 0, 0, 0);

export interface RotationApp {
  app: FastifyInstance;
  reg: PairedDeviceRegistry;
  dir: string;
  file: string;
  /** Raw registry file bytes. */
  bytes: () => string;
  close: () => Promise<void>;
}

export interface RotationAppOpts {
  /** Peers admitted with NO credential: `loopback` (127.0.0.1), `all` (legacy `0.0.0.0/0`), or `none` (default). */
  open?: "loopback" | "all" | "none";
  /** Existing registry file to load instead of an empty one. */
  seed?: (file: string) => void;
}

export async function mkRotationApp(opts: RotationAppOpts = {}): Promise<RotationApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-rot-"));
  const file = path.join(dir, "paired.json");
  opts.seed?.(file);
  const reg = new PairedDeviceRegistry(file);
  const open = opts.open ?? "none";
  const trusted = open === "all" ? ["0.0.0.0/0"] : [];
  const app = Fastify();
  await app.register(fastifyCookie);
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  registerDeviceSessionRoutes(app, { registry: reg, isSecure: () => false });
  registerBearerRotateRoute(app, { registry: reg });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => trusted, logRefusal: () => {} }));
  // Stand-in for the network guard + login gate: a peer with no admitted network and no
  // authenticated credential gets the plain 401 (the same body for every refusal).
  app.addHook("onRequest", async (request, reply) => {
    if ((request as any).isAuthenticated) return;
    if (open === "all" || (open === "loopback" && request.ip === LOOPBACK)) return;
    // Public bootstrap-style routes are the handler's business (it answers its own 401).
    if (request.routeOptions?.url === "/api/paired-devices/rotate") return;
    reply.code(401).send({ success: false, error: "unauthorized" });
    return reply;
  });
  app.get("/api/sessions", async () => ({ ok: true }));
  app.post("/api/ws-ticket", async () => ({ ok: true }));
  await app.ready();
  return {
    app,
    reg,
    dir,
    file,
    bytes: () => fs.readFileSync(file, "utf8"),
    close: async () => {
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

export function get(a: RotationApp, token: string | null, peer = REMOTE, url = "/api/sessions") {
  return a.app.inject({ method: "GET", url, remoteAddress: peer, headers: token ? bearer(token) : {} });
}

export function rotate(
  a: RotationApp,
  token: string | null,
  body?: unknown,
  peer = REMOTE,
  extraHeaders: Record<string, string> = {},
) {
  return a.app.inject({
    method: "POST",
    url: "/api/paired-devices/rotate",
    remoteAddress: peer,
    headers: { ...(token ? bearer(token) : {}), ...extraHeaders },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
}

/** Write a registry file as pre-change (or hand-edited) code would have. */
export function writeRegistryRows(file: string, rows: Array<{ token: string } & Record<string, unknown>>): void {
  const out = rows.map(({ token, ...rest }) => ({
    id: crypto.randomUUID(),
    label: "legacy",
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
    createdAt: new Date(T0).toISOString(),
    lastSeen: null,
    source: "pairing",
    tier: "operate",
    ...rest,
  }));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
}

/** `GET` once with `token` so the throttled last-seen write lands, then return the file bytes. */
export async function settledBytes(a: RotationApp, token: string): Promise<string> {
  await get(a, token);
  return a.bytes();
}

/** Fake the clock's `Date` only (`app.inject` keeps real timers); returns `{ at, restore }`. */
export function fakeClock(start = T0): { at: (ms: number) => void; restore: () => void } {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(start);
  return { at: (ms) => vi.setSystemTime(ms), restore: () => vi.useRealTimers() };
}
