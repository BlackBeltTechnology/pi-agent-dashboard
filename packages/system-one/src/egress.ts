/**
 * Egress classification by destination (design D6). An `http` backend is
 * on-machine only when its URL host is loopback: `localhost`, `127.0.0.0/8`,
 * or `[::1]`. Anything else — including `localhost.` and IPv4-mapped IPv6 —
 * is off-machine. `managed` resolves to loopback. `llm` asks the caller.
 * See change: add-system-one-registry.
 */
import type { Backend, LlmCaller } from "./types.js";

const V4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "[::1]") return true;
  const m = V4_LOOPBACK.exec(h);
  return !!m && m.slice(1).every((o) => Number(o) <= 255);
}

/** Parse an http backend URL; `null` for an unparseable or non-http(s) URL. */
export function parseBackendUrl(url: string): URL | null {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * `true` when calling this backend may send data off this machine. An `llm`
 * backend is on-machine only when `isLocal(role)` returns exactly `true`; a
 * throwing or missing caller counts as off-machine.
 */
export function isOffMachine(b: Backend, llm?: LlmCaller): boolean {
  if (b.kind === "managed") return false;
  if (b.kind === "http") {
    const u = parseBackendUrl(b.url);
    return !u || !isLoopbackHost(u.hostname);
  }
  if (!llm) return true;
  try {
    return llm.isLocal(b.role) !== true;
  } catch {
    return true;
  }
}
