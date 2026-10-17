/**
 * mcp-client · server list (settings section + folder page).
 *
 * Rows render pi's own vocabulary: name, description, transport, exposure,
 * the enabled switch, live state + tool count from `/live` ("state unknown"
 * when absent), the auth mode for HTTP rows, provenance badges (Pi global /
 * Pi folder, "overrides Pi global" for a whole-entry folder override), the
 * "ignored by pi" flag with a one-click convert for adapter leftovers, pi's
 * rejection message, and inactive reasons. Layer parse errors render as their
 * own rows (pi skips the whole file).
 *
 * The switch writes `enabled` at the row's scope (pending until the write
 * completes, reverting with an inline error on failure). On a Pi-global row at
 * folder scope it shows the EFFECTIVE state and writes only a project override;
 * an override shows as text badges ("Off in this folder") with Reset to global,
 * and an overflow menu offers "Project settings…" and "Replace with folder
 * entry…". Orphaned / invalid override rows offer only Remove. A folder-scope
 * enable of a whole-entry copy that needs re-entered secrets surfaces the
 * needs-choice result; a legacy copy shows an info strip with Convert.
 *
 * Folder-page rows are keyed `${provenance}:${name}` — two rows can share a
 * name (the folder entry replaces the global one only when pi trusts it).
 *
 * See change: migrate-mcp-to-pi-builtin; mcp-client-project-overrides (D9).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useState } from "react";
import { authModeOf, isProjectOverride } from "../core/pi-rules.js";
import type { EffectiveServerView, LayerStatus, LiveState, Scope } from "../core/types.js";
import { ApiError, convertServer, scopeToWire, setEnabled } from "./api.js";
import { overrideBadges, provenanceLabel } from "./folder-view.js";
import { invalidateEffective } from "./hooks.js";

const GLOBAL_SCOPE: Scope = { kind: "global" };

/** Identifies one row to the page: rows can share a name across provenance. */
export interface RowRef {
  key: string;
  name: string;
  provenance: EffectiveServerView["provenance"];
}

/** Row testid key: folder rows can share a name across provenance. */
function keyOf(server: EffectiveServerView, folder: boolean): string {
  return folder ? `${server.provenance}:${server.name}` : server.name;
}

/** The human phrase for an inactive row that the switch cannot explain. */
function inactiveText(reason: string | undefined): string | null {
  switch (reason) {
    case "project-not-trusted":
      return "project not trusted";
    case "global-only-auth":
      return "auth is global-only";
    case "name-collision":
      return "name collision";
    default:
      return null;
  }
}

interface ServerRowProps {
  server: EffectiveServerView;
  /** Write scope for the enable switch (default global). */
  scope?: Scope;
  live: LiveState | null;
  liveLoading: boolean;
  onOpen: (name: string, provenance: EffectiveServerView["provenance"]) => void;
  onChanged: () => void;
  /**
   * Folder page: a pi-folder row with the same name exists, so a folder-scope
   * write for this name lands on THAT entry — this global row's write actions
   * (toggle, Override…) are disabled rather than silently replacing it.
   */
  writeShadowed?: boolean;
  onNeedsChoice?: (row: RowRef, omitted: string[]) => void;
  /** Folder page: remove the whole folder entry for this server. */
  onRemoveOverride?: (name: string) => void;
  /** Folder page: the chip's inline remove control hides below 640px. */
  chipsRemovable?: boolean;
  /** Folder page: open the "Project settings…" panel for a Pi-global row. */
  onProjectSettings?: (name: string) => void;
  /** Folder page: remove the project override (exact undo is the page's job). */
  onReset?: (name: string) => void;
  /** Folder page: convert a legacy folder copy to a project override. */
  onConvertLegacy?: (name: string) => void;
  /** Folder page: the project is not trusted, so an override applies later. */
  untrusted?: boolean;
  /** Folder page: the raw override of this name that pi will only read once trusted. */
  pendingOverride?: Record<string, unknown>;
  /** Below 640px: badges are display-only, row actions live in the row's sheet. */
  narrow?: boolean;
}

/** An override-shaped folder entry (no command/url/type): never a server of its own. */
function isOverrideRow(server: EffectiveServerView): boolean {
  return server.provenance === "pi-folder" && isProjectOverride(server.entry);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one row = write state + pi vocabulary (live, auth, leftovers, inactive reasons)
function ServerRow({
  server,
  scope = GLOBAL_SCOPE,
  live,
  liveLoading,
  onOpen,
  onChanged,
  onNeedsChoice,
  onRemoveOverride,
  chipsRemovable = true,
  writeShadowed = false,
  onProjectSettings,
  onReset,
  onConvertLegacy,
  untrusted = false,
  pendingOverride,
  narrow = false,
}: ServerRowProps): React.ReactElement {
  const t = useT();
  const { name, entry } = server;
  const folder = scope.kind === "project";
  const key = keyOf(server, folder);
  const persistedEnabled = server.enabled;

  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [savedPending, setSavedPending] = useState(false);
  // A persisted value change (the reload landing) releases the optimistic value.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the persisted value only
  useEffect(() => setOptimistic(null), [persistedEnabled]);
  const enabled = optimistic ?? persistedEnabled;

  const liveRow = live?.ok ? live.servers[name] : undefined;
  const authMode = server.transport === "http" ? authModeOf(entry) : undefined;
  const needsAuth = liveRow?.state === "needs-auth" && authMode?.kind === "oauth";

  async function toggle(next: boolean): Promise<void> {
    setOptimistic(next);
    setPending(true);
    setError(null);
    try {
      const result = await setEnabled(name, next, scopeToWire(scope));
      if (!result.ok) {
        setOptimistic(null);
        setError(result.refusal.message);
        return;
      }
      if (result.action === "needs-choice") {
        setOptimistic(null);
        onNeedsChoice?.({ key, name, provenance: server.provenance }, result.omitted);
        return;
      }
      if (folder && untrusted) {
        // pi does not read the folder file yet: the row keeps showing the global state.
        setOptimistic(null);
        setSavedPending(true);
      }
      invalidateEffective(folder ? scope.cwd : undefined);
      onChanged();
    } catch (e) {
      setOptimistic(null);
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  async function convert(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      await convertServer(name, scopeToWire(scope));
      invalidateEffective(folder ? scope.cwd : undefined);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setPending(false);
    }
  }

  const overrideRow = folder && isOverrideRow(server);
  const globalRow = folder && server.provenance === "pi-global";
  const overrideRaw = server.projectOverride?.raw ?? pendingOverride ?? (overrideRow ? entry : undefined);
  const badges = overrideRaw ? overrideBadges(overrideRaw) : [];
  const hasOverride = globalRow && overrideRaw !== undefined;
  const legacyCopy = folder && server.legacyCopy === true;
  const pendingNote = globalRow && untrusted && (pendingOverride !== undefined || savedPending);
  const actionLabel = folder && server.provenance !== "pi-folder" ? "Replace with folder entry…" : "Edit";
  const actionTestId = folder ? `mcp-folder-action-${key}` : `mcp-server-action-${name}`;
  const description = typeof entry.description === "string" ? entry.description : null;
  const inactiveReason = inactiveText(server.inactiveReason);

  return (
    <li
      data-testid={folder ? `mcp-folder-row-${key}` : `mcp-server-row-${name}`}
      className="flex flex-col gap-1 py-1.5 border-b border-[var(--border-secondary)] last:border-b-0"
    >
      <div className="flex items-center gap-2 min-h-11 sm:min-h-0 flex-wrap">
        <label className="inline-flex items-center justify-center min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 flex-none">
          <input
            type="checkbox"
            role="switch"
            aria-label={`Enable ${name}`}
            aria-busy={pending}
            checked={enabled}
            disabled={pending || writeShadowed || overrideRow}
            title={
              overrideRow
                ? `No Pi global server named ${name} to override`
                : writeShadowed
                  ? "The folder entry of the same name is the folder-scope write target"
                  : undefined
            }
            onChange={(e) => void toggle(e.target.checked)}
            data-testid={`mcp-server-toggle-${key}`}
            className="w-4 h-4"
          />
        </label>
        <span className="text-xs font-medium text-[var(--text-primary)] truncate">{name}</span>
        {description && (
          <span data-testid={`mcp-server-description-${key}`} className="text-[11px] text-[var(--text-secondary)] truncate">
            {description}
          </span>
        )}
        <code data-testid={`mcp-transport-${key}`} className="text-[10px] text-[var(--text-tertiary)] flex-none">
          {typeof entry.command === "string" ? "command" : "url"}
        </code>
        <span data-testid={`mcp-exposure-${key}`} className="text-[10px] text-[var(--text-tertiary)] flex-none">
          {server.exposure}
        </span>
        {authMode && (
          <span data-testid={`mcp-authmode-${key}`} className="text-[10px] text-[var(--text-tertiary)] flex-none">
            {authMode.kind === "provider"
              ? `auth: ${authMode.provider}`
              : authMode.kind === "header"
                ? "header"
                : "OAuth"}
          </span>
        )}
        <span className="flex items-center gap-1 flex-wrap">
          <span
            data-testid={`mcp-badge-${key}-${provenanceLabel(server.provenance)}`}
            className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--border-secondary)] text-[var(--text-secondary)]"
          >
            {provenanceLabel(server.provenance)}
          </span>
          {server.overridesGlobal && (
            <span
              data-testid={`mcp-badge-${key}-overrides Pi global`}
              className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
            >
              overrides Pi global
            </span>
          )}
          {folder && server.provenance === "pi-folder" && !overrideRow && (
            <span
              data-testid={`mcp-folder-override-chip-${key}`}
              className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
            >
              folder entry
              {chipsRemovable && onRemoveOverride && (
                <button
                  type="button"
                  aria-label={`Remove folder override for ${name}`}
                  data-testid={`mcp-folder-chip-remove-${key}`}
                  onClick={() => onRemoveOverride(name)}
                  className="px-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
                >
                  ✕
                </button>
              )}
            </span>
          )}
          {badges.map((b) => (
            <span
              key={b.key}
              data-testid={`mcp-override-badge-${key}-${b.key}`}
              className="inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-full border border-[var(--accent-primary,#60a5fa)] text-[var(--accent-primary,#60a5fa)]"
            >
              {b.text}
            </span>
          ))}
          {hasOverride && !narrow && onReset && (
            <button
              type="button"
              data-testid={`mcp-folder-reset-${key}`}
              disabled={pending || writeShadowed}
              onClick={() => onReset(name)}
              className="text-[11px] px-1 min-h-11 sm:min-h-0 underline text-[var(--accent-text,#60a5fa)] disabled:opacity-50"
            >
              Reset to global
            </button>
          )}
        </span>
        {live !== undefined && !(liveLoading && live === null) && (
          <span data-testid={`mcp-live-${key}`} className="text-[10px] text-[var(--text-tertiary)] flex-none">
            {liveRow ? (liveRow.state === "not-checked-by-pi" ? "not checked by pi" : `${liveRow.state} · ${liveRow.tools} tools`) : "state unknown"}
          </span>
        )}
        {needsAuth && (
          <span
            data-testid={`mcp-signin-hint-${key}`}
            className="text-[10px] text-[var(--text-secondary)] flex-none"
          >
            sign in: /mcp login {name}
          </span>
        )}
        {server.adapterLeftovers.length > 0 && (!folder || server.provenance === "pi-folder") && (
          <span className="inline-flex items-center gap-1 flex-none">
            <span
              data-testid={`mcp-leftovers-${key}`}
              className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500 text-amber-500"
              title={`pi ignores: ${server.adapterLeftovers.join(", ")}`}
            >
              ignored by pi: {server.adapterLeftovers.join(", ")}
            </span>
            <button
              type="button"
              aria-label={`Convert ${name} to pi's entry shape`}
              data-testid={`mcp-convert-${key}`}
              disabled={pending}
              onClick={() => void convert()}
              className="text-[10px] px-1.5 py-0.5 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              Convert
            </button>
          </span>
        )}
        {overrideRow ? (
          <button
            type="button"
            onClick={() => onRemoveOverride?.(name)}
            data-testid={actionTestId}
            className="ml-auto text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Remove
          </button>
        ) : globalRow || (legacyCopy && narrow) ? (
          <span className="ml-auto relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={writeShadowed}
              title={writeShadowed ? "The folder entry of the same name is the folder-scope write target — edit that row" : undefined}
              onClick={() => setMenuOpen((o) => !o)}
              data-testid={`mcp-folder-menu-${key}`}
              className="text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
            >
              ⋯ <span className="hidden sm:inline">{t("mcpFolderActions", undefined, "Actions")}</span>
            </button>
            {menuOpen && (
              <span
                role="menu"
                data-testid={`mcp-folder-menu-pop-${key}`}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setMenuOpen(false);
                }}
                className="absolute right-0 top-full z-10 mt-1 flex min-w-56 flex-col rounded border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1 text-left"
              >
                {globalRow && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`mcp-folder-project-settings-${key}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onProjectSettings?.(name);
                    }}
                    className="px-2 py-1 min-h-11 sm:min-h-0 text-left text-[11px] text-[var(--text-primary)]"
                  >
                    Project settings…
                  </button>
                )}
                {globalRow && hasOverride && narrow && onReset && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`mcp-folder-reset-${key}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onReset(name);
                    }}
                    className="px-2 py-1 min-h-11 sm:min-h-0 text-left text-[11px] text-[var(--text-primary)]"
                  >
                    Reset to global
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  data-testid={actionTestId}
                  onClick={() => {
                    setMenuOpen(false);
                    onOpen(name, server.provenance);
                  }}
                  className="px-2 py-1 min-h-11 sm:min-h-0 text-left text-[11px] text-[var(--text-primary)]"
                >
                  {actionLabel}
                </button>
                {legacyCopy && narrow && (
                  <button
                    type="button"
                    role="menuitem"
                    data-testid={`mcp-folder-convert-${key}`}
                    onClick={() => {
                      setMenuOpen(false);
                      onConvertLegacy?.(name);
                    }}
                    className="px-2 py-1 min-h-11 sm:min-h-0 text-left text-[11px] text-[var(--text-primary)]"
                  >
                    Convert to project override
                  </button>
                )}
              </span>
            )}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onOpen(name, server.provenance)}
            data-testid={actionTestId}
            className="ml-auto text-[11px] px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {actionLabel}
          </button>
        )}
      </div>
      {server.piError && (
        <p
          data-testid={`mcp-pi-error-${key}`}
          role="alert"
          className="text-[11px] text-[var(--status-error,#f87171)] m-0"
        >
          {server.piError}
        </p>
      )}
      {pendingNote && (
        <p data-testid={`mcp-folder-pending-${key}`} role="status" className="text-[11px] text-[var(--text-secondary)] m-0">
          Saved — applies once the project is trusted. pi still runs <code>{name}</code> from Pi global here.
        </p>
      )}
      {legacyCopy && (
        <p
          data-testid={`mcp-legacy-strip-${key}`}
          className="text-[11px] text-[var(--text-secondary)] m-0 flex items-center gap-2 flex-wrap"
        >
          <span>
            <b>{t("mcpLegacyTitle", undefined, "Copied from Pi global by an older dashboard, without credentials.")}</b>{" "}
            {t("mcpLegacyBody", undefined, "A project override keeps the global credentials and only changes on/off here.")}
          </span>
          {!narrow && (
            <button
              type="button"
              data-testid={`mcp-folder-convert-${key}`}
              disabled={pending}
              onClick={() => onConvertLegacy?.(name)}
              className="px-2 py-1 min-h-11 sm:min-h-0 rounded border border-[var(--border-secondary)] text-[var(--text-primary)]"
            >
              Convert to project override
            </button>
          )}
        </p>
      )}
      {inactiveReason && (
        <p data-testid={`mcp-inactive-${key}`} className="text-[11px] text-[var(--text-secondary)] m-0">
          {inactiveReason}
        </p>
      )}
      {error && (
        <p
          role="alert"
          data-testid={`mcp-server-error-${key}`}
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
  /** Parse status per layer: a failed layer renders a "pi skips the file" row. */
  layers: LayerStatus[];
  /** True until the first effective view arrives. */
  loading: boolean;
  /** Write scope for every row (default global). */
  scope?: Scope;
  /** Live state from `/live`; `null` while absent → rows read "state unknown". */
  live?: LiveState | null;
  liveLoading?: boolean;
  onOpen: (name: string, provenance: EffectiveServerView["provenance"]) => void;
  onAdd: () => void;
  onChanged: () => void;
  /** Folder page: a folder enable that needs re-entered secrets. */
  onNeedsChoice?: (row: RowRef, omitted: string[]) => void;
  /** Folder page: remove the whole folder entry (or override) for this server. */
  onRemoveOverride?: (name: string) => void;
  /** Folder page: the chip's inline remove control hides below 640px. */
  chipsRemovable?: boolean;
  onProjectSettings?: (name: string) => void;
  onReset?: (name: string) => void;
  onConvertLegacy?: (name: string) => void;
  /** Folder page: pi does not trust the project (an override applies once it does). */
  untrusted?: boolean;
  narrow?: boolean;
}

export function ServerList({
  servers,
  layers,
  loading,
  scope,
  live,
  liveLoading = false,
  onOpen,
  onAdd,
  onChanged,
  onNeedsChoice,
  onRemoveOverride,
  chipsRemovable,
  onProjectSettings,
  onReset,
  onConvertLegacy,
  untrusted,
  narrow,
}: ServerListProps): React.ReactElement {
  const t = useT();
  if (loading && servers.length === 0 && layers.every((l) => l.ok)) return <SkeletonRows />;

  const sorted = [...servers].sort(
    (a, b) => (a.name === b.name ? a.provenance.localeCompare(b.provenance) : a.name.localeCompare(b.name)),
  );
  // Whole-entry folder entries shadow the global row; an override-shaped entry never does.
  const folderNames = new Set(
    sorted.filter((s) => s.provenance === "pi-folder" && !isOverrideRow(s)).map((s) => s.name),
  );
  // Untrusted: pi has not read the override yet, so the GLOBAL row carries it (badge, Reset, note).
  const globalNames = new Set(sorted.filter((s) => s.provenance === "pi-global").map((s) => s.name));
  const pendingOverrides = new Map<string, Record<string, unknown>>();
  if (untrusted) {
    for (const s of sorted) {
      if (isOverrideRow(s) && globalNames.has(s.name)) pendingOverrides.set(s.name, s.entry);
    }
  }
  const visible = sorted.filter((s) => !(isOverrideRow(s) && pendingOverrides.has(s.name)));
  const brokenLayers = layers.filter((l) => !l.ok);
  const empty = sorted.length === 0 && brokenLayers.length === 0;

  return (
    <ul data-testid="mcp-server-list" className="list-none m-0 p-0">
      {brokenLayers.map((l) => (
        <li
          key={l.path}
          data-testid="mcp-layer-error"
          role="alert"
          className="text-[11px] py-1.5 border-b border-[var(--border-secondary)] text-[var(--status-error,#f87171)]"
        >
          <code>{l.path}</code>: {l.message} — pi skips this file.
        </li>
      ))}
      {visible.map((s) => (
        <ServerRow
          key={`${s.provenance}:${s.name}`}
          server={s}
          scope={scope}
          live={live ?? null}
          liveLoading={liveLoading}
          onOpen={onOpen}
          onChanged={onChanged}
          onNeedsChoice={onNeedsChoice}
          onRemoveOverride={onRemoveOverride}
          chipsRemovable={chipsRemovable}
          onProjectSettings={onProjectSettings}
          onReset={onReset}
          onConvertLegacy={onConvertLegacy}
          untrusted={untrusted}
          narrow={narrow}
          {...(pendingOverrides.has(s.name) && s.provenance === "pi-global"
            ? { pendingOverride: pendingOverrides.get(s.name) as Record<string, unknown> }
            : {})}
          writeShadowed={scope?.kind === "project" && s.provenance === "pi-global" && folderNames.has(s.name)}
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
              data-testid="mcp-empty-add"
              className="px-2 py-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            >
              Add server
            </button>
            <a
              href="https://github.com/earendil-works/pi/blob/main/docs/mcp.md"
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
