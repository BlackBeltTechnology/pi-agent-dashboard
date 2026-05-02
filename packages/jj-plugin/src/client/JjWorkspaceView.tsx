/**
 * Content-area view for the `/jj` command-route. Read-only summary:
 * workspace list + current workspace name + bookmarks. Mutations all
 * go through the action bar / skill, not this view.
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useEffect, useState } from "react";
import { listWorkspaces, type JjWorkspaceListEntry } from "./api.js";

export function JjWorkspaceView({
  cwd,
}: {
  cwd: string;
}): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<JjWorkspaceListEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    setLoading(true);
    setError(null);
    listWorkspaces(cwd)
      .then((ws) => setWorkspaces(ws))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  return (
    <div className="p-4 space-y-4" data-testid="jj-workspace-view">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-[var(--text-primary)]">
          Jujutsu Workspaces
        </h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="text-xs px-3 py-1 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          data-testid="jj-workspace-view-refresh"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <div className="text-xs text-[var(--text-secondary)]">
        cwd: <code className="font-mono">{cwd}</code>
      </div>

      {error && (
        <div className="text-xs text-red-400" data-testid="jj-workspace-view-error">
          {error}
        </div>
      )}

      {workspaces && workspaces.length === 0 && !loading && (
        <div className="text-sm text-[var(--text-secondary)]">
          No jj workspaces found. (This folder may not be a jj repo.)
        </div>
      )}

      {workspaces && workspaces.length > 0 && (
        <table className="w-full text-xs" data-testid="jj-workspace-view-table">
          <thead className="text-[var(--text-secondary)]">
            <tr>
              <th className="text-left pb-1 font-semibold">Name</th>
              <th className="text-left pb-1 font-semibold">Change id</th>
              <th className="text-left pb-1 font-semibold">Commit id</th>
              <th className="text-left pb-1 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {workspaces.map((ws) => (
              <tr key={ws.name} className="border-t border-[var(--border-secondary)]">
                <td className="py-1 text-[var(--text-primary)]">{ws.name}</td>
                <td className="py-1 opacity-70">{ws.changeIdShort ?? "—"}</td>
                <td className="py-1 opacity-70">{ws.commitIdShort ?? "—"}</td>
                <td className="py-1 opacity-70">{ws.description ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
