/**
 * Host cwd-keyed capability-policy registry (Part B — `host-cwd-policy`, #475).
 *
 * The dashboard host lets a first-party plugin (or, later, an operator config)
 * pin a TIGHTENING capability floor to a directory subtree: any pi session
 * spawned with a cwd inside that subtree — plugin-originated OR generic
 * user/degrade/reload spawns — has the floor merged into its argv/env at the
 * single `spawnPiSession` funnel, BEFORE argv/env are built.
 *
 * Security invariants (design B2–B7):
 *  - **Tighten-only.** `mergeCwdPolicy` can only narrow a caller's tool/skill
 *    surface: allowlists INTERSECT, denylists UNION, `no*` booleans sticky-OR.
 *    It never composes `extensions`/`extensionConfig` (those are widenings /
 *    order-dependent — deferred to the ops-config source).
 *  - **Plugin path cannot inject code.** The plugin-facing `registerCwdPolicy`
 *    REJECTS (observable throw, registers nothing) a policy carrying
 *    `extensions`/`extensionConfig`.
 *  - **Bounded blast radius.** Registration targets are rejected when they are
 *    the filesystem root, the user home, or outside a recognized workspace root
 *    (B7), so a forged low-priority plugin cannot strip tools from every
 *    session.
 *  - **Compose, never overwrite.** Entries are keyed by `(pluginId,
 *    canonicalCwd)` but STORED as a list; `resolveCwdPolicy` composes EVERY
 *    ancestor-or-equal entry across all plugins, so a narrow looser
 *    registration cannot weaken a broad ban (B4/B5).
 *  - **Symlink-robust, fail-toward-applying.** Register + resolve both
 *    canonicalize the longest existing ancestor via `realpathSync` + lexical
 *    tail; resolve matches on EITHER the canonical OR the lexical form so a
 *    symlink swap over-applies (safe) rather than failing open (B6).
 *
 * Accepted limitations: filesystem TOCTOU is inherent (the canonical-OR-lexical
 * match narrows but does not close the window); allowlist intersection is
 * literal-token (pi owns the tool taxonomy).
 *
 * See OpenSpec change: add-plugin-spawn-scope (Part B).
 */
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { caseInsensitiveFilesystem, isFilesystemRoot } from "@blackbelt-technology/pi-dashboard-shared/platform/paths.js";
import { within } from "../lib/path-containment.js";

/**
 * The tightening-only capability fields a cwd policy may carry. A strict subset
 * of the scope fields on `SessionOptions`/`SessionFlags`. `extensions` /
 * `extensionConfig` are DELIBERATELY absent — they are widenings the plugin
 * path rejects and `mergeCwdPolicy` does not compose (design B2/B3).
 */
export interface CwdPolicy {
  tools?: string[];
  excludeTools?: string[];
  noBuiltinTools?: boolean;
  noTools?: boolean;
  skills?: string[];
  noSkills?: boolean;
}

/** Capability fields `mergeCwdPolicy` reads/writes on a spawn's options. */
export interface CwdCapabilityFields {
  tools?: string[];
  excludeTools?: string[];
  noBuiltinTools?: boolean;
  noTools?: boolean;
  skills?: string[];
  noSkills?: boolean;
}

const POLICY_KEYS = [
  "tools",
  "excludeTools",
  "noBuiltinTools",
  "noTools",
  "skills",
  "noSkills",
] as const;

/** True when the policy has no tightening field set (identity for merge). */
function isEmptyPolicy(policy: CwdPolicy): boolean {
  for (const k of POLICY_KEYS) {
    const v = policy[k];
    if (Array.isArray(v) ? v.length > 0 : v) return false;
  }
  return true;
}

/**
 * Intersect two allowlists. An ABSENT side means "no constraint from that side"
 * (the universe), so `intersect(policy, undefined) === policy` and vice-versa —
 * a host restriction with an absent caller allowlist TAKES EFFECT (it is NOT
 * "caller unrestricted"). Result order follows the caller (`b`) then the policy
 * so the emitted `--tools a,b` is deterministic. Commutative on the resulting
 * SET; associative. See design B2.
 */
function intersectAllow(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const aSet = new Set(a);
  return b.filter((x) => aSet.has(x));
}

/** Union two denylists (deduped, order = a-then-new-from-b). Commutative on set; associative. */
function unionDeny(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const out = [...a];
  const seen = new Set(a);
  for (const x of b) if (!seen.has(x)) out.push(x);
  return out;
}

/**
 * Compose a tightening `policy` into `options`, non-weakeningly. Pure; returns
 * `options` UNCHANGED (same reference) when the policy is empty/absent so the
 * "no matching policy ⇒ byte-identical" guarantee holds. Every operator is
 * commutative + associative, so folding 3+ ancestor policies is
 * order-independent (design B2).
 *
 * Composition:
 *  - `tools` / `skills` → INTERSECTION (absent side = universe)
 *  - `excludeTools`     → UNION
 *  - `noBuiltinTools` / `noTools` / `noSkills` → sticky-OR (true wins)
 *
 * `extensions` / `extensionConfig` are never touched.
 */
export function mergeCwdPolicy<T extends CwdCapabilityFields>(policy: CwdPolicy, options: T): T {
  if (isEmptyPolicy(policy)) return options;
  const merged: T = { ...options };

  const tools = intersectAllow(policy.tools, options.tools);
  if (tools !== undefined) merged.tools = tools;
  const skills = intersectAllow(policy.skills, options.skills);
  if (skills !== undefined) merged.skills = skills;

  const excludeTools = unionDeny(policy.excludeTools, options.excludeTools);
  if (excludeTools !== undefined) merged.excludeTools = excludeTools;

  if (policy.noBuiltinTools || options.noBuiltinTools) merged.noBuiltinTools = true;
  if (policy.noTools || options.noTools) merged.noTools = true;
  if (policy.noSkills || options.noSkills) merged.noSkills = true;

  return merged;
}

/** Deep-freeze a policy so post-register mutation of the passed object is inert. */
function freezePolicy(policy: CwdPolicy): CwdPolicy {
  const copy: CwdPolicy = {
    tools: policy.tools ? Object.freeze([...policy.tools]) as string[] : undefined,
    excludeTools: policy.excludeTools ? Object.freeze([...policy.excludeTools]) as string[] : undefined,
    noBuiltinTools: policy.noBuiltinTools,
    noTools: policy.noTools,
    skills: policy.skills ? Object.freeze([...policy.skills]) as string[] : undefined,
    noSkills: policy.noSkills,
  };
  return Object.freeze(copy);
}

/** Error thrown when a plugin registration is rejected (observable, not silent). */
export class CwdPolicyRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CwdPolicyRejectedError";
  }
}

interface RegistryEntry {
  pluginId: string;
  /** realpath(longest existing ancestor) + lexical trailing segments. */
  canonicalKey: string;
  /** `path.resolve(cwd)` (case-folded on a case-insensitive fs). */
  lexicalKey: string;
  policy: CwdPolicy;
}

export interface CwdPolicyRegistryOptions {
  /** Test seam for `realpathSync`. */
  realpath?: (p: string) => string;
  /** Force case-insensitivity (defaults to darwin/win32 detection). */
  caseInsensitive?: boolean;
  /**
   * Recognized workspace/project roots a plugin registration target must sit
   * within (B7). A target that is not within one of these — or that is the
   * filesystem root or the user home — is rejected. Evaluated lazily so a
   * freshly pinned directory is honored without a registry rebuild.
   */
  recognizedRoots?: () => readonly string[];
  /** Test seam for the user home dir. */
  homedir?: () => string;
}

/**
 * Registry of cwd-keyed capability policies. A SINGLE instance is wired into
 * both the spawn funnel (`spawnPiSession`) and every plugin
 * `ServerPluginContext`, so no path observes a divergent registry (design B5).
 */
export class CwdPolicyRegistry {
  private entries: RegistryEntry[] = [];
  private readonly realpath: (p: string) => string;
  private readonly caseInsensitive: boolean;
  private readonly recognizedRoots: () => readonly string[];
  private readonly homedir: () => string;

  constructor(opts: CwdPolicyRegistryOptions = {}) {
    this.realpath = opts.realpath ?? realpathSync;
    this.caseInsensitive = opts.caseInsensitive ?? caseInsensitiveFilesystem();
    this.recognizedRoots = opts.recognizedRoots ?? (() => []);
    this.homedir = opts.homedir ?? os.homedir;
  }

  /** Case-fold on a case-insensitive filesystem so keys/matches align. */
  private fold(p: string): string {
    return this.caseInsensitive ? p.toLowerCase() : p;
  }

  /**
   * Canonicalize `cwd`: realpath the longest EXISTING ancestor, then re-append
   * the not-yet-existing trailing segments lexically. So a policy for a
   * not-yet-created dir under a symlinked ancestor keys to the same canonical
   * prefix the spawn will later resolve to (design B6). Never throws.
   */
  private canonicalize(cwd: string): string {
    const resolved = path.resolve(cwd);
    let existing = resolved;
    const tail: string[] = [];
    // Walk up until realpath succeeds (or we hit the fs root).
    for (;;) {
      try {
        const real = this.realpath(existing);
        return this.fold(tail.length ? path.join(real, ...tail) : real);
      } catch {
        const parent = path.dirname(existing);
        if (parent === existing) {
          // Reached the root without a successful realpath — fall back lexical.
          return this.fold(resolved);
        }
        tail.unshift(path.basename(existing));
        existing = parent;
      }
    }
  }

  private lexical(cwd: string): string {
    return this.fold(path.resolve(cwd));
  }

  /**
   * Reject targets that would give a policy an unbounded blast radius (B7):
   * the filesystem root, the user home, or anything outside a recognized
   * workspace root. Throws {@link CwdPolicyRejectedError}.
   */
  private assertTargetAllowed(cwd: string): void {
    const resolved = path.resolve(cwd);
    if (isFilesystemRoot(resolved)) {
      throw new CwdPolicyRejectedError(`cwd policy target may not be the filesystem root: ${resolved}`);
    }
    const home = path.resolve(this.homedir());
    if (this.fold(resolved) === this.fold(home)) {
      throw new CwdPolicyRejectedError(`cwd policy target may not be the user home: ${resolved}`);
    }
    // Registration requires CANONICAL containment only. The lexical fallback
    // is deliberately NOT used here: it would admit an external target reached
    // through a workspace symlink (e.g. `/workspace/link/child` where `link` ->
    // `/external`), letting a plugin pin a policy onto an unrelated canonical
    // subtree. Canonical-OR-lexical matching stays in `resolve()` alone, where
    // over-applying is the safe (fail-toward-applying) direction (B6/B7).
    const roots = this.recognizedRoots();
    const canonicalTarget = this.canonicalize(cwd);
    const inWorkspaceRoot = roots.some((root) => prefixMatch(canonicalTarget, this.canonicalize(root)));
    if (!inWorkspaceRoot) {
      throw new CwdPolicyRejectedError(
        `cwd policy target is not within a recognized workspace root: ${resolved}`,
      );
    }
  }

  /**
   * Register a plugin-facing TIGHTENING policy for `cwd`. Rejects (throws,
   * registers nothing) when the policy carries `extensions`/`extensionConfig`
   * (B3) or the target is overly broad (B7). Stores a deep-frozen copy;
   * a second registration at the same `(pluginId, cwd)` COMPOSES (a new list
   * entry), never overwrites (B5).
   */
  register(pluginId: string, cwd: string, policy: unknown): void {
    if (!isRecord(policy)) {
      throw new CwdPolicyRejectedError("cwd policy must be an object");
    }
    if ("extensions" in policy || "extensionConfig" in policy) {
      throw new CwdPolicyRejectedError(
        "cwd policy may not carry extensions/extensionConfig — extension injection is not permitted from the plugin path (design B3)",
      );
    }
    this.assertTargetAllowed(cwd);
    const clean = sanitizePolicy(policy);
    this.entries.push({
      pluginId,
      canonicalKey: this.canonicalize(cwd),
      lexicalKey: this.lexical(cwd),
      policy: freezePolicy(clean),
    });
  }

  /**
   * Remove ONLY the calling plugin's entries for the resolved `cwd`. Idempotent
   * (no throw when nothing is registered). Another plugin's entry for the same
   * cwd is untouched (B5).
   */
  unregister(pluginId: string, cwd: string): void {
    const canonicalKey = this.canonicalize(cwd);
    this.entries = this.entries.filter(
      (e) => !(e.pluginId === pluginId && e.canonicalKey === canonicalKey),
    );
  }

  /** Drop ALL entries owned by a plugin (called on plugin unload/disable, B6). */
  dropPlugin(pluginId: string): void {
    this.entries = this.entries.filter((e) => e.pluginId !== pluginId);
  }

  /**
   * Compose EVERY registered entry that is an ancestor-of-or-equal-to the spawn
   * `cwd` — across all plugins and all matching ancestor dirs — via
   * `mergeCwdPolicy`. Matches on the canonical OR lexical form (fail-toward-
   * applying, B6). Returns `undefined` when nothing matches. Composition is
   * order-independent (every operator is commutative + associative).
   */
  resolve(cwd: string): CwdPolicy | undefined {
    const canonicalSpawn = this.canonicalize(cwd);
    const lexicalSpawn = this.lexical(cwd);
    let composed: CwdPolicy | undefined;
    for (const e of this.entries) {
      const matches =
        prefixMatch(canonicalSpawn, e.canonicalKey) || prefixMatch(lexicalSpawn, e.lexicalKey);
      if (!matches) continue;
      composed = composed === undefined ? e.policy : mergeCwdPolicy(e.policy, composed);
    }
    return composed;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Keep only valid tightening fields; drop non-string entries and NUL-bearing tokens. */
function sanitizePolicy(policy: Record<string, unknown>): CwdPolicy {
  const list = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.length > 0 && !x.includes("\0")) : undefined;
  return {
    tools: list(policy.tools),
    excludeTools: list(policy.excludeTools),
    noBuiltinTools: policy.noBuiltinTools === true ? true : undefined,
    noTools: policy.noTools === true ? true : undefined,
    skills: list(policy.skills),
    noSkills: policy.noSkills === true ? true : undefined,
  };
}

/** True when `child` equals or sits under `parent` at a path-segment boundary. */
function prefixMatch(child: string, parent: string): boolean {
  return within(child, parent);
}
