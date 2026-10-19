/**
 * Network half of the file-handler host: the consistent-read bracket
 * (`snapshot`) and the `write-binary` call + status mapping. Pure functions
 * over `fetch`; no React.
 *
 * See change: add-editor-pane-file-handlers (D3, D4).
 */

import { fetchWithoutGrantPrompt } from "../../../lib/access-grants/grant-channel.js";
import { getApiBase } from "../../../lib/api/api-context.js";
import { sha1Hex } from "../../../lib/util/sha1.js";
import type { TrackedWriteResult } from "../../split/SplitWorkspaceContext.js";

export type SaveFailureReason = "cancelled" | "conflict-unresolved" | "rejected" | "too-large" | "busy";

export interface SaveFailure {
  ok: false;
  reason: SaveFailureReason;
  message: string;
}
export interface SaveSuccess {
  ok: true;
  path: string;
  mtime: number;
  sha1: string;
}

/** Rejection of `snapshot()`; `reason` mirrors `save()`'s failure reasons. */
export class FileHandlerError extends Error {
  /** HTTP 404 on the digest (the file no longer exists). */
  gone = false;
  readonly reason: SaveFailureReason;
  constructor(reason: SaveFailureReason, message: string) {
    super(message);
    this.name = "FileHandlerError";
    this.reason = reason;
  }
}

export interface Digest {
  size: number;
  mtime: number;
  sha1: string;
}
export interface HandlerSnapshot {
  bytes: ArrayBuffer;
  size: number;
  mtime: number;
  sha1: string;
}

/** Snapshot retries before giving up (design D3). */
const SNAPSHOT_ATTEMPTS = 3;

const q = encodeURIComponent;

export async function fetchDigest(cwd: string, path: string): Promise<Digest> {
  const res = await fetchWithoutGrantPrompt(`${getApiBase()}/api/file/digest?cwd=${q(cwd)}&path=${q(path)}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const err = new FileHandlerError("rejected", `digest failed (${res.status})`);
    err.gone = res.status === 404;
    throw err;
  }
  const body = await res.json();
  const d = body?.data;
  if (body?.success && typeof d?.size === "number" && !d.sha1) {
    // The server omits `sha1` only above its digest ceiling, which exceeds every claim `maxBytes`.
    throw new FileHandlerError("too-large", "File exceeds the size the digest endpoint can hash");
  }
  if (!body?.success || typeof d?.size !== "number" || typeof d?.sha1 !== "string") {
    throw new FileHandlerError("rejected", "digest unavailable for this file");
  }
  return { size: d.size, mtime: typeof d.mtime === "number" ? d.mtime : 0, sha1: d.sha1 };
}

/**
 * Digest bracket (D3): `GET /api/file/digest` → `GET /api/file/raw` (no-store) →
 * digest. Accept when sha1₁ = sha1₂ and sha1(bytes) = sha1₂ (an mtime-only change
 * is not a retry); a size above `maxBytes` is refused BEFORE any content request.
 * `GET /api/file` is never used (it would inline whole `monaco`-viewer text).
 */
export async function takeSnapshot(cwd: string, path: string, maxBytes: number): Promise<HandlerSnapshot> {
  const tooLarge = () => new FileHandlerError("too-large", `File exceeds the ${maxBytes}-byte limit for this mode`);
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt++) {
    const d1 = await fetchDigest(cwd, path);
    if (d1.size > maxBytes) throw tooLarge();
    const res = await fetchWithoutGrantPrompt(`${getApiBase()}/api/file/raw?cwd=${q(cwd)}&path=${q(path)}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new FileHandlerError("rejected", `read failed (${res.status})`);
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > maxBytes) throw tooLarge();
    const d2 = await fetchDigest(cwd, path);
    if (d1.sha1 === d2.sha1 && sha1Hex(bytes) === d2.sha1) {
      return { bytes, size: bytes.byteLength, mtime: d2.mtime, sha1: d2.sha1 };
    }
  }
  throw new FileHandlerError("rejected", "The file kept changing while it was being read");
}

export interface BinaryWriteResult extends TrackedWriteResult {
  ok: boolean;
  status: number;
  // biome-ignore lint/suspicious/noExplicitAny: server envelope, shape varies by status
  body: any;
  sha1?: string;
}

export interface BinaryWriteRequest {
  cwd: string;
  path: string;
  mode: "overwrite" | "copy";
  /** `<pluginId>/<claimId>`. */
  claim: string;
  /** Required for `overwrite`. */
  expectSha1?: string;
  bytes: ArrayBuffer;
}

export async function postWriteBinary(req: BinaryWriteRequest, signal?: AbortSignal): Promise<BinaryWriteResult> {
  const sha = req.expectSha1 ? `&expectSha1=${q(req.expectSha1)}` : "";
  const url = `${getApiBase()}/api/file/write-binary?cwd=${q(req.cwd)}&path=${q(req.path)}&mode=${req.mode}&claim=${q(req.claim)}${sha}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: req.bytes,
    signal,
  });
  let body: BinaryWriteResult["body"] = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON refusal body
  }
  const ok = res.status === 200 && body?.success === true;
  const sha1 = ok && typeof body?.data?.sha1 === "string" ? body.data.sha1 : undefined;
  return { ok, status: res.status, body, sha1 };
}

export type WriteOutcome =
  | { kind: "ok"; path: string; mtime: number; sha1: string }
  | { kind: "conflict"; gone: boolean }
  | { kind: "fail"; reason: Exclude<SaveFailureReason, "cancelled" | "conflict-unresolved">; message: string };

/** Map a `write-binary` response to the host's outcome (statuses per design D4). */
export function classifyWrite(mode: "overwrite" | "copy", r: BinaryWriteResult, fallbackPath: string): WriteOutcome {
  const msg = (d: string): string => (typeof r.body?.error === "string" && r.body.error ? r.body.error : d);
  if (r.ok) {
    const d = r.body.data;
    return {
      kind: "ok",
      path: typeof d?.path === "string" ? d.path : fallbackPath,
      mtime: typeof d?.mtime === "number" ? d.mtime : 0,
      sha1: r.sha1 ?? "",
    };
  }
  // Overwrite 409 = changed/missing on disk; the missing-file variant carries no `sha1`.
  if (r.status === 409 && mode === "overwrite") return { kind: "conflict", gone: typeof r.body?.sha1 !== "string" };
  if (r.status === 413) return { kind: "fail", reason: "too-large", message: msg("File exceeds the size limit") };
  if (r.status === 503 && r.body?.retryable === true) return { kind: "fail", reason: "busy", message: msg("Server busy, try again") };
  return { kind: "fail", reason: "rejected", message: msg(`Save refused (${r.status})`) };
}
