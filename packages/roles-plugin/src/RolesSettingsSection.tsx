/**
 * BuiltInRolesSettings — roles editing UI, surfaced via the existing
 * `settings-section` slot under General tab.
 *
 * Roles AND models are GLOBAL in pi-flows / pi-coding-agent (single
 * `~/.pi/agent/providers.json`, single ModelRegistry per pi process). The
 * dashboard piggybacks on the existing `usePluginConfig` plumbing — every
 * other plugin's settings UI uses it — by having `useMessageHandler` route
 * incoming `roles_list` and `models_list` payloads through
 * `applyPluginConfigUpdate({ id: "roles", config: ... })`. The component
 * reads via `usePluginConfig<BuiltinsConfig>()`. No new context primitive,
 * no per-session keying, no sentinel session id.
 *
 * Reuses the pre-existing role protocol (`role_set`, `role_preset_load`,
 * `role_preset_save`, `role_preset_delete`); no new WS messages are
 * introduced.
 *
 * **Deferred persistence (change: defer-role-persistence-with-save-reload).**
 * Picking a role no longer dispatches `role_set` immediately. Picks accumulate
 * in local `pending` state; a dirty marker renders per pill; the user clicks
 * Save to flush `pending` as per-role `role_set` dispatches, or Reload to
 * discard and re-read from disk via `request_roles`.
 *
 * See change: fix-pi-flows-end-to-end (Group 5 — global roles refactor).
 * See change: defer-role-persistence-with-save-reload.
 */
import React, { useState, useEffect } from "react";
import {
  usePluginConfig,
  usePluginSend,
  useAllSessions,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { useUiPrimitive, useSettingsDraftSource } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";

interface ModelInfo {
  provider: string;
  /** pi-coding-agent shape uses `id`; full label is `<provider>/<id>`. */
  id: string;
}

/**
 * Read-time migration helper for legacy bare-id role values.
 *
 * Before `add-ui-model-selector-primitive`, the inline picker stripped
 * the provider prefix on save, so older `~/.pi/agent/providers.json#roles`
 * entries store bare ids like `"deepseek-v4-flash"`. This helper resolves
 * those for display only — it does NOT mutate the file. On the user's
 * next role pick, the canonical `"provider/id"` form is written.
 *
 * @param stored  Persisted role value (may be bare or `provider/id`).
 * @param models  Live models list (may be empty during first render).
 * @returns       Best-effort `provider/id` label, or `stored` unchanged.
 */
export function inferProviderForBareId(
  stored: string,
  models: ModelInfo[],
): string {
  if (!stored || stored.includes("/")) return stored;
  const match = models.find((m) => m.id === stored);
  return match ? `${match.provider}/${stored}` : stored;
}

/**
 * Pure helper: `pending` overlaid on `rolesMap`, pending wins.
 * Source of truth for what each role pill displays.
 *
 * Exported for unit testing.
 */
export function computeEffectiveRoles(
  rolesMap: Record<string, string>,
  pending: Record<string, string>,
): Record<string, string> {
  return { ...rolesMap, ...pending };
}

/**
 * Pure helper: the set of role keys whose pending value differs from the
 * persisted (server) value. A `pending[role]` that equals `rolesMap[role]`
 * is NOT counted as dirty (round-trip clean).
 *
 * Exported for unit testing.
 */
export function computeDirtyRoles(
  rolesMap: Record<string, string>,
  pending: Record<string, string>,
): string[] {
  const out: string[] = [];
  for (const role of Object.keys(pending)) {
    if (pending[role] !== rolesMap[role]) out.push(role);
  }
  return out;
}

/**
 * Plugin config shape for the built-ins plugin. Populated by
 * `useMessageHandler` routing `roles_list` and `models_list` WS payloads
 * through `applyPluginConfigUpdate({id: "roles", ...})`.
 */
interface BuiltinsConfig {
  roles?: Record<string, string>;
  presets?: Array<{ name: string; roles: Record<string, string> }>;
  activePreset?: string | null;
  models?: ModelInfo[];
}

function shortModel(fullId: string): string {
  const parts = fullId.split("/");
  return parts[parts.length - 1];
}

export function BuiltInRolesSettings() {
  const cfg = usePluginConfig<BuiltinsConfig>();
  const send = usePluginSend();
  // pi-flows roles are GLOBAL, but the server's WS routing forwards
  // role_set / role_preset_* messages to a specific pi session by id
  // (`piGateway.sendToSession(msg.sessionId, ...)`). The bridge handler
  // there ignores the routed sessionId and emits roles:* on its own
  // session's pi.events bus — any live session works as a transport.
  // Pick the first non-ended session as the routing target.
  const allSessions = useAllSessions();
  const liveSessionId =
    allSessions.find((s) => (s as any).status !== "ended")?.id;

  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);

  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");

  // Pending (unsaved) role picks. Key = role name; value = full
  // "provider/id" label as emitted by ui:model-selector. Entry exists
  // only when the user has actively picked a value; entries are pruned
  // automatically when they round-trip back to the server value (below).
  //
  // See change: defer-role-persistence-with-save-reload (D1).
  const [pending, setPending] = useState<Record<string, string>>({});

  const rolesMap = cfg?.roles ?? {};
  const presets = cfg?.presets ?? [];
  const activePreset = cfg?.activePreset ?? null;
  const models = cfg?.models ?? [];

  // Auto-clean pending entries that match the freshly-arrived server
  // state. Covers Save-ack reconciliation AND external edits to
  // providers.json (or another browser tab). Conflicting pending entries
  // are preserved so the user can choose to re-Save or Reload.
  //
  // See change: defer-role-persistence-with-save-reload (D6).
  useEffect(() => {
    setPending((prev) => {
      let changed = false;
      const next: Record<string, string> = {};
      for (const [role, val] of Object.entries(prev)) {
        if (rolesMap[role] === val) {
          changed = true;
          continue;
        }
        next[role] = val;
      }
      return changed ? next : prev;
    });
  }, [rolesMap]);

  const dirtyRoles = computeDirtyRoles(rolesMap, pending);
  const isDirty = dirtyRoles.length > 0;
  const effective = (role: string) => pending[role] ?? rolesMap[role];
  const isAssigned = (role: string) => {
    const v = effective(role);
    return typeof v === "string" && v.trim() !== "";
  };

  // Shadow-disabled state: the back-end overlays default role names
  // (planning/coding/compact/fast/vision/research) so `rolesMap` is
  // populated even on a fresh install. "Set up" means at least one role
  // has an assigned model (persisted or pending). Until then we show a
  // setup banner instead of the legacy empty-state.
  // See change: roles-standalone-defaults-and-local-install-detection.
  const hasAnyAssigned = Object.keys(rolesMap).some((role) => isAssigned(role));

  const dispatch = (msg: unknown) => send(msg);

  /**
   * Stage a role assignment in local `pending` state. No WS dispatch.
   *
   * If the picked value equals the persisted value, the role's entry is
   * removed from `pending` (round-trip clean). The picker closes, the
   * pill renders with the picked value and the dirty marker until Save.
   *
   * See change: defer-role-persistence-with-save-reload (D5).
   */
  function setRole(role: string, modelLabel: string) {
    setPending((prev) => {
      if (modelLabel === rolesMap[role]) {
        const { [role]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [role]: modelLabel };
    });
    setEditingRole(null);
  }

  /**
   * Flush pending role changes: dispatch one `role_set` per dirty role,
   * then optimistically clear `pending`. The inbound `roles_list` ack
   * will auto-clean matching entries (D6); any role that didn't actually
   * land (rare — server writes are sync) will remain absent from the
   * server state, so the next render with the same `rolesMap` will not
   * re-add it to pending — the user must re-pick.
   *
   * See change: defer-role-persistence-with-save-reload (D2).
   */
  function flushPending() {
    if (!liveSessionId) return;
    for (const role of dirtyRoles) {
      const newVal = pending[role];
      const slashIdx = newVal.indexOf("/");
      const provider = slashIdx > 0 ? newVal.slice(0, slashIdx) : "";
      dispatch({
        type: "role_set",
        sessionId: liveSessionId,
        role,
        provider,
        modelId: newVal,
      });
    }
    setPending({});
  }

  // Buffered source: pending role picks persist via the host Settings panel's
  // unified Save (no section-local Save/Reload toolbar). commit flushes the
  // staged role_set dispatches; reset discards pending (revert to disk state).
  // The rolesMap effect above still auto-reconciles inbound acks/external edits.
  // See change: unify-settings-save-contract.
  const commit = async () => {
    if (!liveSessionId) throw new Error("No live pi session to apply role changes");
    flushPending();
  };
  const reset = () => setPending({});
  useSettingsDraftSource({ id: "plugin:roles", page: "general", isDirty, commit, reset });

  function loadPreset(name: string) {
    if (!liveSessionId) return;
    // If unsaved edits exist, confirm before switching preset
    // (preset load wholesale replaces config.roles). See D7.
    if (isDirty) {
      const ok = typeof window !== "undefined"
        ? window.confirm("Discard unsaved role changes?")
        : true;
      if (!ok) return;
      setPending({});
    }
    dispatch({
      type: "role_preset_load",
      sessionId: liveSessionId,
      presetName: name,
    });
  }

  function savePreset(name: string) {
    if (!liveSessionId) return;
    // "Save current as preset" snapshots config.roles on the server,
    // so unsaved edits must be flushed first to be captured. See D8.
    if (isDirty) flushPending();
    dispatch({
      type: "role_preset_save",
      sessionId: liveSessionId,
      presetName: name,
    });
    setSavingPreset(false);
    setPresetName("");
  }

  function deletePreset(name: string) {
    if (!liveSessionId) return;
    dispatch({
      type: "role_preset_delete",
      sessionId: liveSessionId,
      presetName: name,
    });
  }

  return (
    <section
      data-testid="roles-settings"
      className="border border-[var(--border-primary)] rounded-lg p-4 space-y-3"
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Roles
        </h3>
        <span className="text-[10px] text-[var(--text-muted)]">
          global role → model assignments
        </span>
      </div>

      {/* Setup banner (shadow-disabled state): a small error message shown
          until at least one role has an assigned model. Replaces the legacy
          "install pi-flows" empty-state — roles are owned by the dashboard now.
          See change: roles-standalone-defaults-and-local-install-detection. */}
      {!hasAnyAssigned && (
        <div
          data-testid="roles-settings-setup-banner"
          className="text-[11px] text-[var(--accent-warning,#f59e0b)] border border-[var(--border-secondary)] rounded px-2 py-1.5 bg-[var(--bg-tertiary)]"
        >
          No roles have been set up — set up now by assigning a model to a role below.
        </div>
      )}

      {/* Preset row.
          Preset chips use an inline-flex wrapper holding a load <button> and
          a separate circular delete <button>. The delete control has its own
          left margin + rounded hover target so the × is not cramped against
          the preset name via segment padding (px-2.5 label / px-2 ×), so the
          × is not cramped (see change: roles-standalone-defaults-and-local-install-detection). */}
      <div className="flex items-center gap-2 flex-wrap">
        {presets.map((preset) => {
          const isActive = activePreset === preset.name;
          return (
            <span
              key={preset.name}
              className={`inline-flex items-stretch shrink-0 overflow-hidden rounded-md text-[11px] transition-colors ${
                isActive
                  ? "bg-[var(--accent-blue)] text-white"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <button
                data-testid={`roles-preset-load-${preset.name}`}
                onClick={() => loadPreset(preset.name)}
                className={`px-2.5 py-1 transition-colors ${
                  isActive ? "text-white" : "hover:text-[var(--text-primary)]"
                }`}
              >
                {preset.name}
              </button>
              <button
                data-testid={`roles-preset-delete-${preset.name}`}
                onClick={(e) => { e.stopPropagation(); deletePreset(preset.name); }}
                className={`flex items-center justify-center px-2 leading-none text-[12px] transition-colors ${
                  isActive
                    ? "text-white/70 hover:text-white hover:bg-white/15"
                    : "text-[var(--text-muted)] hover:text-[var(--accent-red)] hover:bg-[var(--bg-hover)]"
                }`}
                aria-label={`Delete preset ${preset.name}`}
                title={`Delete preset "${preset.name}"`}
              >
                ×
              </button>
            </span>
          );
        })}
        {!savingPreset && (
          <button
            data-testid="roles-preset-save-new"
            onClick={() => { setSavingPreset(true); setPresetName(""); }}
            className="px-2.5 py-1 text-[11px] rounded-md shrink-0 bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            + Save current as preset
          </button>
        )}
        {savingPreset && (
          <span className="flex flex-col gap-1 shrink-0">
            <span className="flex items-center gap-1">
              <input
                autoFocus
                data-testid="roles-preset-name-input"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && presetName.trim()) savePreset(presetName.trim());
                  else if (e.key === "Escape") { setSavingPreset(false); setPresetName(""); }
                }}
                placeholder="preset name…"
                className="w-32 px-2 py-0.5 text-[11px] bg-[var(--bg-tertiary)] border border-[var(--accent-blue)] rounded text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none"
              />
              <button
                data-testid="roles-preset-save-confirm"
                onClick={() => { if (presetName.trim()) savePreset(presetName.trim()); }}
                className="text-[11px] text-[var(--accent-blue)] hover:text-[var(--text-primary)]"
              >
                ✓
              </button>
            </span>
            {isDirty && (
              <span
                data-testid="roles-preset-save-dirty-hint"
                className="text-[10px] text-[var(--text-muted)]"
              >
                Unsaved edits will be saved first.
              </span>
            )}
          </span>
        )}
      </div>

      {/* Role grid (compact pills). Each pill: @role + effective model
          (pending overlaid on persisted). Unconfigured roles show an
          "+ Add model" affordance in accent; the setup banner above is the
          accompanying error message. Legacy bare-id entries migrated for
          display via inferProviderForBareId.
          See change: roles-standalone-defaults-and-local-install-detection. */}
      <div className="grid grid-cols-2 gap-1">
        {Object.keys(rolesMap).map((role) => {
          const isEditing = editingRole === role;
          const dirty = role in pending && pending[role] !== rolesMap[role];
          const assigned = isAssigned(role);
          const displayLabel = inferProviderForBareId(effective(role), models);
          return (
            <button
              key={role}
              data-testid={`roles-row-${role}`}
              onClick={() => setEditingRole(isEditing ? null : role)}
              className={`flex items-center gap-2 px-2 py-1 rounded text-left min-w-0 transition-all ${
                isEditing
                  ? "bg-[color-mix(in_srgb,var(--accent-blue)_25%,transparent)] outline outline-2 outline-[var(--accent-blue)]"
                  : "bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)]"
              }`}
              title={assigned ? displayLabel : `Set a model for @${role}`}
            >
              <span className={`text-[11px] font-semibold shrink-0 ${isEditing ? "text-[var(--accent-blue)]" : "text-[var(--accent-blue)]/70"}`}>
                @{role}
              </span>
              {assigned ? (
                <span className="text-[11px] text-[var(--text-muted)] font-mono truncate flex-1">
                  {shortModel(displayLabel)}
                </span>
              ) : (
                <span className="text-[11px] text-[var(--accent-blue)] truncate flex-1">
                  + Add model
                </span>
              )}
              {dirty && (
                <span
                  data-testid={`roles-row-${role}-dirty`}
                  aria-label="unsaved"
                  className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--accent-warning,#f59e0b)] shrink-0"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Shared `ui:model-selector` primitive when a role is being edited.
          The primitive emits the full `"<provider>/<id>"` label on select;
          `setRole` stages it in pending — no WS dispatch until Save. */}
      {editingRole && (
        <div data-testid="roles-model-picker" className="border border-[var(--border-primary)] rounded p-2">
          <div className="text-[11px] text-[var(--text-muted)] mb-1">
            Assign model to <span className="font-semibold text-[var(--accent-blue)]">@{editingRole}</span>
          </div>
          <ModelSelectorPrimitive
            current={inferProviderForBareId(effective(editingRole), models)}
            models={models}
            onSelect={(modelLabel: string) => setRole(editingRole, modelLabel)}
          />
        </div>
      )}
    </section>
  );
}
