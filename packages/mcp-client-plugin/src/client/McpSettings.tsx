/**
 * mcp-client · settings-section root (`McpSettingsClaim`).
 *
 * One adapter status drives the header pill, the banner, and the page-wide
 * read-only flag, so the three can never disagree. Below them: the global
 * server list (tasks 7.2/7.3), the error states (504 `adapter-timeout` with a
 * retry + a link to the timeout field; 403 `not-allowed`), the schema-driven
 * server editor (task 7.4), and the global settings form (task 7.6,
 * `GlobalSettingsForm` — a host draft source, no local Save).
 *
 * See change: extract-mcp-client-plugin (tasks 7.2-7.4, 7.6).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useState } from "react";
import { ApiError } from "./api.js";
import { GlobalSettingsForm } from "./GlobalSettingsForm.js";
import { type AdapterStatus, useAdapterStatus, useEffectiveConfig } from "./hooks.js";
import { ServerEditor } from "./ServerEditor.js";
import { isEditable, ServerList } from "./ServerList.js";

export function McpSettingsClaim(): React.ReactElement {
  return <McpSettings />;
}

const DOCS_HREF = "https://www.npmjs.com/package/pi-mcp-adapter";

function StatusPill({ status }: { status: AdapterStatus }): React.ReactElement {
  return (
    <span
      data-testid="mcp-adapter-pill"
      data-kind={status.kind}
      className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      <span className="font-medium">pi-mcp-adapter</span>
      <span>{status.installed ?? status.kind}</span>
      {!status.ok && <span>· need ≥{status.floor}</span>}
    </span>
  );
}

/** Banner detail always names installed + floor, matching the pill. */
function bannerDetail(status: AdapterStatus): string {
  switch (status.kind) {
    case "below-floor":
      return `Installed ${status.installed ?? "unknown"}; requires ≥${status.floor}.`;
    case "absent":
      return `Not installed; requires ≥${status.floor}.`;
    default:
      return `${status.message} Requires ≥${status.floor}.`;
  }
}

function AdapterBanner({ status }: { status: AdapterStatus }): React.ReactElement {
  return (
    <div
      data-testid="mcp-adapter-banner"
      role="status"
      className="flex flex-wrap items-center gap-2 text-[11px] px-2 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)]"
    >
      <span>{bannerDetail(status)}</span>
      {status.action && (
        <a
          href={DOCS_HREF}
          target="_blank"
          rel="noreferrer"
          data-testid={`mcp-adapter-${status.action}`}
          className="text-[var(--accent-primary,#60a5fa)]"
        >
          {status.action === "upgrade" ? `Upgrade to ≥${status.floor}` : "Install pi-mcp-adapter"}
        </a>
      )}
    </div>
  );
}

function TimeoutNotice({
  timeoutMs,
  onRetry,
}: {
  timeoutMs: number;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <p
      data-testid="mcp-timeout"
      role="alert"
      className="text-[11px] text-[var(--text-secondary)] m-0"
    >
      Loading MCP configuration timed out after {timeoutMs} ms.{" "}
      <button
        type="button"
        onClick={onRetry}
        data-testid="mcp-timeout-retry"
        className="px-1.5 py-0.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)]"
      >
        Retry
      </button>{" "}
      <a href="#mcp-adapter-timeout" data-testid="mcp-timeout-link">
        Increase the timeout
      </a>
    </p>
  );
}

/** The editor for the open `editing` key: "" = add, a name = that server, null = closed. */
function EditorForEditing({
  editing,
  view,
  readOnly,
  onClose,
  onChanged,
}: {
  editing: string | null;
  view: ReturnType<typeof useEffectiveConfig>["view"];
  readOnly: boolean;
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement | null {
  if (editing === null) return null;
  const server = editing === "" ? null : (view?.servers.find((s) => s.name === editing) ?? null);
  return (
    <ServerEditor
      key={editing}
      name={editing === "" ? null : editing}
      entry={server?.entry ?? {}}
      editable={editing === "" || (server !== null && isEditable(server))}
      readOnly={readOnly}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

export function McpSettings(): React.ReactElement {
  const t = useT();
  const { view, loading, error, reload } = useEffectiveConfig();
  const status = useAdapterStatus(view?.adapter);
  const [editing, setEditing] = useState<string | null>(null);

  const adapterTimeout = error instanceof ApiError && error.isAdapterTimeout ? error : null;
  const notAllowed = error instanceof ApiError && error.isNotAllowed ? error : null;
  const otherError = error && !adapterTimeout && !notAllowed ? error : null;

  return (
    <section data-testid="mcp-settings" className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold m-0 text-[var(--text-primary)]">
          {t("mcpServersHeading", undefined, "MCP servers")}
        </h3>
        <StatusPill status={status} />
        <button
          type="button"
          onClick={() => setEditing("")}
          disabled={status.readOnly}
          data-testid="mcp-add-server"
          className="ml-auto text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          Add server
        </button>
      </div>

      {!status.ok && <AdapterBanner status={status} />}

      {notAllowed && (
        <p data-testid="mcp-not-allowed" role="alert" className="text-[11px] m-0">
          This folder is not tracked by the dashboard.
        </p>
      )}

      {adapterTimeout && <TimeoutNotice timeoutMs={adapterTimeout.timeoutMs ?? 10000} onRetry={reload} />}

      {otherError && (
        <p
          data-testid="mcp-error"
          role="alert"
          className="text-[11px] text-[var(--status-error,#f87171)] m-0"
        >
          Could not load MCP configuration: {(otherError as Error).message}
        </p>
      )}

      <ServerList
        servers={view?.servers ?? []}
        layerErrors={view?.layerErrors ?? []}
        loading={loading}
        readOnly={status.readOnly}
        onOpen={setEditing}
        onAdd={() => setEditing("")}
        onChanged={reload}
      />

      {/* Task 7.6: the global settings form is a host draft source (no local Save). */}
      {view && <GlobalSettingsForm view={view} readOnly={status.readOnly} onChanged={reload} />}

      {/* Task 7.4: the schema-driven editor, keyed on `editing` ("" = add). */}
      <EditorForEditing
        editing={editing}
        view={view}
        readOnly={status.readOnly}
        onClose={() => setEditing(null)}
        onChanged={reload}
      />
    </section>
  );
}
