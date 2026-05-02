/**
 * Reducer barrel for the flows plugin.
 *
 * Re-exports the flow + architect reducers so that
 * `packages/client/src/lib/event-reducer.ts` can import them via
 * `@blackbelt-technology/pi-dashboard-flows-plugin/reducer` instead of
 * the previous local paths.
 */
export { isFlowEvent, reduceFlowEvent } from "./flow-reducer.js";
export { isArchitectEvent, reduceArchitectEvent } from "./architect-reducer.js";
