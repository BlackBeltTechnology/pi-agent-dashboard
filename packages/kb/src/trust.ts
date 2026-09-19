// TOFU trust store for remote KB sources (design §6b, mirrors
// `packages/server/src/worktree-init-trust.ts`). Filesystem sources skip trust;
// npm/git/https require confirmation on first fetch. Keyed by
// `sha256(canonical(SourceSpec))` so editing the spec re-prompts.
// Persisted at `~/.pi/dashboard/kb-source-trust.json`.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { SourceConfig } from "./config.js";

function storePath(): string {
  return process.env.KB_SOURCE_TRUST_PATH ?? join(homedir(), ".pi", "dashboard", "kb-source-trust.json");
}

/** Canonical string for a source spec → stable hash key. */
export function canonicalSource(s: SourceConfig): string {
  const k = s.kind ?? "filesystem";
  return `${k}\u0000${s.ref}\u0000${s.subdir ?? ""}\u0000${s.pin ?? ""}`;
}

export function sourceHash(s: SourceConfig): string {
  return createHash("sha256").update(canonicalSource(s)).digest("hex");
}

/**
 * Human-readable source reference recorded beside the hash so an entry can be
 * displayed. The hash stays the key; this value is never consulted by
 * `isTrusted`. See change: add-access-grants-and-review (task 6.3).
 */
export function sourceSubject(s: SourceConfig): string {
  const k = s.kind ?? "filesystem";
  return `${k}:${s.ref}${s.subdir ? `/${s.subdir}` : ""}${s.pin ? `@${s.pin}` : ""}`;
}

/**
 * A store entry. Legacy entries — written before the subject field existed —
 * are the bare literal `true`; entries written now carry `{ subject }`. Both
 * shapes are trusted. See change: add-access-grants-and-review (task 6.3).
 */
type TrustEntry = true | { subject?: string };
type TrustMap = Record<string, TrustEntry>;

/** A recognised entry shape — legacy `true` or a subject-bearing object. */
function isEntry(v: TrustEntry | undefined): boolean {
  return v === true || (typeof v === "object" && v !== null && !Array.isArray(v));
}

function load(): TrustMap {
  try {
    const raw = readFileSync(storePath(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as TrustMap;
  } catch { /* missing/malformed → empty */ }
  return {};
}

function save(map: TrustMap): void {
  const p = storePath();
  try {
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, JSON.stringify(map, null, 2), "utf8");
  } catch (err) {
    console.warn(`[kb-source-trust] failed to persist: ${(err as Error)?.message}`);
  }
}

export function isTrusted(s: SourceConfig): boolean {
  return isEntry(load()[sourceHash(s)]);
}

export function recordTrust(s: SourceConfig): void {
  const map = load();
  map[sourceHash(s)] = { subject: sourceSubject(s) };
  save(map);
}

/**
 * Remove the trust entry for this source. Idempotent; revoking a source that is
 * not recorded does not touch the store. See change: add-access-grants-and-review
 * (task 6.2).
 */
export function revokeTrust(s: SourceConfig): void {
  const hash = sourceHash(s);
  const map = load();
  if (Object.prototype.hasOwnProperty.call(map, hash)) {
    delete map[hash];
    save(map);
  }
}

/**
 * Revoke by the store's own key — the hash the Access surface displays.
 *
 * The tab lists `{hash, subject}` and cannot reconstruct the original
 * `SourceConfig`, so a hash-keyed revoke is the natural operation for the
 * review path. Same store, same write path, same idempotence as `revokeTrust`.
 * See change: add-access-grants-and-review (tasks 6.2, 7.5).
 */
export function revokeTrustByHash(hash: string): boolean {
  const map = load();
  if (!Object.prototype.hasOwnProperty.call(map, hash)) return false;
  delete map[hash];
  save(map);
  return true;
}

/**
 * Displayable view of the store. `subject` is the recorded source reference for
 * entries written now, or `null` for a legacy hash-only entry (the Access page
 * renders it as its opaque hash). Read-only — never writes. See change:
 * add-access-grants-and-review (tasks 6.3, 6.4).
 */
export function listTrustedSources(): Array<{ hash: string; subject: string | null }> {
  const out: Array<{ hash: string; subject: string | null }> = [];
  for (const [hash, entry] of Object.entries(load())) {
    if (!isEntry(entry)) continue;
    out.push({ hash, subject: entry === true ? null : (entry.subject ?? null) });
  }
  return out;
}

/** Default CLI prompt: reads y/N from stdin. Returns true only on explicit yes. */
export async function defaultPromptTrust(s: SourceConfig): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`KB wants to fetch remote source ${s.kind}:${s.ref}${s.pin ? `@${s.pin}` : ""}. Allow? [y/N] `, (ans) => {
      rl.close();
      resolve(/^y/i.test(ans.trim()));
    });
  });
}
