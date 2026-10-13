/**
 * Project key: the identity a grant is matched against.
 *
 * Primary: the normalised `origin` URL (repository key). Fallback: the pair
 * (device id, resolved real path of the session's cwd), matching that exact
 * directory only. Any git failure, and any `file://` / local-path origin, falls
 * back to the directory key. Path case is kept, so `Acme/App` and `acme/app`
 * do not match (fails closed).
 *
 * See change: add-credential-vault (D3).
 */

import { realpathAsync, remoteUrlOrAsync } from "./platform/git.js";
import { normalizeOrigin } from "./vault-origin.js";

// Re-exported: the pure normaliser lives in `vault-origin.ts` so the browser bundle can import it
// without pulling in the node-only git helpers above.
export { normalizeOrigin };

/** What a grant is resolved against for one session. */
export interface SessionProject {
  deviceId: string;
  /** Resolved real path of the session's own cwd. */
  dir: string;
  /** Present only when a readable, non-local origin exists. */
  repoKey?: string;
}

export interface ProjectResolveDeps {
  /** Reads `origin`. Resolves undefined on any failure. Default: `git remote get-url origin`. */
  readOrigin?: (cwd: string) => Promise<string | undefined>;
}

/**
 * Resolve a session's project from its OWN cwd. Returns undefined when the
 * directory cannot be resolved, in which case callers deliver nothing.
 */
export async function resolveSessionProject(
  input: { deviceId: string; cwd: string },
  deps: ProjectResolveDeps = {},
): Promise<SessionProject | undefined> {
  const real = await realpathAsync(input.cwd);
  if (real.kind !== "ok") return undefined;
  const readOrigin = deps.readOrigin ?? ((cwd: string) => remoteUrlOrAsync({ cwd }));
  let origin: string | undefined;
  try {
    origin = await readOrigin(real.path);
  } catch {
    origin = undefined;
  }
  const repoKey = origin ? normalizeOrigin(origin) : undefined;
  return { deviceId: input.deviceId, dir: real.path, repoKey };
}
