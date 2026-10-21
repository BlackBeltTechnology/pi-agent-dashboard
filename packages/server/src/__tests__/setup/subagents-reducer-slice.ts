/**
 * Vitest `setupFiles` shim: registers the subagents plugin's session event
 * reducer slice AND its `Agent` tool-row finalizer, the way the client's
 * `App.tsx` registers them from the generated registry.
 *
 * Server replay suites fold recorded events through the client reducer
 * (`memory-event-store`, `collapse-replay-equivalence`) and assert
 * `SessionState.subagents`; the subagent writers live in the plugin, so those
 * suites need both registered (design D5 item 11). Mirror of the client's
 * `src/test-support/subagents-reducer-slice.ts`.
 *
 * Imports the plugin modules directly (relative path), not the plugin entry,
 * which would pull the inspector component tree into every server test. This is
 * the one server-test → plugin edge (`integration-keep` row in
 * `scripts/plugin-boundary-allowlist.json`: the replay contract).
 *
 * See change: decouple-plugins-from-core (design D5 item 11, task 4.10).
 */
import {
  registerSessionEventReducer,
  registerToolRowFinalizer,
} from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { sessionEventReducer } from "../../../../subagents-plugin/src/client/sessionEventReducer.js";
import { toolRowFinalizers } from "../../../../subagents-plugin/src/client/toolRowFinalizer.js";

registerSessionEventReducer("subagents", sessionEventReducer);
for (const finalizer of toolRowFinalizers) registerToolRowFinalizer("subagents", finalizer);
