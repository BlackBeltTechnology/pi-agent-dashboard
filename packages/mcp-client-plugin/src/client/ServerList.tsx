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
import {
  SettingsItem,
  SettingsNotice,
  SettingsStatusPill,
  type SettingsStatusTone,
  useT,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { authModeOf, isProjectOverride } from "@blackbelt-technology/pi-dashboard-mcp-core/pi-rules.js";
import type { EffectiveServerView, LayerStatus, LiveState, Scope } from "@blackbelt-technology/pi-dashboard-mcp-core/types.js";
import type React from "react";
import { useEffect, useState } from "react";
import { ApiError, convertServer, scopeToWire, setEnabled } from "./api.js";
import { overrideBadges, provenanceLabel } from "./folder-view.js";
import { invalidateEffective } from "./hooks.js";
import { BTN, BTN_PRIMARY, LINK } from "./settings-ui.js";

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

/** Human word + tone for pi's reported connection state; the raw enum is kept only as `data-status`. */
function livePill(
  liveRow: { state: string; tools: number } | undefined,
): { tone: SettingsStatusTone; text: string; status?: string } {
  if (!liveRow) return { tone: "neutral", text: "State unknown" };
  const tools = `${liveRow.tools} ${liveRow.tools === 1 ? "tool" : "tools"}`;
  switch (liveRow.state) {
    case "not-checked-by-pi":
      return { tone: "neutral", text: "Not checked by pi", status: liveRow.state };
    case "connected":
      return { tone: "success", text: `Connected · ${tools}`, status: liveRow.state };
    case "needs-auth":
      return { tone: "warning", text: "Sign-in needed", status: liveRow.state };
    case "failed":
    case "error":
      return { tone: "error", text: "Connection failed", status: liveRow.state };
    default: {
      const word = liveRow.state.replace(/[-_]+/g, " ");
      const human = word.charAt(0).toUpperCase() + word.slice(1);
      return { tone: "neutral", text: liveRow.tools > 0 ? `${human} · ${tools}` : human, status: liveRow.state };
    }
  }
}

/** Kit-styled enable switch (no label row): immediate write, `aria-checked` carries the state. */
function RowSwitch({
  name,
  testId,
  checked,
  pending,
  disabled,
  title,
  onToggle,
}: {
  name: string;
  testId: string;
  checked: boolean;
  pending: boolean;
  disabled: boolean;
  title?: string;
  onToggle: (next: boolean) => void;
}): React.ReactElement {
  return (
    <span className="inline-flex min-h-11 min-w-11 flex-none items-center justify-center sm:min-h-0 sm:min-w-0">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`Enable ${name}`}
        aria-busy={pending}
        disabled={pending || disabled}
        title={title}
        data-testid={testId}
        onClick={() => onToggle(!checked)}
        className={`focus-ring relative h-[22px] w-10 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          checked ? "border-[var(--accent-solid)] bg-[var(--accent-solid)]" : "border-[var(--border-strong)] bg-[var(--bg-tertiary)]"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform ${
            checked ? "translate-x-[18px] bg-white" : "translate-x-0 bg-[var(--text-secondary)]"
          }`}
        />
      </button>
    </span>
  );
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

  const menuItemCls = "focus-ring px-2 py-1 min-h-11 sm:min-h-8 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)]";
  const livePillInfo = live !== undefined && !(liveLoading && live === null) ? livePill(liveRow) : null;

  const pills = (
    <>
      <SettingsStatusPill tone="neutral" icon={null} testId={`mcp-transport-${key}`}>
        {typeof entry.command === "string" ? "command" : "url"}
      </SettingsStatusPill>
      <SettingsStatusPill tone="neutral" icon={null} testId={`mcp-exposure-${key}`}>
        {server.exposure}
      </SettingsStatusPill>
      {authMode && (
        <SettingsStatusPill tone="neutral" icon={null} testId={`mcp-authmode-${key}`}>
          {authMode.kind === "provider" ? `auth: ${authMode.provider}` : authMode.kind === "header" ? "header" : "OAuth"}
        </SettingsStatusPill>
      )}
      <SettingsStatusPill
        tone="neutral"
        icon={null}
        testId={`mcp-badge-${key}-${provenanceLabel(server.provenance)}`}
      >
        {provenanceLabel(server.provenance)}
      </SettingsStatusPill>
      {server.overridesGlobal && (
        <SettingsStatusPill tone="info" icon={null} testId={`mcp-badge-${key}-overrides Pi global`}>
          overrides Pi global
        </SettingsStatusPill>
      )}
      {folder && server.provenance === "pi-folder" && !overrideRow && (
        <SettingsStatusPill tone="info" icon={null} testId={`mcp-folder-override-chip-${key}`}>
          folder entry
          {chipsRemovable && onRemoveOverride && (
            <button
              type="button"
              aria-label={`Remove folder override for ${name}`}
              data-testid={`mcp-folder-chip-remove-${key}`}
              onClick={() => onRemoveOverride(name)}
              className="focus-ring px-1 min-h-11 min-w-11 sm:min-h-0 sm:min-w-0"
            >
              ✕
            </button>
          )}
        </SettingsStatusPill>
      )}
      {badges.map((b) => (
        <SettingsStatusPill key={b.key} tone="info" icon={null} testId={`mcp-override-badge-${key}-${b.key}`}>
          {b.text}
        </SettingsStatusPill>
      ))}
      {hasOverride && !narrow && onReset && (
        <button
          type="button"
          data-testid={`mcp-folder-reset-${key}`}
          disabled={pending || writeShadowed}
          onClick={() => onReset(name)}
          className={LINK}
        >
          Reset to global
        </button>
      )}
      {livePillInfo && (
        <SettingsStatusPill tone={livePillInfo.tone} testId={`mcp-live-${key}`} status={livePillInfo.status}>
          {livePillInfo.text}
        </SettingsStatusPill>
      )}
      {needsAuth && (
        <span data-testid={`mcp-signin-hint-${key}`} className="text-xs text-[var(--text-secondary)]">
          Sign in with <code>/mcp login {name}</code>
        </span>
      )}
      {server.adapterLeftovers.length > 0 && (!folder || server.provenance === "pi-folder") && (
        <span title={`pi ignores: ${server.adapterLeftovers.join(", ")}`}>
          <SettingsStatusPill tone="warning" testId={`mcp-leftovers-${key}`}>
            ignored by pi: {server.adapterLeftovers.join(", ")}
          </SettingsStatusPill>
        </span>
      )}
    </>
  );

  const actions = (
    <>
      {server.adapterLeftovers.length > 0 && (!folder || server.provenance === "pi-folder") && (
        <button
          type="button"
          aria-label={`Convert ${name} to pi's entry shape`}
          data-testid={`mcp-convert-${key}`}
          disabled={pending}
          onClick={() => void convert()}
          className={BTN}
        >
          Convert
        </button>
      )}
      {overrideRow ? (
        <button type="button" onClick={() => onRemoveOverride?.(name)} data-testid={actionTestId} className={BTN}>
          Remove
        </button>
      ) : globalRow || (legacyCopy && narrow) ? (
        <span className="relative">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={writeShadowed}
            title={writeShadowed ? "The folder entry of the same name is the folder-scope write target — edit that row" : undefined}
            onClick={() => setMenuOpen((o) => !o)}
            data-testid={`mcp-folder-menu-${key}`}
            className={BTN}
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
                  className={menuItemCls}
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
                  className={menuItemCls}
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
                className={menuItemCls}
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
                  className={menuItemCls}
                >
                  Convert to project override
                </button>
              )}
            </span>
          )}
        </span>
      ) : (
        <button type="button" onClick={() => onOpen(name, server.provenance)} data-testid={actionTestId} className={BTN}>
          {actionLabel}
        </button>
      )}
    </>
  );

  const hasNotes = Boolean(server.piError || pendingNote || legacyCopy || inactiveReason || error);

  return (
    <li data-testid={folder ? `mcp-folder-row-${key}` : `mcp-server-row-${name}`} className="mb-2">
      <SettingsItem
        title={
          <span className="inline-flex items-center gap-2">
            <RowSwitch
              name={name}
              testId={`mcp-server-toggle-${key}`}
              checked={enabled}
              pending={pending}
              disabled={writeShadowed || overrideRow}
              title={
                overrideRow
                  ? `No Pi global server named ${name} to override`
                  : writeShadowed
                    ? "The folder entry of the same name is the folder-scope write target"
                    : undefined
              }
              onToggle={(next) => void toggle(next)}
            />
            {name}
          </span>
        }
        subtitle={description ? <span data-testid={`mcp-server-description-${key}`}>{description}</span> : undefined}
        status={pills}
        actions={actions}
      >
        {hasNotes ? (
          <div className="space-y-2">
            {server.piError && (
              <SettingsNotice tone="error" testId={`mcp-pi-error-${key}`}>
                {server.piError}
              </SettingsNotice>
            )}
            {pendingNote && (
              <SettingsNotice tone="info" role="status" testId={`mcp-folder-pending-${key}`}>
                Saved — applies once the project is trusted. pi still runs <code>{name}</code> from Pi global here.
              </SettingsNotice>
            )}
            {legacyCopy && (
              <SettingsNotice
                tone="info"
                testId={`mcp-legacy-strip-${key}`}
                actions={
                  !narrow ? (
                    <button
                      type="button"
                      data-testid={`mcp-folder-convert-${key}`}
                      disabled={pending}
                      onClick={() => onConvertLegacy?.(name)}
                      className={BTN}
                    >
                      Convert to project override
                    </button>
                  ) : undefined
                }
              >
                <b>{t("mcpLegacyTitle", undefined, "Copied from Pi global by an older dashboard, without credentials.")}</b>{" "}
                {t("mcpLegacyBody", undefined, "A project override keeps the global credentials and only changes on/off here.")}
              </SettingsNotice>
            )}
            {inactiveReason && (
              <p data-testid={`mcp-inactive-${key}`} className="m-0 text-xs text-[var(--text-secondary)]">
                {inactiveReason}
              </p>
            )}
            {error && (
              <SettingsNotice tone="error" testId={`mcp-server-error-${key}`}>
                {error}
              </SettingsNotice>
            )}
          </div>
        ) : null}
      </SettingsItem>
    </li>
  );
}

function SkeletonRows(): React.ReactElement {
  return (
    <div data-testid="mcp-list-skeleton" className="space-y-2 py-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-5 rounded bg-[var(--bg-tertiary)] animate-pulse"
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
        <li key={l.path} className="mb-2">
          <SettingsNotice tone="warning" role="alert" testId="mcp-layer-error">
            <code>{l.path}</code>: {l.message} — pi skips this file.
          </SettingsNotice>
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
        <li
          data-testid="mcp-empty"
          className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border-secondary)] px-4 py-6 text-center"
        >
          <p className="m-0 text-sm font-semibold text-[var(--text-primary)]">
            {t("mcpEmptyState", undefined, "No MCP servers yet")}
          </p>
          {scope?.kind !== "project" && (
            <p className="m-0 text-xs text-[var(--text-secondary)]">
              {t(
                "mcpEmptyHelp",
                undefined,
                "Add a server to give sessions its tools. Servers are shared by every pi session on this computer.",
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={onAdd} data-testid="mcp-empty-add" className={BTN_PRIMARY}>
              {t("mcpAddServer", undefined, "Add server")}
            </button>
            <a
              href="https://github.com/earendil-works/pi/blob/main/docs/mcp.md"
              target="_blank"
              rel="noreferrer"
              data-testid="mcp-docs-link"
              className={LINK}
            >
              {t("mcpDocsLink", undefined, "How MCP configuration works")}
            </a>
          </div>
        </li>
      )}
    </ul>
  );
}
