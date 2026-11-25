import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IsolatedServer } from "./isolated-server.js";

/**
 * REST-level helpers for tier-5 / pool / reserve-path specs (rows X30, P11, F13-F17, X26). Everything here talks to the
 * isolated dashboard over HTTP as a named principal — no browser. See change: serve-live-previews-on-capability-origin.
 */

/** The first non-internal IPv4 address of this machine (a Host the dashboard bound to `0.0.0.0` can answer), or undefined. */
export function lanIPv4(): string | undefined {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) if (a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254.")) return a.address;
  }
  return undefined;
}

/** Register `127.0.0.1:<port>` as a live-server port target (as the viewer's "add target" does). Returns the target id. */
export async function registerTarget(server: IsolatedServer, port: number, label = "lp"): Promise<string> {
  const r = await server.api("POST", "/api/live-server/start", { host: "127.0.0.1", port, label });
  if (r.status !== 200 || !r.json?.data?.id) throw new Error(`start target failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.data.id as string;
}

export interface PairedDevice {
  id: string;
  token: string;
}

/** Pair a device (`control` tier) through the operator REST API; its bearer is a distinct capability principal. */
export async function pairDevice(server: IsolatedServer, label = "lp-device", tier: "observe" | "control" | "operate" = "control"): Promise<PairedDevice> {
  const r = await server.api("POST", "/api/paired-devices", { label, tier });
  if (r.status !== 200 || !r.json?.data?.token) throw new Error(`pair device failed: ${r.status} ${JSON.stringify(r.json)}`);
  return { id: r.json.data.device.id as string, token: r.json.data.token as string };
}

/** Revoke a paired device (the "second holder revoked via API" of D8). */
export async function revokeDevice(server: IsolatedServer, id: string): Promise<void> {
  const r = await server.api("DELETE", `/api/paired-devices/${id}`);
  if (r.status !== 200) throw new Error(`revoke device failed: ${r.status} ${JSON.stringify(r.json)}`);
}

/** REST call authenticated with a device bearer (dials the loopback literal). */
// biome-ignore lint/suspicious/noExplicitAny: REST bodies are untyped JSON; specs narrow as needed
export async function bearerApi(server: IsolatedServer, token: string, method: string, apiPath: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${server.url}${apiPath}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: text };
  }
}

/** Mint a tier-5 capability (`accept: ["preview"]` only → tier 5 for a port target); returns its `/preview/<pid>/` path. */
export async function mintTier5Path(server: IsolatedServer, targetId: string): Promise<string> {
  const r = await server.api("POST", `/api/live-server/${targetId}/capability`, { accept: ["preview"] });
  if (r.json?.tier !== 5) throw new Error(`expected a tier-5 mint, got ${r.status} ${JSON.stringify(r.json)}`);
  return r.json.path as string;
}

/** The operator's `pi_dash_local` cookie as a `Cookie` header value (redeemed from a fresh one-time local-proof code). */
export async function operatorCookieHeader(server: IsolatedServer): Promise<string> {
  const code = await server.mintLocalProofCode();
  const res = await fetch(`${server.url}/auth/local-proof?code=${code}`, { redirect: "manual" });
  const set = res.headers.getSetCookie().map((c) => c.split(";")[0]);
  if (set.length === 0) throw new Error(`local-proof redeem set no cookie (${res.status})`);
  return set.join("; ");
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Shift the clock of the server's tier-5 pid store (see `clock-warp.mjs`): restart the server with `restart({ env: warp.env })`,
 * then `await warp.set(ms)` moves ONLY that store's `Date.now()` forward by `ms` (0 = real time). `restart({ reset: true })` undoes it.
 */
export function clockWarp(server: IsolatedServer): { env: Record<string, string>; set(ms: number): Promise<void> } {
  const file = path.join(server.home, "clock-offset-ms");
  fs.writeFileSync(file, "0");
  const preload = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "clock-warp.mjs")).href;
  return {
    env: { NODE_OPTIONS: `--import ${preload}`, LP_CLOCK_FILE: file },
    async set(ms) {
      fs.writeFileSync(file, String(ms));
      await sleep(200); // the preload re-reads the file every 50 ms
    },
  };
}
