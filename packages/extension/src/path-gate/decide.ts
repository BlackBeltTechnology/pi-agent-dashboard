/**
 * Pure decision for the agent path gate (D2/D4/D5): given a tool call's raw path
 * and the session's roots, say whether it is in-root or must be asked about, and
 * which options the card may offer. No I/O beyond the injected resolve env.
 *
 * Read carve-out: an agent `read` of another project's `<agentDir>/sessions/**`
 * or `<agentDir>/{models,mcp}.json[.*]` is decided BEFORE any root, so no root class
 * (read-only agent dir, workspace/checkout above it, grant) admits it; it always asks,
 * marked sensitive, never `Always allow`.
 * See change: ask-agent-file-access-in-chat; harden-agent-tool-guards (D2).
 */
import {
  PI_AGENT_ASK_READ_DIRS,
  PI_AGENT_ASK_READ_FILES,
} from "@blackbelt-technology/pi-dashboard-shared/agent-credential-files.js";
import {
  canonicalizeTarget,
  defaultResolveEnv,
  defaultVolumeProbe,
  isPathWithinRoots,
  isWithinRoot,
  type ResolveEnv,
  resolveReadTarget,
  resolveToolPath,
} from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";

export type PathAccess = "read" | "write";

export interface GateRoots {
  /** cwd + checkout root: read+write. */
  workspace: readonly string[];
  /** Built-in read-only roots (pi agent dir, skills, docs, context files). */
  readOnly: readonly string[];
  /** Built-in read+write roots (tmpdir, session dir). */
  readWrite: readonly string[];
  /** Persisted project-scope grant subjects (read+write). */
  grants: readonly string[];
  /**
   * Read carve-out inputs (independent of `readOnly`): every agent dir (`~/.pi/agent`,
   * `PI_CODING_AGENT_DIR`, pi's own) and the session's own session dir (exempt).
   * Absent → no carve-out (legacy callers/tests).
   */
  askRead?: { agentDirs: readonly string[]; ownSessionDir?: string };
}

export interface DecideInput {
  access: PathAccess;
  rawPath: string;
  cwd: string;
  roots: GateRoots;
  /** Sensitive directories (targets inside are flagged). */
  sensitiveDirs: readonly string[];
  /** Whether granting `subject` is refused (forbidden or subsumes a forbidden dir). */
  isUngrantable: (subject: string) => boolean;
  env?: ResolveEnv;
  /** Force volume case sensitivity (tests). Default: probed from the volume. */
  caseInsensitive?: boolean;
  /** Injectable volume probe (path → folds case?). Default: the shared probe on a real host. */
  volumeCaseProbe?: (existingPathOrAncestor: string) => boolean;
}

export type Decision =
  | { verdict: "in-root"; canonical: string }
  | {
      verdict: "ask";
      canonical: string;
      sensitive: boolean;
      /** Containing directory a persisted grant would name (never an ancestor). */
      subject: string;
      /** Offered "Always allow" is possible for this target (before identity/store checks). */
      grantable: boolean;
      /** Lexical parent of the canonical target (repeat-suppression key). */
      suppressionKey: string;
    };

/** `<dir>/sessions/**` of another project (the session's own session dir is exempt). */
function inOtherSessions(canonical: string, dir: string, own: string | undefined, env: ResolveEnv, ci: boolean): boolean {
  return PI_AGENT_ASK_READ_DIRS.some(
    (sub) => isWithinRoot(canonical, env.path.join(dir, sub), env, ci) && !(own && isWithinRoot(canonical, own, env, ci)),
  );
}

/** `<dir>/{models,mcp}.json` and its `<name>.*` siblings (directly in the agent dir). */
function isAskReadFile(canonical: string, dir: string, env: ResolveEnv, ci: boolean): boolean {
  const f = (s: string): string => (ci ? s.normalize("NFC").toLowerCase() : s);
  if (f(env.path.dirname(canonical)) !== f(dir)) return false;
  const base = f(env.path.basename(canonical));
  return PI_AGENT_ASK_READ_FILES.some((name) => base === f(name) || base.startsWith(`${f(name)}.`));
}

/** Is `canonical` an ask-on-read agent-dir target under the carve-out dirs (case-folded when `ci`)? */
function carveOutMatch(canonical: string, askRead: NonNullable<GateRoots["askRead"]>, env: ResolveEnv, ci: boolean): boolean {
  return askRead.agentDirs.some(
    (dir) => inOtherSessions(canonical, dir, askRead.ownSessionDir, env, ci) || isAskReadFile(canonical, dir, env, ci),
  );
}

/**
 * Carve-out test for a `read`. The case-fold probe runs only when the target lies (folded)
 * under an agent dir at all, so ordinary in-root reads never probe.
 */
function isAskOnRead(canonical: string, input: DecideInput, env: ResolveEnv): boolean {
  const askRead = input.roots.askRead;
  if (!askRead || askRead.agentDirs.length === 0) return false;
  if (!askRead.agentDirs.some((d) => isWithinRoot(canonical, d, env, true))) return false;
  if (carveOutMatch(canonical, askRead, env, false)) return true;
  const ci =
    input.caseInsensitive ?? (input.volumeCaseProbe ? input.volumeCaseProbe(canonical) : defaultVolumeProbe(canonical, env));
  return ci ? carveOutMatch(canonical, askRead, env, true) : false;
}

export function decidePathAccess(input: DecideInput): Decision {
  const env = input.env ?? defaultResolveEnv();
  const lexical = resolveToolPath(input.rawPath, input.cwd, env);
  // `read` opens pi's filename-variant fallback, not necessarily the literal name.
  const abs = input.access === "read" ? resolveReadTarget(lexical, env) : lexical;
  const canonical = canonicalizeTarget(abs, env);
  const r = input.roots;
  const carved = input.access === "read" && isAskOnRead(canonical, input, env);
  const rooted: readonly string[][] = [
    [...r.workspace],
    [...r.readWrite],
    [...r.grants],
    ...(input.access === "read" ? [[...r.readOnly]] : []),
  ];
  const inRoot = !carved && isPathWithinRoots(canonical, rooted.flat(), {
    env,
    caseInsensitive: input.caseInsensitive,
    volumeCaseProbe: input.volumeCaseProbe,
  });
  if (inRoot) return { verdict: "in-root", canonical };
  return askDecision(input, env, canonical, carved);
}

/** The `ask` verdict for a target that is not in-root (or is a carve-out target). */
function askDecision(input: DecideInput, env: ResolveEnv, canonical: string, carved: boolean): Extract<Decision, { verdict: "ask" }> {
  const p = env.path;
  const suppressionKey = p.dirname(canonical);
  // A grant names the exact directory: the target itself when it IS a directory,
  // else its containing directory — never an ancestor.
  const subject = env.isDirectory(canonical) ? canonical : suppressionKey;
  // Flagging errs toward flagging (case-folded): a false flag only adds a warning. A flagged target
  // is never grantable either, so a case-variant spelling (`~/.AWS` on a case-sensitive volume) never
  // offers `Always allow` even though the exact-case grant check would not recognise it.
  const sensitive = carved || input.sensitiveDirs.some((d) => isWithinRoot(canonical, d, env, true));
  return {
    verdict: "ask",
    canonical,
    sensitive,
    subject,
    grantable: !sensitive && !input.isUngrantable(subject),
    suppressionKey,
  };
}

export interface OfferInput {
  grantable: boolean;
  sensitive: boolean;
  /** Server announced a grant-store id equal to the local token file. */
  storeMatch: boolean;
  subject: string;
}

export interface Offer {
  options: string[];
  /** Card note explaining a withheld "Always allow", when any. */
  note?: string;
  alwaysLabel?: string;
}

export const OPT_ALLOW_ONCE = "Allow once";
export const OPT_DENY = "Deny";
const optAlways = (subject: string): string => `Always allow ${subject}…`;

/** Option set for the first prompt (D3/D4/D5). No ancestor is ever offered. */
export function buildOptions(i: OfferInput): Offer {
  const options = [OPT_ALLOW_ONCE, OPT_DENY];
  if (i.grantable && i.storeMatch) {
    const alwaysLabel = optAlways(i.subject);
    return { options: [OPT_ALLOW_ONCE, alwaysLabel, OPT_DENY], alwaysLabel };
  }
  if (i.grantable && !i.storeMatch) return { options, note: "Always allow can't be remembered here" };
  return { options, note: "Always allow isn't available for this location" };
}
