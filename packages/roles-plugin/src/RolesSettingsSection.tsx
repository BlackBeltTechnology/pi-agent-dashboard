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

import { RoleRef, type RoleRefLabels, useSettingsDraftSource, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import {
  useAllSessions,
  usePluginConfig,
  usePluginSend,
} from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { isValidRoleName } from "@blackbelt-technology/pi-dashboard-shared/role-name-validation.js";
import { THINKING_LEVELS } from "@blackbelt-technology/pi-dashboard-shared/role-schema.js";
import { mdiAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useState } from "react";

interface ModelInfo {
  provider: string;
  /** pi-coding-agent shape uses `id`; full label is `<provider>/<id>`. */
  id: string;
  /** Levels this model advertises (pi 0.72+ per-model `thinkingLevelMap`).
   *  Already carried by the `models_list` payload — no protocol change.
   *  See change: add-default-thinking-level. */
  supportedThinkingLevels?: string[];
}

/**
 * Canonical thinking levels, in pi's own order. `off` is the NO-OVERRIDE
 * option here: a role ref carries a level only when the user picked a real
 * one, so `off` writes a bare ref and lets pi's own default stand.
 * See change: add-default-thinking-level.
 */

/**
 * Split a role ref into its model base and optional thinking level.
 *
 * The level rides the EXISTING ref string as a `:<level>` suffix (pi parses
 * it with the same `splitThinkingSuffix` rule), so roles never grow a second
 * field that could drift from `/roles`-written values.
 *
 * Only a CANONICAL level tail is split off — provider ids legitimately
 * contain `:` (e.g. `openrouter/vendor:free`), and those must survive.
 *
 * See change: add-default-thinking-level (design D7).
 */
export function splitRefLevel(ref: string): { base: string; level?: string } {
  const idx = ref.lastIndexOf(":");
  if (idx <= 0) return { base: ref };
  const tail = ref.slice(idx + 1);
  if (!(THINKING_LEVELS as readonly string[]).includes(tail)) return { base: ref };
  return { base: ref.slice(0, idx), level: tail };
}

/** Inverse of {@link splitRefLevel}. `off`/undefined write a bare ref. */
export function joinRefLevel(base: string, level?: string): string {
  if (!base || !level || level === "off") return base;
  return `${base}:${level}`;
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
 * Pill container classes: `rounded-l` when a × button follows. The selected pill
 * is painted with the `--tint-blue-*` family (the role-ref text stays
 * `--text-primary`, measured on the tint) — never accent-as-text.
 * See change: retro-ux-model-selector.
 */
function pillClass(isCustom: boolean, selected: boolean): string {
  const shape = isCustom ? "rounded-l" : "rounded";
  const state = selected
    ? "bg-[var(--tint-blue-bg)] border border-[var(--tint-blue-border)]"
    : "bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] hover:bg-[var(--bg-hover)]";
  return `focus-ring flex items-center gap-2 px-2 tap-target text-left min-w-0 flex-1 ${shape} ${state}`;
}

/** Warning-severity pill recipe (status words: "Unsaved", "Detached", …). */
const WARNING_PILL =
  "inline-flex items-center flex-none rounded-full border px-1.5 py-0.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]";

/** Warning-severity callout recipe (icon + sentence). */
const WARNING_CALLOUT =
  "flex items-start gap-1.5 rounded-md border px-2 py-1.5 text-xs bg-[var(--severity-warning-bg)] border-[var(--severity-warning-border)] text-[var(--severity-warning-fg)]";

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
 * Pure helper: split the render-set (union of persisted role keys and
 * pending-only unsaved names, deduped) into built-in vs custom groups.
 *
 * - `builtin`: names present in `builtinRoleNames`, ORDERED by
 *   `builtinRoleNames` (the canonical DEFAULT_ROLE_NAMES order from the
 *   bridge), not by rolesMap insertion order.
 * - `custom`: names absent from `builtinRoleNames`, sorted alphabetically
 *   for a stable render.
 *
 * When `builtinRoleNames` is empty (older bridge that doesn't send the field),
 * every name lands in `custom` and the component renders one flat group.
 *
 * Exported for unit testing. See change: add-custom-roles-ui (design D1/D2).
 */
export function computeRoleGroups(
  rolesMap: Record<string, string>,
  pending: Record<string, string>,
  builtinRoleNames: string[],
): { builtin: string[]; custom: string[] } {
  const union = new Set<string>([
    ...Object.keys(rolesMap),
    ...Object.keys(pending),
  ]);
  const builtinSet = new Set(builtinRoleNames);
  const builtin = builtinRoleNames.filter((n) => union.has(n));
  const custom = [...union].filter((n) => !builtinSet.has(n)).sort();
  return { builtin, custom };
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
  /**
   * Built-in (seeded default) role names from the bridge. Absent on older
   * bridges → `[]` → the grid renders one flat group (back-compat).
   * See change: add-custom-roles-ui (design D2).
   */
  builtinRoleNames?: string[];
}

/** One "follows this role" entry from `GET /api/roles/used-by`. */
interface UsedByEntry {
  kind: "binding" | "usage";
  owner: string;
  label: string;
  status?: "ok" | "detached" | "dangling";
}

/**
 * role → what follows it. Re-fetched whenever the role map changes (a preset
 * load/assignment), so the list is current BEFORE the user makes the next
 * change. Any failure → empty (the overview is informational, never blocking).
 * See change: add-role-aware-model-refs.
 */
function useRoleUsedBy(rolesMap: Record<string, string>): Record<string, UsedByEntry[]> {
  const [usedBy, setUsedBy] = useState<Record<string, UsedByEntry[]>>({});
  const key = JSON.stringify(rolesMap);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the serialized rolesMap.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/roles/used-by");
        if (!res.ok) return;
        const body = (await res.json()) as { usedBy?: Record<string, UsedByEntry[]> };
        if (!cancelled) setUsedBy(body.usedBy ?? {});
      } catch {
        /* inert without the roles server */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);
  return usedBy;
}

export function BuiltInRolesSettings() {
  const t = useT();
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

  const roleRefLabels: RoleRefLabels = {
    noModel: t("noModelAssigned", undefined, "No model assigned"),
    thinking: t("roleRefThinking", undefined, "thinking"),
  };

  const ModelSelectorPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.modelSelector);
  const ThinkingLevelPrimitive = useUiPrimitive(UI_PRIMITIVE_KEYS.thinkingLevelSelector);

  const [editingRole, setEditingRole] = useState<string | null>(null);
  // Set when a model pick silently cleared a level the new model can't do.
  // The staged value changed underneath the user, so the picker says so
  // instead of saving something else. Keyed BY ROLE so the notice cannot leak
  // onto the next role opened. See change: add-default-thinking-level.
  const [dropped, setDropped] = useState<{ role: string; level: string } | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  // Add-custom-role flow: an inline @-prefixed name input that, on a valid
  // name, opens the model picker scoped to the new name. Nothing persists
  // until a model is picked and the unified Save flushes it as a role_set.
  // See change: add-custom-roles-ui (design D1).
  const [addingRole, setAddingRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  // Pending (unsaved) role picks. Key = role name; value = full
  // "provider/id" label as emitted by ui:model-selector. Entry exists
  // only when the user has actively picked a value; entries are pruned
  // automatically when they round-trip back to the server value (below).
  //
  // See change: defer-role-persistence-with-save-reload (D1).
  const [pending, setPending] = useState<Record<string, string>>({});

  const rolesMap = cfg?.roles ?? {};
  const usedBy = useRoleUsedBy(rolesMap);
  const presets = cfg?.presets ?? [];
  const activePreset = cfg?.activePreset ?? null;
  const models = cfg?.models ?? [];
  const builtinRoleNames = cfg?.builtinRoleNames ?? [];

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

  // Discard with a stated handler at the single dispatch seam — a dropped role
  // message silently leaves the UI showing a change the server never applied.
  // See change: cleanup-client-plugin-promises.
  const dispatch = (msg: unknown): void => {
    void Promise.resolve(send(msg)).catch((err: unknown) => {
      console.error("[roles-plugin] role dispatch failed:", err);
    });
  };

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
  }

  /**
   * Model pick. Keeps the staged level when the new model supports it, drops
   * the suffix (and explains why) when it does not. The picker stays OPEN so
   * the paired level control remains reachable after the pick.
   * See change: add-default-thinking-level.
   */
  function setRoleModel(role: string, modelLabel: string) {
    const { level } = splitRefLevel(effective(role) ?? "");
    const picked = models.find((m) => `${m.provider}/${m.id}` === modelLabel);
    const supported = picked?.supportedThinkingLevels;
    const keep = level && (!supported?.length || supported.includes(level));
    setDropped(level && !keep ? { role, level } : null);
    setRole(role, joinRefLevel(modelLabel, keep ? level : undefined));
  }

  /**
   * Level pick. Restages the SAME base ref with the new suffix. The base runs
   * through `inferProviderForBareId` first: a legacy bare-id role value would
   * otherwise be re-staged bare and flushed with an empty `provider`.
   */
  function setRoleLevel(role: string, level: string) {
    const { base } = splitRefLevel(effective(role) ?? "");
    setDropped(null);
    setRole(role, joinRefLevel(inferProviderForBareId(base, models), level));
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
    if (!liveSessionId)
      throw new Error(t("noLiveSession", undefined, "No live pi session to apply role changes"));
    flushPending();
  };
  const reset = () => setPending({});
  useSettingsDraftSource({ id: "plugin:roles", isDirty, commit, reset });

  function loadPreset(name: string) {
    if (!liveSessionId) return;
    // If unsaved edits exist, confirm before switching preset
    // (preset load wholesale replaces config.roles). See D7.
    if (isDirty) {
      const ok = typeof window !== "undefined"
        ? window.confirm(t("discardUnsavedRoleChanges", undefined, "Discard unsaved role changes?"))
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

  // Render-set split into Built-in vs Custom groups over the UNION of persisted
  // role keys and pending-only unsaved names. See change: add-custom-roles-ui.
  const roleGroups = computeRoleGroups(rolesMap, pending, builtinRoleNames);

  /**
   * Remove a CUSTOM role. Immediate + confirmed (mirrors preset delete), NOT
   * staged through the Save buffer — removal is a cross-preset purge, so
   * coupling it to the model-assignment Save would make a destructive op
   * silently pending. Any staged pending pick for the role is dropped so it
   * can't resurrect a just-removed name. See change: add-custom-roles-ui (D3).
   */
  function removeCustomRole(role: string) {
    const ok = typeof window !== "undefined"
      ? window.confirm(
          t(
            "removeCustomRoleConfirm",
            { role },
            `Remove custom role @${role}? This deletes it from every preset.`,
          ),
        )
      : true;
    if (!ok) return;
    setPending((prev) => {
      if (!(role in prev)) return prev;
      const { [role]: _drop, ...rest } = prev;
      return rest;
    });
    if (editingRole === role) setEditingRole(null);
    if (liveSessionId) {
      dispatch({ type: "role_remove", sessionId: liveSessionId, role });
    }
  }

  /** Render one compact role pill (built-in or custom). */
  const renderRolePill = (role: string) => {
    const isEditing = editingRole === role;
    const dirty = role in pending && pending[role] !== rolesMap[role];
    const assigned = isAssigned(role);
    const { base: refBase, level: refLevel } = splitRefLevel(effective(role) ?? "");
    const displayLabel = inferProviderForBareId(refBase, models);
    // A role is removable (custom) ONLY when the bridge advertised the built-in
    // set. With an older bridge (`builtinRoleNames` empty) we cannot tell
    // built-ins from custom, so per the "built-ins permanent" locked decision
    // NO pill shows × in that back-compat flat-render mode.
    // See change: add-custom-roles-ui.
    const isCustom = builtinRoleNames.length > 0 && !builtinRoleNames.includes(role);
    const mainButton = (
      <button
        key={role}
        data-testid={`roles-row-${role}`}
        onClick={() => setEditingRole(isEditing ? null : role)}
        className={pillClass(isCustom, isEditing)}
        title={assigned ? displayLabel : t("setModelForRole", { role }, `Set a model for @${role}`)}
      >
        <RoleRef role={`@${role}`} model={assigned ? displayLabel : undefined} level={refLevel} labels={roleRefLabels} />
        {dirty && (
          <span data-testid={`roles-row-${role}-dirty`} className={`${WARNING_PILL} ml-auto`}>
            {t("unsaved", undefined, "Unsaved")}
          </span>
        )}
      </button>
    );
    // Built-in pills are permanent — no × (locked decision). Custom pills wrap
    // the main button + a separate × (nested <button> is invalid HTML).
    if (!isCustom) return mainButton;
    return (
      <span
        key={role}
        className="inline-flex items-stretch overflow-hidden rounded min-w-0"
      >
        {mainButton}
        <button
          data-testid={`roles-row-${role}-remove`}
          onClick={(e) => { e.stopPropagation(); removeCustomRole(role); }}
          className="focus-ring flex items-center justify-center min-w-[44px] sm:min-w-[32px] leading-none text-sm bg-[var(--bg-tertiary)] border border-l-0 border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          aria-label={t("removeCustomRoleLabel", { role }, `Remove custom role @${role}`)}
          title={t("removeCustomRoleLabel", { role }, `Remove custom role @${role}`)}
        >
          ×
        </button>
      </span>
    );
  };

  // Add-custom-role control. The set of names a new role must not collide with
  // is the render union (built-ins + persisted custom + pending). Validation is
  // the SHARED isValidRoleName helper — identical to the bridge trust boundary.
  const effectiveNames = Array.from(
    new Set([...Object.keys(rolesMap), ...Object.keys(pending), ...builtinRoleNames]),
  );
  const addValidation = isValidRoleName(newRoleName, effectiveNames);
  const showAddHint = newRoleName.trim() !== "" && !addValidation.ok;

  function cancelAddRole() {
    setAddingRole(false);
    setNewRoleName("");
  }

  /** On a valid name, open the model picker scoped to the new name (D1). */
  function confirmAddRole() {
    if (!addValidation.ok) return;
    const trimmed = newRoleName.trim();
    setEditingRole(trimmed);
    setAddingRole(false);
    setNewRoleName("");
  }

  const addRoleControl: React.ReactNode = addingRole ? (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-1">
        <span className="text-xs font-semibold text-[var(--text-primary)]">@</span>
        <input
          autoFocus
          data-testid="roles-add-custom-input"
          value={newRoleName}
          onChange={(e) => setNewRoleName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") confirmAddRole();
            else if (e.key === "Escape") cancelAddRole();
          }}
          placeholder={t("customRoleNamePlaceholder", undefined, "custom-role-name…")}
          className="w-40 px-2 tap-target text-xs bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
        />
        <button
          data-testid="roles-add-custom-confirm"
          disabled={!addValidation.ok}
          onClick={confirmAddRole}
          className="focus-ring min-w-[44px] sm:min-w-[32px] tap-target text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded disabled:opacity-40 disabled:cursor-not-allowed"
          title={t("pickModelForRole", undefined, "Pick a model for this role")}
        >
          ✓
        </button>
        <button
          data-testid="roles-add-custom-cancel"
          onClick={cancelAddRole}
          className="focus-ring min-w-[44px] sm:min-w-[32px] tap-target text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
          aria-label={t("cancelAddCustomRole", undefined, "Cancel add custom role")}
        >
          ✕
        </button>
      </span>
      {showAddHint && (
        <span
          data-testid="roles-add-custom-hint"
          className="inline-flex self-start rounded-md border px-2 py-0.5 text-xs bg-[var(--severity-error-bg)] border-[var(--severity-error-border)] text-[var(--severity-error-fg)]"
        >
          ✗ {addValidation.reason}
        </span>
      )}
    </div>
  ) : (
    <button
      data-testid="roles-add-custom"
      onClick={() => { setAddingRole(true); setNewRoleName(""); }}
      className="focus-ring px-2 tap-target text-xs rounded text-left bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
    >
      {t("addCustomRole", undefined, "+ Add custom role")}
    </button>
  );

  // No self-header: the host owns the chrome on `/settings/plugins/roles`, so a
  // second `<section>`/`<h3>` here would double-header (design D1).
  // See change: plugin-settings-pages.
  return (
    <div data-testid="roles-settings" className="space-y-3">
      <p className="m-0 text-xs text-[var(--text-secondary)]">
        {t("rolesSubheading", undefined, "global role → model assignments")}
      </p>

      {/* Setup banner (shadow-disabled state): a small error message shown
          until at least one role has an assigned model. Replaces the legacy
          "install pi-flows" empty-state — roles are owned by the dashboard now.
          See change: roles-standalone-defaults-and-local-install-detection. */}
      {!hasAnyAssigned && (
        <div data-testid="roles-settings-setup-banner" role="status" className={WARNING_CALLOUT}>
          <Icon path={mdiAlertOutline} size={0.55} className="flex-shrink-0 mt-0.5" aria-hidden />
          <span>
            {t(
              "setupBanner",
              undefined,
              "No roles have been set up — set up now by assigning a model to a role below.",
            )}
          </span>
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
              className={`inline-flex items-stretch shrink-0 overflow-hidden rounded-md text-xs transition-colors ${
                isActive
                  ? "bg-[var(--accent-solid)] text-white"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <button
                data-testid={`roles-preset-load-${preset.name}`}
                onClick={() => loadPreset(preset.name)}
                className={`focus-ring px-2.5 tap-target transition-colors ${
                  isActive ? "text-white" : "hover:text-[var(--text-primary)]"
                }`}
              >
                {preset.name}
              </button>
              <button
                data-testid={`roles-preset-delete-${preset.name}`}
                onClick={(e) => { e.stopPropagation(); deletePreset(preset.name); }}
                className={`focus-ring flex items-center justify-center min-w-[44px] sm:min-w-[32px] leading-none text-sm transition-colors ${
                  isActive
                    ? "text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                }`}
                aria-label={t("deletePresetLabel", { name: preset.name }, `Delete preset ${preset.name}`)}
                title={t("deletePresetTitle", { name: preset.name }, `Delete preset "${preset.name}"`)}
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
            className="focus-ring px-2.5 tap-target text-xs rounded-md shrink-0 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          >
            {t("saveCurrentAsPreset", undefined, "+ Save current as preset")}
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
                placeholder={t("presetNamePlaceholder", undefined, "preset name…")}
                className="w-32 px-2 tap-target text-xs bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded text-[var(--text-primary)] placeholder-[var(--text-secondary)] focus:outline-none focus:border-[var(--accent-blue)]"
              />
              <button
                data-testid="roles-preset-save-confirm"
                onClick={() => { if (presetName.trim()) savePreset(presetName.trim()); }}
                className="focus-ring min-w-[44px] sm:min-w-[32px] tap-target text-xs text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
              >
                ✓
              </button>
            </span>
            {isDirty && (
              <span
                data-testid="roles-preset-save-dirty-hint"
                className="text-xs text-[var(--text-secondary)]"
              >
                {t("unsavedEditsSavedFirst", undefined, "Unsaved edits will be saved first.")}
              </span>
            )}
          </span>
        )}
      </div>

      {/* Role grid (compact pills), split into Built-in vs Custom groups.
          Each pill: @role + effective model (pending overlaid on persisted).
          Unconfigured roles show an "+ Add model" affordance in accent; the
          setup banner above is the accompanying error message. Legacy bare-id
          entries migrated for display via inferProviderForBareId.
          The render-set is the UNION of persisted role keys and pending-only
          (unsaved) custom names so an in-flight custom pill shows with its
          dirty marker before Save.
          See change: add-custom-roles-ui (design D1/D2). */}
      {builtinRoleNames.length === 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          {[...roleGroups.builtin, ...roleGroups.custom].map(renderRolePill)}
        </div>
      ) : (
        <div className="space-y-3">
          <div data-testid="roles-group-builtin" className="space-y-1">
            <div className="text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("builtinGroup", undefined, "Built-in")}
            </div>
            {/* Single column below sm: the `:level` chip leaves too little room
                for the model name in two columns at phone width. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
              {roleGroups.builtin.map(renderRolePill)}
            </div>
          </div>
          <div data-testid="roles-group-custom" className="space-y-1">
            <div className="text-[12px] font-semibold text-[var(--text-secondary)]">
              {t("customGroup", undefined, "Custom")}
            </div>
            {roleGroups.custom.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                {roleGroups.custom.map(renderRolePill)}
              </div>
            )}
            {addRoleControl}
          </div>
        </div>
      )}

      {/* "Used by": every projector binding and resolve-at-use reference that
          follows each role, so the impact of a role/preset change is visible
          before it is made. See change: add-role-aware-model-refs. */}
      {Object.keys(usedBy).length > 0 && (
        <div data-testid="roles-used-by" className="space-y-1">
          <div className="text-[12px] font-semibold text-[var(--text-secondary)]">
            {t("usedByHeading", undefined, "Used by")}
          </div>
          <ul className="m-0 p-0 list-none space-y-0.5">
            {Object.entries(usedBy).map(([role, entries]) => (
              <li key={role} data-testid={`roles-used-by-${role}`} className="text-xs text-[var(--text-secondary)] flex flex-wrap items-center gap-x-2 gap-y-1">
                {(() => {
                  const { base, level } = splitRefLevel(effective(role) ?? "");
                  const resolved = isAssigned(role) ? inferProviderForBareId(base, models) : undefined;
                  return <RoleRef role={`@${role}`} model={resolved} level={level} labels={roleRefLabels} />;
                })()}
                {entries.map((e) => (
                  <span
                    key={`${e.kind}:${e.owner}:${e.label}`}
                    data-testid={`roles-used-by-${role}-${e.owner}`}
                    data-status={e.status ?? ""}
                    className="inline-flex items-center gap-1.5"
                  >
                    {e.owner} · {e.label}
                    {e.status === "detached" && <span className={WARNING_PILL}>{t("statusDetached", undefined, "Detached")}</span>}
                    {e.status === "dangling" && (
                      <span className={WARNING_PILL}>{t("statusDangling", undefined, "Role unassigned, keeps its last model")}</span>
                    )}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Shared `ui:model-selector` primitive when a role is being edited.
          The primitive emits the full `"<provider>/<id>"` label on select;
          `setRole` stages it in pending — no WS dispatch until Save. */}
      {editingRole && (() => {
        // The level rides the ref, so the pair is ONE decision: model left,
        // level right, in one enclosure, with the ref that will be saved
        // echoed below it. See openspec/changes/add-default-thinking-level/
        // mockups/ui-plan.md (§ModelLevelPair).
        const { base, level } = splitRefLevel(effective(editingRole) ?? "");
        const displayBase = inferProviderForBareId(base, models);
        const picked = models.find((m) => `${m.provider}/${m.id}` === displayBase);
        return (
        <div data-testid="roles-model-picker" className="border border-[var(--border-primary)] rounded p-2">
          <div className="text-xs text-[var(--text-secondary)] mb-1">
            {t("assignModelTo", undefined, "Assign model to")}{" "}
            <span className="font-semibold text-[var(--text-primary)]">@{editingRole}</span>
          </div>
          <div className="flex flex-col md:flex-row md:items-end gap-1 md:gap-3.5 border border-[var(--border-primary)] rounded bg-[var(--bg-tertiary)] px-2 py-1.5">
            <div className="flex flex-col gap-0.5 min-w-0 flex-1">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                {t("modelLabel", undefined, "Model")}
              </span>
              <ModelSelectorPrimitive
                current={displayBase}
                models={models}
                onSelect={(modelLabel: string) => setRoleModel(editingRole, modelLabel)}
              />
            </div>
            <div className="flex flex-col gap-0.5 shrink-0">
              <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                {t("thinkingLabel", undefined, "Thinking")}
              </span>
              <ThinkingLevelPrimitive
                current={level}
                supportedLevels={picked?.supportedThinkingLevels}
                onSelect={(lvl: string) => setRoleLevel(editingRole, lvl)}
              />
            </div>
          </div>
          {dropped?.role === editingRole && (
            <div
              data-testid="roles-level-drop-notice"
              role="status"
              className={`mt-2 ${WARNING_CALLOUT}`}
            >
              <Icon path={mdiAlertOutline} size={0.55} className="flex-shrink-0 mt-0.5" aria-hidden />
              <span>
                {t(
                  "levelDropped",
                  { level: dropped.level, model: displayBase },
                  `Thinking level ${dropped.level} isn't supported by ${displayBase}, so the level was dropped.`,
                )}
              </span>
            </div>
          )}
          <div data-testid="roles-ref-echo" className="mt-1 text-xs font-mono text-[var(--text-secondary)]">
            {t("savesRef", undefined, "saves")} {joinRefLevel(displayBase, level) || "—"}
          </div>
        </div>
        );
      })()}
    </div>
  );
}
