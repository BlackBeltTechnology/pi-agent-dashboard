/**
 * mcp-client · global server list (settings section).
 *
 * Renders every server from the global effective view, sorted by name, with a
 * provenance badge per defining layer (Pi global / Shared 🔒 / Other), the
 * transport, an enable switch, and a View-or-Edit action. Layer parse errors
 * render as their own rows; an empty or still-loading list gets an empty state
 * / skeleton.
 *
 * The switch writes the `disabled` flag at global scope, leaving the previous
 * value on screen until the write lands, and reverts with an inline error when
 * it fails (task 7.3).
 *
 * See change: extract-mcp-client-plugin (tasks 7.2, 7.3).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useState } from "react";
import type { EffectiveServerView, LayerParseError, ProvenanceLayer } from "../core/effective-view.js";
import type { Scope } from "../core/types.js";
import { ApiError, scopeToWire, setServerDisabled } from "./api.js";
import { overrideFieldsOf } from "./folder-view.js";
import { invalidateEffective } from "./hooks.js";
import type { Transport } from "./schema.js";

export type { Transport };

const GLOBAL_SCOPE: Scope = { kind: "global" };

/** The transport a `ServerEntry` declares, or null when it declares none. */
export function transportOf(entry: Record<string, unknown>): Transport | null {
  if (typeof entry.command === "string") return "command";
  if (typeof entry.url === "string") return "url";
  if (typeof entry.socket === "string") return "socket";
  return null;
}

export interface Badge {
  text: string;
  locked: boolean;
  /** True for a layer this scope can write (Pi global). */
  writable: boolean;
}

function badgeFor(p: ProvenanceLayer): Badge {
  if (p.layer === "pi-global") return { text: "Pi global", locked: false, writable: true };
  if (p.layer === "pi-folder") return { text: "Pi folder", locked: false, writable: true };
  if (p.layer === "shared") return { text: "Shared", locked: true, writable: false };
  // `other` names its source kind (a package/agent-plugin source has no file).
  return { text: `Other: ${p.importKind ?? p.label}`, locked: true, writable: false };
}

/** One badge per defining layer, Pi-owned layers first. */
export function provenanceBadges(provenance: ProvenanceLayer[]): Badge[] {
  return [...provenance].sort((a, b) => rank(a.layer) - rank(b.layer)).map(badgeFor);
}

function rank(layer: ProvenanceLayer["layer"]): number {
  if (layer === "pi-global") return 0;
  if (layer === "pi-folder") return 1;
  if (layer === "shared") return 2;
  return 3;
}

/** A server is editable at a scope iff that scope's writable Pi layer defines it. */
export function isEditable(server: EffectiveServerView, scope: Scope = GLOBAL_SCOPE): boolean {
  const layer = scope.kind === "project" ? "pi-folder" : "pi-global";
  return server.provenance.some((p) => p.layer === layer);
}

function LockIcon(): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="10"
      height="10"
      fill="currentColor"
      style={{ flex: "none" }}
    >
      <path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m-3 8V7a3 3 0 0 1 6 0v3z" />
    </svg>
  );
}

/** The folder page's mutating row action is locked by the adapter gate; global View stays reachable. */
function actionDisabled(folder: boolean, readOnly: boolean): boolean {
  return folder && readOnly;
}

/** The folder page's removable override chip (display-only when `removable` is false). */
function OverrideChip({
  name,
  fields,
  removable,
  onRemove,
}: {
  name: string;
  fields: string[];
  removable: boolean;
  onRemove?: (name: string) => void;
}): React.ReactElement | null {
  if (fields.length === 0) return null;
  const canRemove = removable && onRemove !== undefined;
  return (
    <span
      data-testid={`mcp-folder-override-chip-${name}`}
      className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
    >
      {`folder: ${fields.join(", ")}`}
      {canRemove && (
        <button
          type="button"
          aria-label={`Remove folder override for ${name}`}
          data-testid={`mcp-folder-chip-remove-${name}`}
          onClick={() => onRemove?.(name)}
          className="px-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
        >
          ✕
        </button>
      )}
    </span>
  );
}

export interface ServerRowProps {
  server: EffectiveServerView;
  /** Page-wide adapter read-only flag (below-floor / absent / unknown). */
  readOnly: boolean;
  /** Write scope for the enable switch (default global). */
  scope?: Scope;
  /** Folder page: chips are display-only on narrow viewports. */
  chipsRemovable?: boolean;
  onOpen: (name: string) => void;
  /** Folder page: remove the whole folder override for this server. */
  onRemoveOverride?: (name: string) => void;
  /** Called after a successful write so the view re-fetches. */
  onChanged: () => void;
}

export function ServerRow({
  server,
  readOnly,
  scope = GLOBAL_SCOPE,
  chipsRemovable = true,
  onOpen,
  onRemoveOverride,
  onChanged,
}: ServerRowProps): React.ReactElement {
  const { name, entry, provenance } = server;
  const folder = scope.kind === "project";
  const badges = provenanceBadges(provenance);
  const editable = isEditable(server, scope);
  const transport = transportOf(entry);
  const persistedEnabled = entry.disabled !== true;
  const overrideFields = folder ? overrideFieldsOf(server) : [];

  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A persisted value change (the reload landing) releases the optimistic value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the persisted value only
  useEffect(() => setOptimistic(null), [persistedEnabled]);
  const enabled = optimistic ?? persistedEnabled;
  // Global: a non-Pi-global server cannot be toggled. Folder: every server can
  // gain a folder-layer `disabled` override, so only the adapter gate locks it.
  const locked = readOnly || (!folder && !editable);

  async function toggle(next: boolean): Promise<void> {
    setOptimistic(next);
    setPending(true);
    setError(null);
    try {
      await setServerDisabled(name, !next, scopeToWire(scope));
      invalidateEffective(folder ? scope.cwd : undefined);
      onChanged();
    } catch (e) {
      setOptimistic(null);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const actionLabel = folder ? (editable ? "Edit" : "Override…") : editable ? "Edit" : "View";
  const actionTestId = folder ? `mcp-folder-action-${name}` : `mcp-server-action-${name}`;

  return (
    <li
      data-testid={folder ? `mcp-folder-row-${name}` : `mcp-server-row-${name}`}
      className="flex flex-col gap-1 py-1.5 border-b border-[var(--border-secondary)] last:border-b-0"
    >
      <div className="flex items-center gap-2 min-h-11 sm:min-h-0">
        <label className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 flex-none">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Enable ${name}`}
            aria-busy={pending}
            checked={enabled}
            disabled={locked || pending}
            onChange={(e) => void toggle(e.target.checked)}
            data-testid={`mcp-server-toggle-${name}`}
            className="w-4 h-4"
          />
        </label>
        <span className="text-xs font-medium text-[var(--text-primary)] truncate">{name}</span>
        {transport && (
          <code className="text-[10px] text-[var(--text-tertiary)] flex-none">{transport}</code>
        )}
        <span className="flex items-center gap-1 flex-wrap">
          {badges.map((b) => (
            <span
              key={b.text}
              data-testid={`mcp-badge-${name}-${b.text}`}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border-secondary)] text-[var(--text-secondary)]"
            >
              {b.locked && <LockIcon />}
              {b.text}
            </span>
          ))}
          {overrideFields.length > 0 && (
            <OverrideChip
              name={name}
              fields={overrideFields}
              removable={chipsRemovable}
              onRemove={onRemoveOverride}
            />
          )}
        </span>
        <button
          type="button"
          onClick={() => onOpen(name)}
          disabled={actionDisabled(folder, readOnly)}
          data-testid={actionTestId}
          className="ml-auto text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {actionLabel}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          data-testid={`mcp-server-error-${name}`}
          className="text-[11px] text-[var(--status-error,#f87171)]"
        >
          {error}
        </p>
      )}
    </li>
  );
}

function SkeletonRows(): React.ReactElement {
  return (
    <div data-testid="mcp-list-skeleton" className="space-y-2 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-5 rounded bg-[var(--bg-tertiary,#27272a)] animate-pulse"
          style={{ width: `${100 - i * 15}%` }}
        />
      ))}
    </div>
  );
}

export interface ServerListProps {
  servers: EffectiveServerView[];
  layerErrors: LayerParseError[];
  /** True until the first effective view arrives. */
  loading: boolean;
  readOnly: boolean;
  /** Write scope for every row (default global). */
  scope?: Scope;
  /** Folder page: chips are display-only on narrow viewports. */
  chipsRemovable?: boolean;
  onOpen: (name: string) => void;
  onAdd: () => void;
  onRemoveOverride?: (name: string) => void;
  onChanged: () => void;
}

export function ServerList({
  servers,
  layerErrors,
  loading,
  readOnly,
  scope,
  chipsRemovable,
  onOpen,
  onAdd,
  onRemoveOverride,
  onChanged,
}: ServerListProps): React.ReactElement {
  const t = useT();
  if (loading && servers.length === 0 && layerErrors.length === 0) return <SkeletonRows />;

  const sorted = [...servers].sort((a, b) => a.name.localeCompare(b.name));
  const empty = sorted.length === 0 && layerErrors.length === 0;

  return (
    <ul data-testid="mcp-server-list" className="list-none m-0 p-0">
      {layerErrors.map((e) => (
        <li
          key={e.path}
          data-testid="mcp-layer-error"
          role="alert"
          className="text-[11px] py-1.5 border-b border-[var(--border-secondary)] text-[var(--status-error,#f87171)]"
        >
          <code>{e.path}</code>: {e.message}
        </li>
      ))}
      {sorted.map((s) => (
        <ServerRow
          key={s.name}
          server={s}
          readOnly={readOnly}
          scope={scope}
          chipsRemovable={chipsRemovable}
          onOpen={onOpen}
          onRemoveOverride={onRemoveOverride}
          onChanged={onChanged}
        />
      ))}
      {empty && (
        <li data-testid="mcp-empty" className="py-3 text-center">
          <p className="text-xs text-[var(--text-secondary)] m-0 mb-1.5">
            {t("mcpEmptyState", undefined, "No MCP servers configured.")}
          </p>
          <div className="flex items-center justify-center gap-3 text-[11px]">
            <button
              type="button"
              onClick={onAdd}
              disabled={readOnly}
              data-testid="mcp-empty-add"
              className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Add server
            </button>
            <a
              href="https://github.com/earendil-works/pi-mcp-adapter#configuration"
              target="_blank"
              rel="noreferrer"
              data-testid="mcp-docs-link"
              className="text-[var(--accent-primary,#60a5fa)]"
            >
              MCP configuration docs
            </a>
          </div>
        </li>
      )}
    </ul>
  );
}
