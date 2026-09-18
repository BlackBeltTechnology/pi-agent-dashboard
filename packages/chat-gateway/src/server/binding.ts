/**
 * chat-gateway cwd resolution + the single spawn boundary.
 *
 * Every cwd a session may be started in — whatever its source — passes through
 * `isWithinAllowedRoots`. Paths are symlink-resolved with `fs.realpathSync.native`
 * so neither `..` traversal nor a symlink can escape `allowedRoots`. Fail CLOSED:
 * an empty `allowedRoots` refuses every candidate, and a refusal always carries a
 * specific reason.
 *
 * See change: add-chat-gateway.
 */

import fs from "node:fs";
import path from "node:path";

import type { BindingSource } from "../shared/types.js";

export interface ResolveCwdInput {
  /** A binding already persisted for this identity, if any. */
  persisted?: { cwd: string };
  fixedMap: Record<string, string>;
  /** Canonical binding key, see bindingKey(). */
  channelKey: string;
  defaultCwd?: string;
  allowedRoots: string[];
}

export type ResolveOutcome =
  | { kind: "resolved"; cwd: string; source: BindingSource }
  | { kind: "refused"; reason: string };

/**
 * Real path of `p`, symlink-resolved. A not-yet-created spawn target must still
 * be checkable, so a missing path resolves its nearest EXISTING ancestor and
 * re-appends the remainder — otherwise `<symlink>/not-created` would fall back
 * to its lexical (unescaped) form and defeat the symlink check.
 */
function realOrResolved(p: string): string {
  let abs = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(abs), ...rest);
    } catch {
      const parent = path.dirname(abs);
      if (parent === abs) return path.resolve(p); // reached the root, nothing exists
      rest.unshift(path.basename(abs));
      abs = parent;
    }
  }
}

/** Path-segment-aware containment: `/repos/proj-2` is NOT inside `/repos/proj`. */
function contains(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return candidate.startsWith(prefix);
}

export function isWithinAllowedRoots(candidateCwd: string, allowedRoots: string[]): boolean {
  // Fail closed: no roots configured -> nothing is spawnable.
  if (!allowedRoots || allowedRoots.length === 0) return false;
  if (!candidateCwd) return false;
  const candidate = realOrResolved(candidateCwd);
  return allowedRoots.some((root) => root && contains(realOrResolved(root), candidate));
}

/**
 * Precedence: persisted > fixedMap > defaultCwd > refused(no_binding_source).
 *
 * A candidate that fails the boundary is REFUSED — never silently skipped to
 * the next source, which would let a bad persisted binding fall through to a
 * wider one.
 */
export function resolveCwd(input: ResolveCwdInput): ResolveOutcome {
  const candidates: Array<{ cwd: string; source: BindingSource; reason: string }> = [];
  if (input.persisted?.cwd) {
    candidates.push({
      cwd: input.persisted.cwd,
      source: "persisted",
      reason: "persisted_outside_allowed_roots",
    });
  }
  const fixed = input.fixedMap?.[input.channelKey];
  if (fixed) {
    candidates.push({ cwd: fixed, source: "fixed-map", reason: "fixed_map_outside_allowed_roots" });
  }
  if (input.defaultCwd) {
    candidates.push({
      cwd: input.defaultCwd,
      source: "default",
      reason: "default_cwd_outside_allowed_roots",
    });
  }

  const first = candidates[0];
  if (!first) return { kind: "refused", reason: "no_binding_source" };
  if (!isWithinAllowedRoots(first.cwd, input.allowedRoots)) {
    return { kind: "refused", reason: first.reason };
  }
  return { kind: "resolved", cwd: first.cwd, source: first.source };
}

/** Gate a candidate produced by attach-or-spawn. */
export function resolveInteractiveCwd(args: {
  candidateCwd: string;
  allowedRoots: string[];
}): ResolveOutcome {
  if (!isWithinAllowedRoots(args.candidateCwd, args.allowedRoots)) {
    return { kind: "refused", reason: "outside_allowed_roots" };
  }
  return { kind: "resolved", cwd: args.candidateCwd, source: "attach" };
}
