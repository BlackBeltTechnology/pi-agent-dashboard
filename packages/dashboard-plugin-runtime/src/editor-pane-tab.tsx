/**
 * `editor-pane-tab` slot consumers + the plugin-tab open helper.
 *
 * A plugin tab lives at the virtual path `<pathPrefix>:<rest>`. The host pane
 * resolves the owning claim by prefix (enabled plugins only — `getClaims`
 * applies the enabled set), renders its body while active and its label for
 * every open tab. Opening is ONE navigation to the session editor route with
 * `?tab=` per path and a fresh history-state `openNonce`, so a re-open after
 * the user closed the tab re-applies. See change: add-browser-editor-pane-tab
 * (D1, D3).
 */
import { paneTabPrefixOf } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/editor-pane-tab.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type React from "react";
import { CurrentPluginLayer, useSlotRegistryOrNull } from "./plugin-context.js";
import { useSlotClaimsVersion } from "./slot-claims-invalidation.js";
import { SlotErrorBoundary } from "./slot-error-boundary.js";
import type { ClaimEntry, SlotRegistry } from "./slot-registry.js";

/** The enabled `editor-pane-tab` claim owning `path`'s prefix, else `null`. */
export function findEditorPaneTabClaim(registry: SlotRegistry | null, path: string): ClaimEntry | null {
  if (!registry) return null;
  const prefix = paneTabPrefixOf(path);
  if (!prefix) return null;
  return registry.getClaims("editor-pane-tab").find((c) => c.pathPrefix === prefix) ?? null;
}

/** Reactive `findEditorPaneTabClaim` — re-evaluates on a slot-claims bump. */
export function useEditorPaneTabClaim(path: string): ClaimEntry | null {
  useSlotClaimsVersion();
  return findEditorPaneTabClaim(useSlotRegistryOrNull(), path);
}

function renderPaneClaim(
  claim: ClaimEntry,
  Comp: React.ComponentType<Record<string, unknown>>,
  part: "body" | "label",
  props: Record<string, unknown>,
) {
  return (
    <SlotErrorBoundary key={`${claim.pluginId}:editor-pane-tab:${part}`} pluginId={claim.pluginId} slotId="editor-pane-tab">
      <CurrentPluginLayer pluginId={claim.pluginId}>
        <Comp {...props} />
      </CurrentPluginLayer>
    </SlotErrorBoundary>
  );
}

export interface EditorPaneTabSlotProps {
  path: string;
  session: DashboardSession;
  isActive: boolean;
  onClose: () => void;
  /** Rendered when no enabled claim owns `path` (e.g. plugin disabled). */
  fallback: React.ReactNode;
}

/** Body of a plugin tab; `fallback` when its prefix has no enabled claim. */
export function EditorPaneTabSlot({ path, session, isActive, onClose, fallback }: EditorPaneTabSlotProps) {
  const claim = useEditorPaneTabClaim(path);
  if (!claim?.Component) return <>{fallback}</>;
  return renderPaneClaim(claim, claim.Component, "body", { path, session, isActive, onClose });
}

/** Tab-strip label of a plugin tab; `fallback` without a claim or label component. */
export function EditorPaneTabLabelSlot({
  path,
  session,
  fallback,
}: {
  path: string;
  session: DashboardSession | undefined;
  fallback: React.ReactNode;
}) {
  const claim = useEditorPaneTabClaim(path);
  if (!claim?.LabelComponent || !session) return <>{fallback}</>;
  return renderPaneClaim(claim, claim.LabelComponent, "label", { path, session });
}

let openNonceSeq = 0;
/** Unique across page loads (`history.state` survives reload; a bare counter would not). */
const nextOpenNonce = (): string => `${Date.now().toString(36)}-${(++openNonceSeq).toString(36)}`;

/** The editor deep link for `paths` (no nonce — that lives in history state). */
export function pluginTabRouteHref(sessionId: string, paths: readonly string[]): string {
  const qs = paths.map((p) => `tab=${encodeURIComponent(p)}`).join("&");
  return `/session/${encodeURIComponent(sessionId)}/editor${qs ? `?${qs}` : ""}`;
}

/**
 * Open (or focus) one or more plugin tabs in `sessionId`'s pane with a single
 * navigation. Selects the session; the last path ends up active. A fresh
 * `openNonce` makes an identical repeat re-apply (re-open after close).
 */
export function openPluginTabRoute(
  navigate: (to: string, opts?: { state?: unknown; replace?: boolean }) => void,
  sessionId: string,
  paths: readonly string[],
): void {
  const unique = [...new Set(paths.filter((p) => paneTabPrefixOf(p) !== null))];
  if (!sessionId || unique.length === 0) return;
  navigate(pluginTabRouteHref(sessionId, unique), { state: { openNonce: nextOpenNonce() } });
}
