/**
 * Shared test support for the file-handler tests: a scriptable `fetch` for the
 * digest / raw / write-binary routes and a `HandlerClaim` factory.
 * See change: add-editor-pane-file-handlers.
 */
import { vi } from "vitest";
import { sha1Hex } from "../../../../lib/util/sha1.js";
import type { HandlerClaim } from "../file-handler-logic.js";

export const enc = (s: string): ArrayBuffer => {
  const u = new TextEncoder().encode(s);
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
};

export interface Script {
  /** Digest response per call (path ignored). */
  digest: (n: number, url: URL) => { status?: number; size: number; sha1?: string; mtime?: number };
  raw: (n: number, url: URL) => ArrayBuffer;
  write: (n: number, url: URL, init: RequestInit) => { status: number; body: unknown };
}

export interface FetchLog {
  urls: URL[];
  count: (pathname: string) => number;
  writes: URL[];
}

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** Install a scripted `globalThis.fetch`; any other route answers an empty success envelope. */
export function installFetch(partial: Partial<Script> = {}): FetchLog {
  const bytes = enc("hello");
  const script: Script = {
    digest: () => ({ size: bytes.byteLength, sha1: sha1Hex(bytes), mtime: 1 }),
    raw: () => bytes,
    write: () => ({ status: 200, body: { success: true, data: { mtime: 2, sha1: "f".repeat(40), path: "report.docx" } } }),
    ...partial,
  };
  const log: FetchLog = { urls: [], writes: [], count: (p) => log.urls.filter((u) => u.pathname === p).length };
  const n = { digest: 0, raw: 0, write: 0 };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    log.urls.push(url);
    if (url.pathname === "/api/file/digest") {
      const d = script.digest(++n.digest, url);
      return d.sha1 === undefined && d.status
        ? json(d.status, { success: false })
        : json(d.status ?? 200, { success: true, data: { size: d.size, mtime: d.mtime ?? 1, sha1: d.sha1 } });
    }
    if (url.pathname === "/api/file/raw") {
      const b = script.raw(++n.raw, url);
      return { ok: true, status: 200, arrayBuffer: async () => b };
    }
    if (url.pathname === "/api/file/write-binary") {
      log.writes.push(url);
      const w = script.write(++n.write, url, init ?? {});
      return json(w.status, w.body);
    }
    return json(200, { success: true, data: { entries: [] } });
  }) as unknown as typeof fetch;
  return log;
}

export const makeClaim = (over: Partial<HandlerClaim> = {}): HandlerClaim => ({
  pluginId: "demo",
  claimId: "word",
  ref: "demo/word",
  label: "Edit in Word",
  mode: "edit",
  extensions: [".docx"],
  priority: 1000,
  keepAlive: true,
  keepAliveMax: undefined,
  maxBytes: 1024 * 1024,
  copySuffix: "demo",
  Component: () => null,
  ...over,
});
