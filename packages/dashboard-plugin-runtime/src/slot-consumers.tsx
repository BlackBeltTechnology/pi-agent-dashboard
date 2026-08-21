/**
 * One slot consumer component per slot id.
 *
 * Each consumer:
 * 1. Reads the slot registry via PluginContextProvider.
 * 2. Filters claims for its slot id (and any additional prop-based filter).
 * 3. Renders each contribution wrapped in a per-claim SlotErrorBoundary
 *    and a CurrentPluginLayer (so plugin hooks work correctly).
 * 4. Renders nothing when zero claims match.
 */
import type { IntentNode } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/intent-types.js";
import type { SlotId } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/slot-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useCallback, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { IntentRenderer } from "./intent-renderer.js";
import { useSlotIntents } from "./intent-store.js";
import { sendPluginAction } from "./plugin-action-bridge.js";
import { CurrentPluginLayer, useSlotRegistryOrNull } from "./plugin-context.js";
import { useShellSessionOrNull } from "./shell-sessions-context.js";
import { SlotErrorBoundary } from "./slot-error-boundary.js";
import type { FolderDescriptor } from "./slot-registry.js";
import { forActionId, forFolder, forSession, forSessionRendered, forToolName, type SlotRegistry } from "./slot-registry.js";

/**
 * Returns true when at least one plugin claim exists for `slotId` AND matches
 * the given `session` per the slot's session targeting rules AND would
 * actually render visible output (i.e. its `shouldRender(session)` returns
 * `true`, or no `shouldRender` is declared). Lets call sites conditionally
 * render parent containers (e.g. titled subcards) without triggering the
 * slot's own render path twice.
 *
 * Note: this consults `shouldRender` (introduced by change
 * `auto-hide-empty-session-subcards`). Claims whose component conditionally
 * returns `null` should declare `shouldRender` so this hook reports `false`
 * and parent wrappers hide cleanly.
 */
export function useSlotHasClaimsForSession(slotId: SlotId, session: DashboardSession): boolean {
  const registry = useSlotRegistryOrNull();
  if (!registry) return false;
  return forSessionRendered(registry.getClaims(slotId), session).length > 0;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderClaim(
  claim: { pluginId: string; Component?: React.ComponentType<Record<string, unknown>> },
  slotId: string,
  props: Record<string, unknown>,
) {
  if (!claim.Component) return null;
  const Comp = claim.Component;
  return (
    <SlotErrorBoundary key={`${claim.pluginId}:${slotId}`} pluginId={claim.pluginId} slotId={slotId}>
      <CurrentPluginLayer pluginId={claim.pluginId}>
        <Comp {...props} />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  );
}

/**
 * Render an entry from the IntentStore. Wraps in a SlotErrorBoundary +
 * CurrentPluginLayer so plugin-hook semantics match legacy refs claims.
 *
 * See change: adopt-server-driven-intent-rendering.
 */
function renderIntent(
  pluginId: string,
  slotId: SlotId,
  intent: IntentNode,
  sessionId: string | null,
) {
  return (
    <SlotErrorBoundary key={`intent:${pluginId}:${slotId}`} pluginId={pluginId} slotId={slotId}>
      <CurrentPluginLayer pluginId={pluginId}>
        <IntentRenderer
          intent={intent}
          pluginId={pluginId}
          send={(action, payload) => sendPluginAction(pluginId, sessionId, action, payload)}
        />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  );
}

// ── Slot consumers ────────────────────────────────────────────────────────────

export function SidebarFolderSectionSlot({ folder }: { folder: FolderDescriptor }) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forFolder(registry.getClaims("sidebar-folder-section"), folder);
  if (!claims.length) return null;
  return (
    <>
      {claims.map(c =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "sidebar-folder-section", { folder }),
      )}
    </>
  );
}

/**
 * `worktree-card-section` — folder-scoped block rendered INSIDE a worktree
 * session card, scoped to the worktree's own `cwd` (not the parent repo it
 * collapses under). The KB plugin claims this slot with `FolderKbSection` so a
 * worktree — which groups under its `gitWorktree.mainPath` and therefore never
 * gets its own sidebar folder card — still surfaces its own KB row.
 * See change: kb-row-on-worktree-session-card.
 */
export function WorktreeCardSectionSlot({ folder }: { folder: FolderDescriptor }) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forFolder(registry.getClaims("worktree-card-section"), folder);
  if (!claims.length) return null;
  return (
    <>
      {claims.map(c =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "worktree-card-section", { folder, placement: "card" }),
      )}
    </>
  );
}

export function SessionCardBadgeSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-badge", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-badge"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-badge", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-badge", intent, session.id),
      )}
    </>
  );
}

export function SessionCardActionBarSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-action-bar", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-action-bar"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-action-bar", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-action-bar", intent, session.id),
      )}
    </>
  );
}

export function SessionCardMemorySlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-memory", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-memory"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-memory", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-memory", intent, session.id),
      )}
    </>
  );
}

export function SessionCardFlowsSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("session-card-flows", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("session-card-flows"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "session-card-flows", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "session-card-flows", intent, session.id),
      )}
    </>
  );
}

export function WorkspaceActionBarSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("workspace-action-bar", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("workspace-action-bar"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "workspace-action-bar", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "workspace-action-bar", intent, session.id),
      )}
    </>
  );
}

export function ContentViewSlot({
  session,
  routeParams,
  onClose,
}: {
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  // Multiple plugins may claim `content-view` (multiplicity:
  // "one-active"). Each claim's optional `predicate` decides whether
  // it wants to render right now; predicates close over the plugin's
  // own UI-state store. The first claim (priority order) whose
  // predicate returns true wins. If no predicate is true, this slot
  // renders null so the shell's `?? sessionDetail` fallback shows the
  // default chat view. See change: pluginize-flows-via-registry
  // (design.md Decision 3 RECONSIDERED).
  const intents = useSlotIntents("content-view", session.id);
  const legacyClaims = registry
    ? forSession(registry.getClaims("content-view"), session)
    : [];
  // one-active: intents take precedence over legacy when both present.
  if (intents.size > 0) {
    const [pluginId, intent] = Array.from(intents.entries())[0];
    return renderIntent(pluginId, "content-view", intent, session.id) as React.ReactElement;
  }
  if (!legacyClaims.length) return null;
  const claim = legacyClaims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "content-view", {
    session,
    routeParams,
    onClose,
  });
}

export function ContentHeaderStickySlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("content-header-sticky", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("content-header-sticky"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "content-header-sticky", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "content-header-sticky", intent, session.id),
      )}
    </>
  );
}

export function ContentInlineFooterSlot({ session }: { session: DashboardSession }) {
  const registry = useSlotRegistryOrNull();
  const intents = useSlotIntents("content-inline-footer", session.id);
  const legacyClaims = registry
    ? forSessionRendered(registry.getClaims("content-inline-footer"), session)
    : [];
  if (!legacyClaims.length && intents.size === 0) return null;
  return (
    <>
      {legacyClaims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "content-inline-footer", { session }),
      )}
      {Array.from(intents.entries()).map(([pluginId, intent]) =>
        renderIntent(pluginId, "content-inline-footer", intent, session.id),
      )}
    </>
  );
}

export function AnchoredPopoverSlot({
  anchorEl,
  onDismiss,
}: {
  anchorEl: HTMLElement;
  onDismiss: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = registry.getClaims("anchored-popover");
  if (!claims.length) return null;
  // one-at-a-time: render the first claim only
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "anchored-popover", {
    anchorEl,
    onDismiss,
  });
}

export function CommandRouteSlot({
  command,
  session,
  routeParams,
  onClose,
}: {
  command: string;
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const allClaims = registry.getClaims("command-route");
  const claims = allClaims.filter(c => c.command === command);
  if (!claims.length) return null;
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "command-route", {
    session,
    routeParams,
    onClose,
  });
}

/**
 * Inert since `plugin-settings-pages`.
 *
 * `settings-section` contributions render exclusively on their owning plugin's
 * page (`/settings/plugins/<id>`) via `SettingsSectionByPluginSlot`. Two live
 * render paths was the bug this change removes, so this consumer emits nothing
 * for any `tab`. Kept as an exported no-op only so an out-of-tree import does
 * not hard-fail at module load. See change: plugin-settings-pages (design D3).
 */
export function SettingsSectionSlot(_props: { tab?: string }): null {
  return null;
}

/**
 * Render every `settings-section` contribution that belongs to a single plugin
 * id, irrespective of the claim's `tab` field. This is the ONLY render path for
 * the slot: the host mounts it inside `PluginSettingsPage`'s chrome.
 *
 * Consumes BOTH forms, per the canonical dual-source contract:
 * - refs claims, ordered by the registry comparator (ascending `priority`,
 *   tie-broken by `pluginId.localeCompare`);
 * - intent broadcasts (which carry no priority), rendered after every claim in
 *   store order.
 *
 * Intents are filtered against the enabled set here because the registry's own
 * filter covers claims only — without this, a plugin disabled while its page is
 * open would keep an intent-rendered body mounted (design D6, D7, D8).
 *
 * See change: add-plugin-activation-ui, plugin-settings-pages.
 */
export function SettingsSectionByPluginSlot({ pluginId }: { pluginId: string }) {
  const registry = useSlotRegistryOrNull();
  const allIntents = useSlotIntents("settings-section", null);
  const claims = registry
    ? registry.getClaims("settings-section").filter((c) => c.pluginId === pluginId)
    : [];
  const enabled = registry ? registry.isPluginEnabled(pluginId) : false;
  const intent = enabled ? allIntents.get(pluginId) : undefined;
  if (!claims.length && !intent) return null;
  return (
    <>
      {claims.map((c) =>
        renderClaim(c as Parameters<typeof renderClaim>[0], "settings-section", {}),
      )}
      {intent ? renderIntent(pluginId, "settings-section", intent, null) : null}
    </>
  );
}

/**
 * Optional payload fields a `tool-renderer` plugin may consume, mirroring the
 * built-in `ToolRendererProps`. Required core (`toolName`/`toolInput`/
 * `sessionId`) stays separate so existing claims keep compiling.
 * See change: wire-tool-renderer-slot.
 */
interface ToolRendererExtraProps {
  status?: "running" | "complete" | "error";
  result?: string;
  toolDetails?: Record<string, unknown>;
  images?: unknown[];
  context?: unknown;
}

export function ToolRendererSlot({
  toolName,
  toolInput,
  sessionId,
  FallbackComponent,
  ...extra
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId: string;
  FallbackComponent?: React.ComponentType<{
    toolName: string;
    toolInput: Record<string, unknown>;
    sessionId: string;
  } & ToolRendererExtraProps>;
} & ToolRendererExtraProps) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forToolName(registry.getClaims("tool-renderer"), toolName);
  if (!claims.length) {
    return FallbackComponent ? (
      <FallbackComponent toolName={toolName} toolInput={toolInput} sessionId={sessionId} {...extra} />
    ) : null;
  }
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "tool-renderer", {
    toolName,
    toolInput,
    sessionId,
    ...extra,
  });
}

/**
 * Render the first `automation-action-editor` claim whose `config.actionId`
 * matches `actionId`. Used by the create-automation dialog to host a plugin-
 * contributed payload editor (e.g. flows-plugin's input-wiring form) for a
 * specific action id, additively below the generic `ActionPayloadForm`.
 *
 * Renders nothing when no claim targets the action id (the dialog then shows
 * only the generic form). The contributed component receives the current
 * `payload`, an `onChange(payload)` callback, and the run `cwd`.
 *
 * See change: wire-flow-inputs-in-automation.
 */
export function AutomationActionEditorSlot({
  actionId,
  payload,
  onChange,
  cwd,
}: {
  actionId: string;
  payload: Record<string, unknown>;
  onChange: (payload: Record<string, unknown>) => void;
  cwd?: string;
}) {
  const registry = useSlotRegistryOrNull();
  if (!registry) return null;
  const claims = forActionId(registry.getClaims("automation-action-editor"), actionId);
  if (!claims.length) return null;
  const claim = claims[0];
  return renderClaim(claim as Parameters<typeof renderClaim>[0], "automation-action-editor", {
    payload,
    onChange,
    cwd,
  });
}

/**
 * Returns `true` when at least one `automation-action-editor` claim targets
 * `actionId`. Lets the dialog decide render/submit paths without mounting the
 * editor. See change: wire-flow-inputs-in-automation.
 */
export function useHasAutomationActionEditor(actionId: string): boolean {
  const registry = useSlotRegistryOrNull();
  if (!registry) return false;
  return forActionId(registry.getClaims("automation-action-editor"), actionId).length > 0;
}

// ── shell-overlay-route ───────────────────────────────────────────────────────
//
// Plugin-owned full-screen URL routes mounted at the top of the shell’s
// dispatch chain (desktop + mobile). Each claim ships a wouter path via
// `config.path` and a React component. The first matching claim wins.
//
// See change: add-flow-agent-popout.

interface ShellOverlayRouteClaim {
  pluginId: string;
  /** First-class path field (preferred). See change: fix-flows-plugin-polish. */
  path?: string;
  /** First-class session-param field (preferred). Defaults to "sid". */
  sessionParam?: string;
  /** Back-action depth (1 = detail, 2 = overlay). See change: fix-plugin-and-scoped-back-navigation. */
  depth?: 1 | 2;
  /** Back-action parent path pattern for depth-2 routes. See change: fix-plugin-and-scoped-back-navigation. */
  parentPath?: string;
  /** Container selection: route-backed dialog (default) or full-viewport page.
   *  First-class only — unlike `path`/`sessionParam` there are no legacy
   *  manifests carrying it under `config`. See change: add-route-backed-overlay-dialogs. */
  presentation?: "page" | "dialog";
  /** Legacy fallback: some older manifests put `path` / `sessionParam` under `config`. */
  config?: Record<string, unknown>;
  Component?: React.ComponentType<Record<string, unknown>>;
}

function overlayPath(c: ShellOverlayRouteClaim): string | null {
  if (typeof c.path === "string") return c.path;
  const p = c.config?.path;
  return typeof p === "string" ? p : null;
}

function overlaySessionParam(c: ShellOverlayRouteClaim): string {
  if (typeof c.sessionParam === "string" && c.sessionParam.length > 0) return c.sessionParam;
  const sp = c.config?.sessionParam;
  return typeof sp === "string" && sp.length > 0 ? sp : "sid";
}

/**
 * Render the first `shell-overlay-route` claim whose path matches the
 * current URL. Returns `null` when no claim matches.
 *
 * Mounted by App.tsx at the top of the desktop overlay switch and inside
 * `MobileShell.detailPanel`. The shell falls through to its own rendering
 * when this returns null.
 */
/**
 * Props the host's dialog container receives. See `OverlayContainerComponent`.
 */
export interface OverlayContainerProps {
  /** The matched claim, so the host can title the surface or read `depth`. */
  claim: ShellOverlayRouteClaim;
  /** Leave this surface. Wired to the slot's `onBack`. */
  onDismiss: () => void;
  children: React.ReactNode;
}

/**
 * The host-supplied dialog container (in this repo, the client's
 * `RouteBackedOverlay`).
 *
 * **Why injected rather than imported (D2a):** the container needs `Dialog`,
 * which lives in `client-utils` — and `client-utils` already depends on THIS
 * package. Importing it back would be a dependency cycle. So this package owns
 * the decision (which claim matched, what its effective presentation is) and
 * the host owns the visual shell.
 */
export type OverlayContainerComponent = React.ComponentType<OverlayContainerProps>;

export function ShellOverlayRouteSlot({
  onBack,
  registry: registryProp,
  dialogContainer,
}: {
  onBack: () => void;
  /** Optional registry override. Same fallback rules as `useShellOverlayRouteMatched`: when omitted, falls back to `useSlotRegistryOrNull()`. */
  registry?: SlotRegistry | null;
  /**
   * Container for claims whose effective `presentation` is `"dialog"`.
   * When omitted, every claim renders in the page container — so a host that
   * has not opted in behaves exactly as it did before this change.
   */
  dialogContainer?: OverlayContainerComponent;
}) {
  const ctxRegistry = useSlotRegistryOrNull();
  const effective = registryProp ?? ctxRegistry;
  const claims = (effective?.getClaims("shell-overlay-route") ?? []) as ShellOverlayRouteClaim[];
  // Each ShellOverlayRouteProbe is a separate component — one useRoute call
  // per claim. The first probe whose route matches reports up via
  // `onMatched`. We render at most one match (first-wins).
  return (
    <ShellOverlayRouteSwitch claims={claims} onBack={onBack} dialogContainer={dialogContainer} />
  );
}

/**
 * Companion hook: returns `true` when any registered `shell-overlay-route`
 * claim’s path matches the current URL. Replaces hand-wired `||`-chains
 * of `useRoute` flags in the shell.
 */
/**
 * Synchronous match against `shell-overlay-route` claims.
 *
 * **Important**: this hook is callable from inside `App.tsx` BEFORE the
 * `<PluginContextProvider>` is mounted (App is the parent of the provider).
 * It therefore accepts the registry as an optional argument; when not
 * provided it falls back to `useSlotRegistryOrNull()` (works only when
 * called from inside the provider).
 *
 * The shell typically passes `_pluginRegistry` (the module-level
 * SlotRegistry created in `App.tsx`) so the hook resolves even when
 * called outside the provider tree.
 *
 * See change: fix-flows-plugin-polish (hook-outside-provider fix).
 */
export function useShellOverlayRouteMatched(registry?: SlotRegistry | null): boolean {
  const ctxRegistry = useSlotRegistryOrNull();
  const effective = registry ?? ctxRegistry;
  const claims = (effective?.getClaims("shell-overlay-route") ?? []) as ShellOverlayRouteClaim[];
  const [location] = useLocation();
  let matched = false;
  for (const c of claims) {
    const path = overlayPath(c);
    if (!path) continue;
    if (matchWouterPattern(path, location)) {
      matched = true;
      break;
    }
  }
  return matched;
}

/**
 * Effective `presentation` of the matched `shell-overlay-route` claim, or
 * `null` when none matches.
 *
 * The shell needs this in `App.tsx`'s body — BEFORE it renders — to pick the
 * mobile layout: a `"page"` claim renders full-viewport OUTSIDE the
 * `MobileShell` detail panel, while a `"dialog"` claim renders inside it at its
 * declared depth (D3a). Same registry-argument rules as
 * `useShellOverlayRouteMatched`.
 *
 * **Known caveat (D2a):** this shares `matchWouterPattern` with
 * `useShellOverlayRouteMatched`, which supports `:param` but not wouter's regex
 * segments, whereas the in-slot probes use the real `useRoute`. For a claim
 * using a regex segment the two could disagree, giving page layout with a
 * dialog container or vice versa. No bundled claim uses one today; fixing the
 * divergence means routing both through the router's own parser and is
 * deliberately out of this change's scope.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
export function useShellOverlayRoutePresentation(
  registry?: SlotRegistry | null,
): "page" | "dialog" | null {
  const ctxRegistry = useSlotRegistryOrNull();
  const effective = registry ?? ctxRegistry;
  const claims = (effective?.getClaims("shell-overlay-route") ?? []) as ShellOverlayRouteClaim[];
  const [location] = useLocation();
  for (const c of claims) {
    const path = overlayPath(c);
    if (!path) continue;
    if (matchWouterPattern(path, location)) return c.presentation ?? "dialog";
  }
  return null;
}

// ── Internal helpers (one useRoute call per claim via per-claim component) ───

/**
 * Mini wouter-pattern matcher for `useShellOverlayRouteMatched`. Supports
 * the same `:param` syntax wouter uses (no regex parts). Returns true on
 * exact match.
 */
function matchWouterPattern(pattern: string, location: string): boolean {
  return matchWouterPatternWithParams(pattern, location) !== null;
}

/**
 * Same as `matchWouterPattern` but returns the captured `:param` values
 * as `{param: decoded-value}` on match, `null` on miss. Used for the
 * synchronous first-render path so the slot consumer doesn't have to
 * wait for `<ShellOverlayRouteProbe>`'s useEffect to fire.
 */
function matchWouterPatternWithParams(
  pattern: string,
  location: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const locParts = location.split("/").filter(Boolean);
  if (patternParts.length !== locParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i]!;
    const l = locParts[i]!;
    if (p.startsWith(":")) {
      try {
        params[p.slice(1)] = decodeURIComponent(l);
      } catch {
        params[p.slice(1)] = l;
      }
      continue;
    }
    if (p !== l) return null;
  }
  return params;
}

/**
 * Owns the "which claim is matched" state. Renders one probe per claim;
 * each probe reports its own match state up. The first reported match
 * wins; later matches are ignored.
 */
function ShellOverlayRouteSwitch({
  claims,
  onBack,
  dialogContainer: DialogContainer,
}: {
  claims: ShellOverlayRouteClaim[];
  onBack: () => void;
  dialogContainer?: OverlayContainerComponent;
}) {
  // Compute the first-match synchronously so the first render already has
  // the right claim mounted (no empty flicker). Probes still update the
  // state on subsequent renders when the URL changes.
  const [location] = useLocation();
  const initialMatch = (() => {
    for (let i = 0; i < claims.length; i++) {
      const path = overlayPath(claims[i]!);
      if (!path) continue;
      const params = matchWouterPatternWithParams(path, location);
      if (params) return { index: i, params };
    }
    return null;
  })();
  const [matchedClaimIndex, setMatchedClaimIndex] = useState<number | null>(
    initialMatch?.index ?? null,
  );
  const [matchedParams, setMatchedParams] = useState<Record<string, string>>(
    initialMatch?.params ?? {},
  );
  if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    // eslint-disable-next-line no-console
    console.debug(
      "[shell-overlay-route] switch render",
      {
        location,
        claimCount: claims.length,
        claimPaths: claims.map((c) => overlayPath(c)),
        initialMatchIndex: initialMatch?.index ?? null,
        currentMatchedIndex: matchedClaimIndex,
      },
    );
  }

  const reportMatch = useCallback(
    (index: number, params: Record<string, string>) => {
      setMatchedClaimIndex((prev) => {
        // First-wins, but smallest index wins on simultaneous reports.
        if (prev === null || index < prev) {
          setMatchedParams(params);
          return index;
        }
        return prev;
      });
    },
    [],
  );
  const reportUnmatch = useCallback((index: number) => {
    setMatchedClaimIndex((prev) => (prev === index ? null : prev));
  }, []);

  const probes = claims.map((c, i) => (
    <ShellOverlayRouteProbe
      key={`${c.pluginId}:${i}`}
      claimIndex={i}
      path={overlayPath(c)}
      onMatch={reportMatch}
      onUnmatch={reportUnmatch}
    />
  ));

  if (matchedClaimIndex === null) return <>{probes}</>;
  const claim = claims[matchedClaimIndex]!;

  // The height-propagation wrapper is part of the claim's contract, so it is
  // identical under BOTH containers — a claim that sizes itself against a flex
  // parent renders the same either way (task 4.2).
  const body = (
    <div className="flex-1 min-h-0 relative">
      <ShellOverlayRouteRender
        claim={claim}
        params={matchedParams}
        onBack={onBack}
      />
    </div>
  );

  // `presentation` defaults to "dialog" (D3); "page" is the explicit opt-out.
  // With no container injected everything stays on the page path, which is the
  // pre-change behaviour.
  const useDialog = (claim.presentation ?? "dialog") === "dialog" && Boolean(DialogContainer);

  return (
    <>
      {probes}
      {useDialog && DialogContainer ? (
        <DialogContainer claim={claim} onDismiss={onBack}>
          {body}
        </DialogContainer>
      ) : (
        body
      )}
    </>
  );
}

function ShellOverlayRouteProbe({
  claimIndex,
  path,
  onMatch,
  onUnmatch,
}: {
  claimIndex: number;
  path: string | null;
  onMatch: (index: number, params: Record<string, string>) => void;
  onUnmatch: (index: number) => void;
}) {
  // useRoute is called exactly once per probe component instance — hook
  // order is stable per probe across renders.
  const [matched, params] = useRoute(path ?? "/__shell_overlay_no_match__");
  React.useEffect(() => {
    if (matched) onMatch(claimIndex, (params as Record<string, string>) ?? {});
    else onUnmatch(claimIndex);
  }, [matched, params, claimIndex, onMatch, onUnmatch]);
  return null;
}

function ShellOverlayRouteRender({
  claim,
  params,
  onBack,
}: {
  claim: ShellOverlayRouteClaim;
  params: Record<string, string>;
  onBack: () => void;
}) {
  const sessionParam = overlaySessionParam(claim);
  const sessionId = params[sessionParam];
  const session = useShellSessionOrNull(sessionId ?? "");
  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {renderClaim(claim as Parameters<typeof renderClaim>[0], "shell-overlay-route", {
        params,
        session,
        onBack,
      })}
    </div>
  );
}
