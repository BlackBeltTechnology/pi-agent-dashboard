/**
 * Vitest `setupFiles` shim: registers the subagents plugin's session event
 * reducer slice, the way `App.tsx` registers it from the generated registry.
 *
 * The `subagent_created|started|entry|delta` arms left the core reducer, so the
 * core replay suites that assert `SessionState.subagents` need the slice
 * registered. A test that needs the plugin DISABLED/absent calls
 * `__resetSessionReducersForTests()` (or `setSessionReducerEnabledSet`).
 *
 * Imports the slice module directly (relative path, like the generated
 * registry's lazy modules) rather than the plugin entry, which would pull the
 * whole inspector component tree into every test file. This is the one
 * core → plugin test edge (`integration-keep` row in
 * `scripts/plugin-boundary-allowlist.json`).
 *
 * See change: decouple-plugins-from-core (design D5 item 11).
 */
import { registerSessionEventReducer } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { sessionEventReducer } from "../../../subagents-plugin/src/client/sessionEventReducer.js";

/** Register the slice (idempotent). Exported so a test that reset the registry can restore it. */
export function registerSubagentsReducerSlice(): void {
  registerSessionEventReducer("subagents", sessionEventReducer);
}

registerSubagentsReducerSlice();
