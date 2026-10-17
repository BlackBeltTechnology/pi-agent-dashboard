/**
 * Live-session-cwd gate + memoized `MermaidSourceInfo` builder for file surfaces.
 *
 * `md-read` and `write` 403 any cwd that is not a live session's cwd, so a
 * surface only offers "Apply fix to file" when its cwd is one. The set of live
 * cwds is provided once by App (`LiveSessionCwdsProvider`); outside it (tests,
 * embeds) no cwd is live → no action.
 *
 * See change: add-preview-apply-fix-to-file (design D1).
 */
import type React from "react";
import { createContext, useContext, useMemo } from "react";
import type { MermaidFileKind, MermaidSourceInfo } from "./mermaid-source-context.js";

const EMPTY: ReadonlySet<string> = new Set();
const LiveSessionCwdsContext = createContext<ReadonlySet<string>>(EMPTY);

const SEP = "\u0000";

/** `cwdKey` = the live cwds joined by NUL (a primitive, so re-renders with an unchanged set keep the Set identity). */
export function LiveSessionCwdsProvider({ cwdKey, children }: { cwdKey: string; children: React.ReactNode }) {
  const set = useMemo<ReadonlySet<string>>(() => new Set(cwdKey ? cwdKey.split(SEP) : []), [cwdKey]);
  return <LiveSessionCwdsContext.Provider value={set}>{children}</LiveSessionCwdsContext.Provider>;
}

/** Stable key for `LiveSessionCwdsProvider` from a list of session cwds. */
export function liveCwdKey(cwds: Iterable<string>): string {
  return [...new Set(cwds)].sort().join(SEP);
}

function useIsLiveSessionCwd(cwd: string): boolean {
  return useContext(LiveSessionCwdsContext).has(cwd);
}

interface Args {
  cwd: string;
  path: string;
  kind: MermaidFileKind;
  reload: () => void;
  isDirty?: boolean;
  expectedCount?: number;
}

/** Memoized source identity, or `null` when `cwd` is not a live session cwd. */
export function useMermaidSource({ cwd, path, kind, reload, isDirty, expectedCount }: Args): MermaidSourceInfo | null {
  const live = useIsLiveSessionCwd(cwd);
  return useMemo(
    () => (live ? { cwd, path, kind, reload, isDirty, expectedCount } : null),
    [live, cwd, path, kind, reload, isDirty, expectedCount],
  );
}
