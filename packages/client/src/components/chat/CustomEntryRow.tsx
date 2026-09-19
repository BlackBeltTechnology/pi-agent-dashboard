/**
 * Shared render container for a `role: "custom"` chat row.
 *
 * Owns the whole resolution chain so every absorption site is identical:
 *   1. the custom-event group-visibility gate (D6/D8) — applied here, so a row
 *      absorbed into a burst/×N container is gated exactly like a top-level row;
 *   2. plugin `custom-entry-renderer` claim lookup via `forCustomType` (one-shot,
 *      mirroring `ToolCallStep`), with `claimShouldRender` failing CLOSED;
 *   3. a per-claim `ErrorBoundary` landing on `CustomEntryCard` (D9);
 *   4. collapsed-first expansion + the on-demand payload fetch, so a
 *      mounted-but-collapsed row issues ZERO requests (D3).
 *
 * See change: add-custom-entry-renderer-slot.
 */
import {
  type ClaimEntry,
  CurrentPluginLayer,
  forCustomType,
  type SlotRegistry,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { useSlotRegistryOrNull } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import React, { useCallback, useMemo, useState } from "react";
import { useCustomEntryPayload } from "../../hooks/useCustomEntryPayload.js";
import { useDisplayPrefs } from "../../hooks/useDisplayPrefs.js";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import { ErrorBoundary } from "../primitives/ErrorBoundary.js";
import { CustomEntryCard } from "./CustomEntryCard.js";

/**
 * Evaluate a `custom-entry-renderer` claim's optional `shouldRender`. Absent or
 * truthy → render. Returns false → fall through. Throws → fail closed (false).
 */
function claimShouldRender(claim: ClaimEntry, customType: string): boolean {
  if (!claim.shouldRender) return true;
  try {
    // custom-entry-renderer claims take no predicate input
    // (SlotPredicateInput = never); pass undefined.
    return (claim.shouldRender as (input?: unknown) => boolean)(undefined) !== false;
  } catch (err) {
    console.warn(
      `[custom-entry-renderer] shouldRender threw for plugin "${claim.pluginId}" customType "${customType}"; treating as false (fail-closed)`,
      err,
    );
    return false;
  }
}

/** Resolve the first claim for `customType` whose `shouldRender` passes. */
function resolveCustomEntryClaim(
  registry: SlotRegistry | null,
  customType: string,
): ClaimEntry | null {
  if (!registry) return null;
  const claims = forCustomType(registry.getClaims("custom-entry-renderer"), customType);
  for (const c of claims) {
    if (claimShouldRender(c, customType)) return c;
  }
  return null;
}

interface Props {
  msg: ChatMessage;
  sessionId?: string;
}

export function CustomEntryRow({ msg, sessionId }: Props) {
  // Session-scoped: the View popover writes a PER-SESSION `displayPrefsOverride`,
  // so this must pass `sessionId` or the group gate silently reads global prefs.
  const prefs = useDisplayPrefs(sessionId);
  const registry = useSlotRegistryOrNull();
  const customType = msg.customType ?? "custom";

  const [expanded, setExpanded] = useState(false);
  const entry = useCustomEntryPayload(sessionId, msg.entryId);
  const claim = useMemo(
    () => resolveCustomEntryClaim(registry, customType),
    [registry, customType],
  );

  const onToggle = useCallback(() => {
    // Fetch on first expansion ONLY — collapsed rows issue no request (D3).
    if (!expanded && msg.entryId && sessionId) void entry.fetchPayload();
    setExpanded((v) => !v);
  }, [expanded, entry, msg.entryId, sessionId]);

  // Group gate: applied at every site via this single container.
  if (prefs.customEventGroups[msg.groupId ?? "other"] === false) return null;

  const fallback = (
    <CustomEntryCard customType={customType} body={msg.content} timestamp={msg.timestamp} />
  );

  const PluginComponent = claim?.Component;
  if (!claim || !PluginComponent) return fallback;

  return (
    <ErrorBoundary fallback={fallback}>
      <CurrentPluginLayer pluginId={claim.pluginId}>
        <PluginComponent
          customType={customType}
          body={msg.content}
          timestamp={msg.timestamp}
          entryId={msg.entryId}
          sessionId={sessionId}
          expanded={expanded}
          onToggle={onToggle}
          payload={entry.payload}
          payloadError={entry.error}
          payloadLoading={entry.loading}
        />
      </CurrentPluginLayer>
    </ErrorBoundary>
  );
}
