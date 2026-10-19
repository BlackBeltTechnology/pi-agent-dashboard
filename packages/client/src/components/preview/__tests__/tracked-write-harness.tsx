/**
 * Test harness: a change-detection `SplitWorkspaceProvider` that exposes its
 * context and records `onClearChanged` calls, to prove an in-pane writer goes
 * through `trackedFileWrite`. See change: gate-changed-on-disk-by-content (#F7).
 */
import type React from "react";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";

type Ctx = ReturnType<typeof useSplitWorkspace>;

export const probe: { ctx: Ctx | null; cleared: Array<[string, number | undefined]> } = { ctx: null, cleared: [] };

function Capture() {
  probe.ctx = useSplitWorkspace();
  return null;
}

export function TrackedProvider({
  path,
  candidate,
  children,
}: {
  path: string;
  candidate?: number;
  children: React.ReactNode;
}) {
  return (
    <SplitWorkspaceProvider
      sessionId="sTracked"
      cwd="/proj"
      orientation="h"
      changeDetection
      changedFiles={candidate ? new Map([[path, candidate]]) : null}
      onClearChanged={(p, g) => probe.cleared.push([p, g])}
    >
      <Capture />
      {children}
    </SplitWorkspaceProvider>
  );
}

export const digestResponse = (sha1: string) => ({
  status: 200,
  ok: true,
  json: async () => ({ success: true, data: { size: 1, mtime: 1, sha1 } }),
});
