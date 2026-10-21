/**
 * Vitest `setupFiles` shim: registers the subagents plugin's session event
 * reducer slice AND its `Agent` tool-row finalizer, the way `App.tsx` registers
 * them from the generated registry.
 *
 * The subagent writers left the core reducer (the slice owns
 * `subagent_created|started|entry|delta`, the finalizer owns the terminal
 * events, the `partialResult` hydration and the `/resume` backfill), so the core
 * replay suites that assert `SessionState.subagents` need both registered. A
 * test that needs the plugin DISABLED/absent calls `disableSubagentsPlugin()`
 * and restores with `registerSubagentsReducerSlice()` in `afterEach`.
 *
 * Imports the plugin modules directly (relative path, like the generated
 * registry's lazy modules) rather than the plugin entry, which would pull the
 * whole inspector component tree into every test file. This is the one
 * core → plugin test edge (`integration-keep` rows in
 * `scripts/plugin-boundary-allowlist.json`: the replay contract).
 *
 * See change: decouple-plugins-from-core (design D5 item 11).
 */
import {
  registerSessionEventReducer,
  registerToolRowFinalizer,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { __resetSessionReducersForTests } from "@blackbelt-technology/dashboard-plugin-runtime/test-support";
import { sessionEventReducer } from "../../../subagents-plugin/src/client/sessionEventReducer.js";
import { toolRowFinalizers } from "../../../subagents-plugin/src/client/toolRowFinalizer.js";
import { setEventTypeOwners } from "../lib/plugins/event-type-owners.js";

/** Register the slice and the finalizers (idempotent) and clear any test-seeded owners. */
export function registerSubagentsReducerSlice(): void {
  registerSessionEventReducer("subagents", sessionEventReducer);
  for (const finalizer of toolRowFinalizers) registerToolRowFinalizer("subagents", finalizer);
  setEventTypeOwners([]);
}

/**
 * The subagents plugin is off: no slice, no finalizer, `subagent_*` owned by the
 * plugin so its events fold into the owned group row.
 */
export function disableSubagentsPlugin(): void {
  __resetSessionReducersForTests();
  setEventTypeOwners([{ ownerId: "subagents", displayName: "Subagents", eventTypes: ["subagent_*"] }]);
}

registerSubagentsReducerSlice();
