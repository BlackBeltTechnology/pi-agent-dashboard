/**
 * Prop fetch — download a candidate to the `.deck3d/props/` cache beside the
 * deck, verify it is glTF/GLB, enforce a size cap, and pin its sha256.
 * Self-containment: a `.gltf` with any external buffer URI is rejected.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type PropCandidate, vendoredPath } from "./search.js";

export const DEFAULT_PROP_SIZE_CAP = 8 * 1024 * 1024;
export const DEFAULT_PROP_HTTP_TIMEOUT_MS = 10_000;

export class PropFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PropFetchError";
  }
}

function slug(value: string): string {
  return value.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-");
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isGlb(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

/** Validate glTF/GLB self-containment; throws `PropFetchError`. */
function assertGltf(bytes: Uint8Array): void {
  if (isGlb(bytes)) return;
  let json: { buffers?: Array<{ uri?: string }> };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes)) as typeof json;
  } catch {
    throw new PropFetchError("not a glTF/GLB");
  }
  const external = (json.buffers ?? []).map((b) => b.uri).filter((u): u is string => typeof u === "string" && !u.startsWith("data:"));
  if (external.length) throw new PropFetchError(`glTF has an external URI (self-containment): ${external[0]}`);
}

async function download(candidate: PropCandidate, timeoutMs: number): Promise<Uint8Array> {
  if (candidate.source === "vendored") return new Uint8Array(readFileSync(vendoredPath(candidate.id)));
  if (!candidate.downloadUrl) throw new PropFetchError(`no download URL for ${candidate.id}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(candidate.downloadUrl, { signal: controller.signal });
    if (!res.ok) throw new PropFetchError(`download failed (HTTP ${res.status}) for ${candidate.id}`);
    return new Uint8Array(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}

export interface FetchPropOptions {
  destDir: string;
  sizeCap?: number;
  /** Expected sha256 (from the override); a mismatch fails. */
  sha256?: string;
  timeoutMs?: number;
}

export interface FetchResult {
  path: string;
  sha256: string;
  bytes: number;
}

export async function fetchProp(candidate: PropCandidate, opts: FetchPropOptions): Promise<FetchResult> {
  const cap = opts.sizeCap ?? DEFAULT_PROP_SIZE_CAP;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.DECK3D_HTTP_TIMEOUT_MS ?? DEFAULT_PROP_HTTP_TIMEOUT_MS);
  const bytes = await download(candidate, timeoutMs);
  if (bytes.length > cap) throw new PropFetchError(`${candidate.source}-${candidate.id}: ${bytes.length} bytes > cap ${cap}`);
  assertGltf(bytes);
  const hash = sha256(bytes);
  if (opts.sha256 && opts.sha256 !== hash) throw new PropFetchError(`${candidate.source}-${candidate.id}: sha256 ${hash} ≠ pinned ${opts.sha256}`);

  const dest = join(opts.destDir, `${slug(candidate.source)}-${slug(candidate.id)}.glb`);
  if (existsSync(dest)) {
    const existing = sha256(readFileSync(dest));
    if (existing !== hash) throw new PropFetchError(`${candidate.source}-${candidate.id}: cached hash ${existing} ≠ fetched ${hash}`);
  } else {
    mkdirSync(opts.destDir, { recursive: true });
    writeFileSync(dest, bytes);
  }
  return { path: dest, sha256: hash, bytes: bytes.length };
}
