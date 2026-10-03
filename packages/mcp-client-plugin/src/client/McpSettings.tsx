/**
 * mcp-client · settings-section root (`McpSettingsClaim`).
 *
 * The Pi-global server list (rows carry pi's live state + tool count from
 * `/live`, fetched on page view / explicit refresh), error states, and the
 * schema-driven server editor. No adapter status, no global settings form —
 * the section is always editable.
 *
 * See change: migrate-mcp-to-pi-builtin.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import { ApiError } from "./api.js";
import { useEffectiveConfig, useLiveState } from "./hooks.js";
import { ServerEditor } from "./ServerEditor.js";
import { ServerList } from "./ServerList.js";

export function McpSettingsClaim(): React.ReactElement {
  return <McpSettings />;
}

/** The editor for the open `editing` key: "" = add, a name = that server, null = closed. */
function EditorForEditing({
  editing,
  entryOf,
  onClose,
  onChanged,
}: {
  editing: string | null;
  entryOf: (name: string) => Record<string, unknown> | null;
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement | null {
  if (editing === null) return null;
  const entry = editing === "" ? {} : (entryOf(editing) ?? {});
  return (
    <ServerEditor
      key={editing}
      name={editing === "" ? null : editing}
      entry={entry}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

export function McpSettings(): React.ReactElement {
  const t = useT();
  const { view, loading, error, reload } = useEffectiveConfig();
  const { live, loading: liveLoading, refresh } = useLiveState();
  const [editing, setEditing] = useState<string | null>(null);

  const notAllowed = error instanceof ApiError && error.isNotAllowed ? error : null;
  const otherError = error && !notAllowed ? error : null;

  const refreshAll = (): void => {
    reload();
    refresh();
  };

  return (
    <section data-testid="mcp-settings" className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold m-0 text-[var(--text-primary)]">
          {t("mcpServersHeading", undefined, "MCP servers")}
        </h3>
        <button
          type="button"
          onClick={refreshAll}
          data-testid="mcp-refresh"
          title={t("mcpRefreshTitle", undefined, "Re-read the config files and pi's live state")}
          className="text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {t("mcpRefresh", undefined, "Refresh")}
        </button>
        <button
          type="button"
          onClick={() => setEditing("")}
          data-testid="mcp-add-server"
          className="ml-auto text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          {t("mcpAddServer", undefined, "Add server")}
        </button>
      </div>

      {notAllowed && (
        <p data-testid="mcp-not-allowed" role="alert" className="text-[11px] m-0">
          {t("mcpNotAllowed", undefined, "This folder is not tracked by the dashboard.")}
        </p>
      )}

      {otherError && (
        <p
          data-testid="mcp-error"
          role="alert"
          className="text-[11px] text-[var(--status-error,#f87171)] m-0"
        >
          {t("mcpLoadError", { message: (otherError as Error).message }, `Could not load MCP configuration: ${(otherError as Error).message}`)}
        </p>
      )}

      <ServerList
        servers={view?.servers ?? []}
        layers={view?.layers ?? []}
        loading={loading}
        live={live}
        liveLoading={liveLoading}
        onOpen={setEditing}
        onAdd={() => setEditing("")}
        onChanged={refreshAll}
      />

      <EditorForEditing
        editing={editing}
        entryOf={(name) => view?.servers.find((s) => s.name === name)?.entry ?? null}
        onClose={() => setEditing(null)}
        onChanged={refreshAll}
      />
    </section>
  );
}
