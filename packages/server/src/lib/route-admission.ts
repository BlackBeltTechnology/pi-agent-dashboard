/**
 * Route-boundary cwd admission for the core git / openspec routes (change:
 * core-cwd-admission, D1). One thin wrapper over the shared tri-state `admitCwd`
 * so every route admits against the SAME known set as the plugin routes and
 * answers an undecidable verdict with the SAME 503 body.
 *
 * The wrapper does NOT branch for the caller: each route (or the one helper that
 * already validates, `validateCwd` / `depGates`) branches on
 * `admissionAllows(admission, cwd)` itself so static analysis keeps the modelled
 * path-injection barrier, then releases the token in `finally`.
 */
import { type Admission, type AdmitCwdOptions, admitCwd } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";

/** Sources of the known-folder set: session cwds ∪ pinned directories ∪ workspace folders. */
export interface KnownFolderSources {
  sessionManager: { listAll(): ReadonlyArray<{ cwd?: string }> };
  preferencesStore: {
    getPinnedDirectories(): readonly string[];
    /** Optional so a minimal store (tests, a store without workspaces) contributes no workspace folders. */
    getWorkspaces?(): ReadonlyArray<{ folders: readonly string[] }>;
  };
}

/**
 * The known-folder set: every session cwd ∪ every pinned directory ∪ every
 * workspace folder, unfiltered (no `hasOpenSpecRoot` / opt-out filtering). The
 * single implementation behind `host.knownFolderCwds` (plugin routes) and the
 * core route admission. Workspace folders joined the set in
 * core-file-cwd-admission (D8): a workspace-only folder already reaches the
 * package / canvas / resources routes.
 */
export function listKnownFolderCwds(src: KnownFolderSources): string[] {
  const set = new Set<string>();
  for (const s of src.sessionManager.listAll()) if (s.cwd) set.add(s.cwd);
  for (const d of src.preferencesStore.getPinnedDirectories()) set.add(d);
  for (const w of src.preferencesStore.getWorkspaces?.() ?? []) for (const f of w.folders) if (f) set.add(f);
  return [...set];
}

export interface RouteAdmissionDeps {
  /** Live known-folder set (see {@link listKnownFolderCwds}). Fail-closed default: nothing is known. */
  knownCwds?: () => string[];
  /**
   * `admitCwd` options: the host's throttled `onIndeterminate` logger, plus the
   * test seams (`runner`, `realpath`, `deadlineMs`, token capture).
   */
  admitOptions?: AdmitCwdOptions;
}

const NONE_KNOWN = (): string[] => [];

/**
 * Admit a request `cwd` against the known set. Returns the shared `Admission`
 * unchanged: the caller maps `indeterminate` → {@link sendAdmissionUnavailable}
 * and a non-`admit` / non-`admissionAllows` verdict to its own refusal.
 */
export function admitRouteCwd(cwd: string, deps: RouteAdmissionDeps = {}): Promise<Admission> {
  return admitCwd(cwd, deps.knownCwds ?? NONE_KNOWN, deps.admitOptions);
}

/** Body of the 503 for an admission that could not be decided (design D3). */
export const CWD_ADMISSION_UNAVAILABLE_BODY = {
  success: false,
  code: "cwd-admission-unavailable",
  error: "cwd-admission-unavailable",
  message: "cwd admission could not be decided right now",
  retryAfterMs: 1000,
} as const;

/** The minimal reply surface needed to send the 503. */
interface ReplyLike {
  code(status: number): ReplyLike;
  header(name: string, value: string): ReplyLike;
}

/** Set `503` + `Retry-After: 1` on `reply` and return the shared body. */
export function sendAdmissionUnavailable(reply: ReplyLike): typeof CWD_ADMISSION_UNAVAILABLE_BODY {
  reply.code(503).header("Retry-After", "1");
  return CWD_ADMISSION_UNAVAILABLE_BODY;
}
