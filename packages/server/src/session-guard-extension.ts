/**
 * Tool-call containment guard — a host-shipped pi extension loaded by absolute
 * path via `-e` into a scoped spawn (`scope.extensions`).
 *
 * It rejects, BEFORE execution, any tool call whose path argument resolves
 * outside the allowed roots, and any call to a denied tool. `tool_call` fires
 * ahead of execution and a handler returning `{ block, reason }` vetoes the
 * call, so this is an in-process, cross-platform working-directory boundary.
 * Paired with `--no-builtin-tools` (the stronger boundary — a removed tool
 * cannot be vetoed wrongly), it is defence in depth: no shell/exec primitive
 * remains that could step around the hook.
 *
 * WHY THIS FILE SURVIVES THE HOST-CWD-POLICY ADOPTION: the host's
 * `CwdPolicyRegistry` (`spawn-process/cwd-policy.ts`) and the `scope` block
 * express only CAPABILITY tightening (which tools exist), and
 * `lib/path-containment.ts` guards the server's own HTTP routes. Neither
 * intercepts a tool call inside a spawned session, so nothing upstream
 * replaces this enforcement.
 *
 * Deliberately host-shipped and domain-free: it guards ANY scoped spawn, not
 * one plugin's.
 *
 * Config arrives through the host's namespaced extension-config channel
 * (`scope.extensionConfig.guard` → `PI_EXT_GUARD_<KEY>`; arrays are
 * JSON-encoded, which is lossless for filesystem paths):
 *   PI_EXT_GUARD_ALLOWED_ROOTS  JSON array of roots (or a single path string).
 *                               Absent ⇒ the session cwd.
 *   PI_EXT_GUARD_DENIED_TOOLS   JSON array of tool names (or one name) blocked
 *                               outright.
 * See changes: constrain-agent-tool-surface, add-plugin-spawn-scope.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { samePath } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";

/**
 * Absolute path to THIS file, for `scope.extensions` (`-e <path>`). The spawn
 * funnel adds it for a guarded spawn; the extension is host-shipped, so the
 * host — not a plugin — owns the path.
 */
export const GUARD_EXTENSION_PATH = fileURLToPath(import.meta.url);

/** Extension name the host's `extensionConfig` uses → `PI_EXT_GUARD_<KEY>`. */
export const GUARD_EXTENSION_CONFIG_NAME = "guard";

/**
 * Decode one `PI_EXT_GUARD_*` value. The host projects an array as
 * `JSON.stringify(value)` and a scalar verbatim, so accept both: a parsed JSON
 * array of strings, else the raw non-empty string as a one-element list.
 * Never throws — malformed JSON degrades to the literal string.
 */
export function decodeGuardEnvList(raw: string | undefined): string[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
      }
    } catch {
      /* fall through to the literal reading */
    }
  }
  return trimmed.length > 0 ? [trimmed] : [];
}

/** Allowed roots from env, absolutized. Empty config ⇒ the session cwd. */
function allowedRoots(): string[] {
  const roots = decodeGuardEnvList(process.env.PI_EXT_GUARD_ALLOWED_ROOTS).map((r) => path.resolve(r));
  return roots.length ? roots : [path.resolve(process.cwd())];
}

function deniedTools(): Set<string> {
  return new Set(decodeGuardEnvList(process.env.PI_EXT_GUARD_DENIED_TOOLS));
}

function toolNameOf(event: unknown): string {
  const e = event as Record<string, unknown> | null;
  return (
    (e?.toolName as string) ??
    (e?.name as string) ??
    (e?.tool as string) ??
    ((e?.toolCall as Record<string, unknown> | undefined)?.name as string) ??
    ""
  );
}

function inputOf(event: unknown): unknown {
  const e = event as Record<string, unknown> | null;
  return e?.input ?? (e?.toolCall as Record<string, unknown> | undefined)?.input ?? {};
}

/**
 * Collect candidate path strings from an arbitrary tool-call input: any string
 * that looks like a path (absolute, or containing a separator). Recurses arrays
 * and objects, so a path nested in a structured argument is still checked.
 */
export function collectPathCandidates(input: unknown, out: string[] = []): string[] {
  if (typeof input === "string") {
    if (path.isAbsolute(input) || input.includes("/") || input.includes("\\")) out.push(input);
  } else if (Array.isArray(input)) {
    for (const v of input) collectPathCandidates(v, out);
  } else if (input && typeof input === "object") {
    for (const v of Object.values(input as Record<string, unknown>)) collectPathCandidates(v, out);
  }
  return out;
}

/**
 * True when `candidate` (resolved against `cwd`, then realpath'd when it exists)
 * is one of `roots` or nested under one. Separator/drive-case normalized so it
 * holds on Windows — mirrors the file-read-containment compare.
 */
export function pathWithinRoots(candidate: string, roots: string[], cwd: string): boolean {
  const abs = path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate);
  let real = path.resolve(abs);
  try {
    real = fs.realpathSync(abs);
  } catch {
    /* path may not exist yet — fall back to the resolved (non-real) path */
  }
  return roots.some((root) => {
    const r = path.resolve(root);
    // Walk `real` up to the filesystem root; a match at any level means `real`
    // is `r` or nested under it. `samePath` handles win32/darwin case-folding.
    let cur = real;
    for (;;) {
      if (samePath(cur, r)) return true;
      const parent = path.dirname(cur);
      if (parent === cur) return false;
      cur = parent;
    }
  });
}

export default function sessionGuardExtension(pi: ExtensionAPI): void {
  const roots = allowedRoots();
  const denied = deniedTools();
  const cwd = path.resolve(process.cwd());

  pi.on("tool_call", async (event: unknown) => {
    const name = toolNameOf(event);
    if (denied.has(name)) {
      return { block: true, reason: `Tool "${name}" is not permitted in this session.` };
    }
    for (const cand of collectPathCandidates(inputOf(event))) {
      if (!pathWithinRoots(cand, roots, cwd)) {
        return { block: true, reason: `path outside working directory: ${cand}` };
      }
    }
    return undefined;
  });
}
