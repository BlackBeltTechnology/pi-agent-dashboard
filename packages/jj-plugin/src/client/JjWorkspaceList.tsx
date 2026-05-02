/**
 * Sidebar-folder section listing the workspaces present in a folder's
 * jj repo. Renders nothing for folders without `.jj/`; for folders with
 * jj, fetches `jj workspace list` once on mount and on demand.
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useEffect, useState } from "react";
import { listWorkspaces, type JjWorkspaceListEntry } from "./api.js";

export function JjWorkspaceList({
  cwd,
}: {
  cwd: string;
}): React.ReactElement | null {
  const [workspaces, setWorkspaces] = useState<JjWorkspaceListEntry[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listWorkspaces(cwd).then((ws) => {
      if (cancelled) return;
      setWorkspaces(ws);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  if (!loaded) return null;
  if (!workspaces || workspaces.length <= 1) return null;

  return (
    <div
      className="px-2 py-1 text-[10px] text-[var(--text-secondary)]"
      data-testid="jj-workspace-list"
    >
      <div className="font-semibold mb-0.5">jj workspaces</div>
      <ul className="space-y-0.5 pl-2">
        {workspaces.map((ws) => (
          <li
            key={ws.name}
            className="flex items-center gap-1 font-mono"
            data-testid={`jj-workspace-list-item-${ws.name}`}
          >
            <span className="text-[var(--text-primary)]">{ws.name}</span>
            {ws.changeIdShort && (
              <span className="opacity-60">@ {ws.changeIdShort.slice(0, 8)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
