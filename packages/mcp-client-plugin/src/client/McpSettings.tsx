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
import { SettingsNotice, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import { ApiError } from "./api.js";
import { useEffectiveConfig, useLiveState } from "./hooks.js";
import { ServerEditor } from "./ServerEditor.js";
import { ServerList } from "./ServerList.js";
import { BTN, BTN_PRIMARY } from "./settings-ui.js";

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

  const servers = view?.servers ?? [];
  const layers = view?.layers ?? [];
  // Empty state = loaded, no servers, no broken file, no error: the empty block owns the one primary Add.
  const isEmpty = !loading && !error && servers.length === 0 && layers.every((l) => l.ok);
  const refreshButton = (
    <button
      type="button"
      onClick={refreshAll}
      data-testid="mcp-refresh"
      title={t("mcpRefreshTitle", undefined, "Re-read the config files and pi's live state")}
      className={BTN}
    >
      {t("mcpRefresh", undefined, "Refresh")}
    </button>
  );

  return (
    <section data-testid="mcp-settings" className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {isEmpty ? (
          <span className="ml-auto">{refreshButton}</span>
        ) : (
          <>
            <h4 className="m-0 text-xs font-semibold text-[var(--text-secondary)]">
              {loading && !view
                ? t("mcpServersHeadingBare", undefined, "Servers")
                : t("mcpServersHeading", { count: servers.length }, `Servers · ${servers.length}`)}
            </h4>
            <span className="ml-auto flex items-center gap-2">
              {refreshButton}
              <button type="button" onClick={() => setEditing("")} data-testid="mcp-add-server" className={BTN_PRIMARY}>
                {t("mcpAddServer", undefined, "Add server")}
              </button>
            </span>
          </>
        )}
      </div>

      {notAllowed && (
        <SettingsNotice tone="info" role="alert" testId="mcp-not-allowed">
          {t("mcpNotAllowed", undefined, "This folder is not tracked by the dashboard.")}
        </SettingsNotice>
      )}

      {otherError && (
        <SettingsNotice
          tone="error"
          testId="mcp-error"
          onRetry={refreshAll}
          details={(otherError as Error).message}
        >
          {t("mcpLoadError", undefined, "Could not load the MCP configuration.")}
        </SettingsNotice>
      )}

      {!error && (
        <ServerList
          servers={servers}
          layers={layers}
          loading={loading}
          live={live}
          liveLoading={liveLoading}
          onOpen={setEditing}
          onAdd={() => setEditing("")}
          onChanged={refreshAll}
        />
      )}

      <EditorForEditing
        editing={editing}
        entryOf={(name) => view?.servers.find((s) => s.name === name)?.entry ?? null}
        onClose={() => setEditing(null)}
        onChanged={refreshAll}
      />
    </section>
  );
}
