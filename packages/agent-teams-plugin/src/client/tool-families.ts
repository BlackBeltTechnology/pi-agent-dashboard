/**
 * The data-driven tool-name → renderer-family table of the lazy
 * `TeamToolRenderers` module (design D9, task 8.3): eleven team tools map to four
 * component families. It is the single source for the manifest's eleven
 * `tool-renderer` claims — `__tests__/manifest.test.ts` asserts table ≡ manifest.
 * Pure data (no React, no icon import); keyed by core's `TeamOp` so a new core
 * tool fails the type-check until it is placed in a family.
 * See change: add-agent-teams-ui.
 */
import type { TeamOp } from "../shared/protocol.js";

export type ToolFamily = "lifecycle" | "send" | "task" | "shutdown";

export const TOOL_FAMILIES: Readonly<Record<TeamOp, ToolFamily>> = {
  TeamCreate: "lifecycle",
  TeammateSpawn: "lifecycle",
  TeamStatus: "lifecycle",
  TeamDelete: "lifecycle",
  SendMessage: "send",
  TaskCreate: "task",
  TaskList: "task",
  TaskGet: "task",
  TaskUpdate: "task",
  ShutdownRequest: "shutdown",
  ShutdownResponse: "shutdown",
};

/** Exported component name (in `TeamToolRenderers.tsx`) rendering each family. */
export const FAMILY_COMPONENTS: Readonly<Record<ToolFamily, string>> = {
  lifecycle: "TeamLifecycleToolRenderer",
  send: "TeamMessageToolRenderer",
  task: "TeamTaskToolRenderer",
  shutdown: "TeamShutdownToolRenderer",
};
