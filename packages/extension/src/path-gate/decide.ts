/**
 * Pure decision for the agent path gate (D2/D4/D5): given a tool call's raw path
 * and the session's roots, say whether it is in-root or must be asked about, and
 * which options the card may offer. No I/O beyond the injected resolve env.
 * See change: ask-agent-file-access-in-chat.
 */
import { canonicalizeTarget, defaultResolveEnv, type ResolveEnv, resolveToolPath } from "./resolve.js";

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
  /** Volume case sensitivity; default: win32/darwin fold, else exact. */
  caseInsensitive?: boolean;
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

function fold(s: string, ci: boolean): string {
  const nfc = s.normalize("NFC");
  return ci ? nfc.toLowerCase() : nfc;
}

/** Component-wise containment on already-canonical paths (never a string prefix). */
function isWithin(candidate: string, root: string, env: ResolveEnv, ci: boolean): boolean {
  const p = env.path;
  const c = fold(candidate, ci);
  const r = fold(root, ci);
  if (c === r) return true;
  const rel = p.relative(r, c);
  return rel !== "" && rel !== ".." && !rel.startsWith(`..${p.sep}`) && !p.isAbsolute(rel);
}

export function decidePathAccess(input: DecideInput): Decision {
  const env = input.env ?? defaultResolveEnv();
  const ci = input.caseInsensitive ?? (env.platform === "win32" || env.platform === "darwin");
  const abs = resolveToolPath(input.rawPath, input.cwd, env);
  const canonical = canonicalizeTarget(abs, env);
  const r = input.roots;
  const rooted: readonly string[][] = [
    [...r.workspace],
    [...r.readWrite],
    [...r.grants],
    ...(input.access === "read" ? [[...r.readOnly]] : []),
  ];
  for (const set of rooted) {
    if (set.some((root) => isWithin(canonical, root, env, ci))) return { verdict: "in-root", canonical };
  }
  const p = env.path;
  const suppressionKey = p.dirname(canonical);
  // A grant names the containing directory (the file's directory), never an ancestor.
  const subject = suppressionKey;
  return {
    verdict: "ask",
    canonical,
    sensitive: input.sensitiveDirs.some((d) => isWithin(canonical, d, env, ci)),
    subject,
    grantable: !input.isUngrantable(subject),
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
