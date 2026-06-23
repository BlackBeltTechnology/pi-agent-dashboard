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

type TrustMap = Record<string, true>;

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
  return load()[sourceHash(s)] === true;
}

export function recordTrust(s: SourceConfig): void {
  const map = load();
  map[sourceHash(s)] = true;
  save(map);
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
