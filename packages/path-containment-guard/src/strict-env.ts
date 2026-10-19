/**
 * Fault-capturing wrapper around a `ResolveEnv`.
 *
 * The shared `canonicalizeTarget` treats every `realpathSync` failure as "path
 * missing" and walks up — right for the interactive gate, wrong for a fail-closed
 * guard: an `EACCES`/`EIO` on an ancestor would silently degrade to the lexical
 * path. This wrapper remembers the first failure that is NOT a plain "does not
 * exist" (`ENOENT`/`ENOTDIR`, or a code-less test double), so the caller can
 * reject with `error` after canonicalisation instead of trusting a guessed path.
 * See change: add-path-containment-guard-extension (D3).
 */
import type { ResolveEnv } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";

export interface FaultCapturingEnv {
  env: ResolveEnv;
  /** First non-"missing" resolver failure seen, or `undefined`. */
  fault: () => unknown;
}

function isMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code !== "string" || code === "ENOENT" || code === "ENOTDIR";
}

export function captureFaults(base: ResolveEnv): FaultCapturingEnv {
  let first: unknown;
  return {
    env: {
      ...base,
      realpathSync: (p) => {
        try {
          return base.realpathSync(p);
        } catch (err) {
          if (first === undefined && !isMissing(err)) first = err;
          throw err;
        }
      },
    },
    fault: () => first,
  };
}
