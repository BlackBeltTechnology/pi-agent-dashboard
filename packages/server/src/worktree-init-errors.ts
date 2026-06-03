/**
 * Maps common init-step stderr fragments to short human hints.
 *
 * Table-driven, ordered most-specific-first. Pure function, no I/O.
 *
 * See change: generalize-worktree-init-hook.
 */

interface HintRule {
  /** Substring or regex that identifies the failure family. */
  match: RegExp;
  /** Short remediation hint shown next to the error code in the UI. */
  hint: string;
}

const RULES: HintRule[] = [
  // npm ci lockfile drift — match before generic EBADENGINE / ETARGET.
  {
    match: /can only install packages when your package\.json and package-lock\.json are in sync/i,
    hint: "lockfile drift — package.json and package-lock.json disagree; run `npm install` to refresh",
  },
  // EACCES — permission problems.
  {
    match: /\bEACCES\b/,
    hint: "permission denied — check ownership of the worktree directory",
  },
  // Engine mismatch.
  {
    match: /\b(EBADENGINE|Unsupported engine|Not compatible with your version of node)\b/i,
    hint: "node engine mismatch — install/use the version pinned in package.json#engines",
  },
  // ETARGET — version not found.
  {
    match: /\bETARGET\b|No matching version found for/i,
    hint: "package version not found in the registry — check lockfile + registry",
  },
  // Network failure family.
  {
    match: /\b(ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b/,
    hint: "registry unreachable — check network / proxy",
  },
  // pnpm missing lockfile with frozen-lockfile.
  {
    match: /ERR_PNPM_NO_LOCKFILE/,
    hint: "pnpm lockfile missing — run `pnpm install` to generate it",
  },
];

/**
 * Returns a short hint string for known failure patterns, or `null` when
 * no rule matches. Caller decides whether to fall back to a generic
 * "install failed (exit N)" surface.
 */
export function mapInitStderrToHint(stderr: string): string | null {
  if (!stderr) return null;
  for (const rule of RULES) {
    if (rule.match.test(stderr)) return rule.hint;
  }
  return null;
}
