/**
 * Lazy server-side resolution of a file mention against the real filesystem.
 *
 * The client tokenizer detects mentions (cheap, synchronous, offline-safe) but
 * has no filesystem; resolution moves here, on the server, performed on click.
 *
 * Security posture (design D2/D7):
 *  - `cwd` is untrusted request input — the ENDPOINT gates it against the
 *    known-session set BEFORE calling this resolver. This function assumes the
 *    caller already trusts `cwd`.
 *  - Containment (`isAllowed`) runs BEFORE any `fs.stat`, anchored on
 *    `cwd` + a FIXED, server-derived `<os.homedir()>/.pi` allowlist. git-common
 *    -root widening is supplied by `isAllowed`'s layer ② (symlink-safe realpath),
 *    so a plain (logical) git-root anchor is deliberately NOT added here.
 *  - `os.homedir()` is read at CALL time (not module load) so a test can fake
 *    `$HOME`; the `~/.pi` anchor can never be widened by request input.
 *
 * A leading `~/` expands to the home directory; `~user/` is NOT expanded. A
 * mention that does not resolve to an existing in-scope path returns null
 * (never an error).
 *
 * See change: server-side-file-mention-resolution, spec `tool-output-linkification`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAllowed } from "./path-containment.js";

export type MentionKind = "abs" | "tilde" | "relative";

export interface ResolvedMention {
  resolved: string;
  kind: MentionKind;
}

/** Server-derived `~/.pi` containment anchor. Read at call time (fake-HOME safe). */
function homePiAnchor(): string {
  return path.join(os.homedir(), ".pi");
}

/**
 * Resolve `mention` to an existing in-scope absolute path, or null.
 *
 * Candidate + kind:
 *   - leading `~/`         → `<homedir>/…`      kind `tilde`
 *   - absolute             → verbatim           kind `abs`
 *   - otherwise            → `resolve(cwd, …)`   kind `relative`
 * The candidate is normalized (`..` collapsed) BEFORE containment, so a tilde
 * traversal (`~/../../etc/passwd`) is rejected by the gate, not statted.
 */
export async function resolveFileMention(
  mention: string,
  { cwd }: { cwd: string },
): Promise<ResolvedMention | null> {
  if (!mention) return null;

  let candidate: string;
  let kind: MentionKind;
  if (mention.startsWith("~/")) {
    candidate = path.join(os.homedir(), mention.slice(2));
    kind = "tilde";
  } else if (path.isAbsolute(mention)) {
    candidate = mention;
    kind = "abs";
  } else {
    // A bare `~user/…` reaches here (not `~/`) and is joined to cwd verbatim —
    // it is NEVER expanded to another user's home.
    candidate = path.resolve(cwd, mention);
    kind = "relative";
  }
  // Normalize so `..` segments are collapsed before the containment gate.
  candidate = path.resolve(candidate);

  // Containment BEFORE stat (design D2). Anchors: cwd + fixed `~/.pi`; git-root
  // widening comes from isAllowed's layer ②.
  if (!(await isAllowed(candidate, { anchors: [cwd, homePiAnchor()] }))) {
    return null;
  }
  try {
    await fs.stat(candidate);
  } catch {
    return null;
  }
  return { resolved: candidate, kind };
}
