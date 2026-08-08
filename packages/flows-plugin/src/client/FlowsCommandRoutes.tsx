/**
 * Slash-command route components for /flows, /flows:new,
 * /flows:edit, /flows:delete. Each renders the appropriate launcher /
 * picker / dialog, dispatches via pluginContext.send, and calls
 * `onClose` on dismissal so the shell's command-route slot consumer
 * navigates back.
 *
 * Replaces the four flow dialog blocks in App.tsx (lines 1199-1313)
 * once the shell deletes them in Part H.
 *
 * See change: pluginize-flows-via-registry.
 */
import React, { useState } from "react";
import type {
  CommandInfo,
  DashboardSession,
  FlowInfo,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  useUiPrimitive,
  usePluginSend,
  useSessionData,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { makeSafeSend, type PluginSend } from "./send-safe.js";

// ── Helpers ────────────────────────────────────────────────────────

// Every flow action routes through here, so the discard is stated once at the
// shared seam rather than at each of the five call sites. A dropped
// `flow_management` message otherwise leaves the UI showing a run the server
// never started. See change: cleanup-client-plugin-promises.
function dispatchFlowAction(
  send: PluginSend,
  sessionId: string,
  action: string,
  opts?: { flowName?: string; task?: string; description?: string },
): void {
  makeSafeSend(send)({
    type: "flow_management",
    sessionId,
    action,
    flowName: opts?.flowName,
    task: opts?.task,
    description: opts?.description,
  });
}

interface RouteProps {
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}

// ── /flows — main picker ───────────────────────────────────────────

/**
 * Three-state machine: pick → launch (taskRequired) | direct-run.
 * When the user picks a flow, either run it (no task required) and
 * close, or open the launch dialog to capture a task.
 */
export function FlowsListRoute({ session, onClose }: RouteProps) {
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const send = usePluginSend();
  // Dialog `onSelect` cannot own the send promise — discard it explicitly.
  // See change: cleanup-client-plugin-promises.
  const dispatch = makeSafeSend(send);
  const flows = useSessionData<FlowInfo[]>(session.id, "flowsList") ?? [];
  const commands = useSessionData<CommandInfo[]>(session.id, "commandsList") ?? [];
  const [launchTarget, setLaunchTarget] = useState<FlowInfo | null>(null);

  const hasFlowsNew = commands.some((c) => c.name === "flows:new");
  const hasFlowsEdit = commands.some((c) => c.name === "flows:edit");
  const hasFlowsDelete = commands.some((c) => c.name === "flows:delete");

  if (launchTarget) {
    return (
      <FlowLaunchDialog
        flowName={launchTarget.name}
        description={launchTarget.description}
        session={session}
        onSubmit={(task) => {
          dispatchFlowAction(send, session.id, "run", {
            flowName: launchTarget.name,
            task: task || undefined,
          });
          onClose();
        }}
        onCancel={() => {
          setLaunchTarget(null);
          onClose();
        }}
      />
    );
  }

  const flowOptions: SelectOption[] = [
    ...(hasFlowsNew
      ? [{ value: "__new__", label: "+ New Flow", description: "Design a new flow with the Flow Architect" }]
      : []),
    ...(hasFlowsEdit && flows.length > 0
      ? [{ value: "__edit__", label: "\u270E\uFE0E Edit Flow...", description: "Edit an existing flow" }]
      : []),
    ...(hasFlowsDelete && flows.length > 0
      ? [{ value: "__delete__", label: "\u00D7 Delete Flow...", description: "Delete a saved flow" }]
      : []),
    ...flows.map((f) => ({ value: f.name, label: f.name, description: f.description })),
  ];

  return (
    <SearchableSelectDialog
      title="Flows"
      options={flowOptions}
      placeholder="Search flows..."
      emptyMessage="No flows available"
      onSelect={(value) => {
        if (value === "__new__") {
          // Send the user to the /flows:new route via pluginRouter.
          // Until pluginRouter wiring lands, just open the new dialog
          // inline by closing this and dispatching the new command.
          dispatch({ type: "send_prompt", sessionId: session.id, text: "/flows:new" });
          onClose();
          return;
        }
        if (value === "__edit__") {
          dispatch({ type: "send_prompt", sessionId: session.id, text: "/flows:edit" });
          onClose();
          return;
        }
        if (value === "__delete__") {
          dispatch({ type: "send_prompt", sessionId: session.id, text: "/flows:delete" });
          onClose();
          return;
        }
        const flow = flows.find((f) => f.name === value);
        if (!flow) {
          onClose();
          return;
        }
        if (flow.taskRequired) {
          setLaunchTarget(flow);
          return;
        }
        dispatchFlowAction(send, session.id, "run", { flowName: flow.name });
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

// ── /flows:new ─────────────────────────────────────────────────────

export function FlowsNewRoute({ session, onClose }: RouteProps) {
  const send = usePluginSend();
  return (
    <FlowLaunchDialog
      flowName="flows:new"
      description="Design a new flow with the Flow Architect"
      onSubmit={(task) => {
        if (task.trim()) {
          dispatchFlowAction(send, session.id, "new", { description: task.trim() });
        }
        onClose();
      }}
      onCancel={onClose}
    />
  );
}

// ── /flows:edit ────────────────────────────────────────────────────

export function FlowsEditRoute({ session, onClose }: RouteProps) {
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const send = usePluginSend();
  const flows = useSessionData<FlowInfo[]>(session.id, "flowsList") ?? [];
  const [editTarget, setEditTarget] = useState<string | null>(null);

  if (editTarget) {
    return (
      <FlowLaunchDialog
        flowName={editTarget}
        description="Describe how this flow should be updated"
        onSubmit={(desc) => {
          if (desc.trim()) {
            dispatchFlowAction(send, session.id, "edit", {
              flowName: editTarget,
              description: desc.trim(),
            });
          }
          onClose();
        }}
        onCancel={onClose}
      />
    );
  }

  return (
    <SearchableSelectDialog
      title="Edit Flow"
      options={flows.map((f) => ({ value: f.name, label: f.name, description: f.description }))}
      placeholder="Search flows..."
      emptyMessage="No flows available"
      onSelect={(value) => setEditTarget(value)}
      onCancel={onClose}
    />
  );
}

// ── /flows:delete ──────────────────────────────────────────────────

export function FlowsDeleteRoute({ session, onClose }: RouteProps) {
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const ConfirmDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);
  const send = usePluginSend();
  const flows = useSessionData<FlowInfo[]>(session.id, "flowsList") ?? [];
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  if (deleteTarget) {
    return (
      <ConfirmDialog
        message={`Delete flow "${deleteTarget}"? This will remove the flow file and any associated agents.`}
        confirmLabel="Delete"
        onConfirm={() => {
          dispatchFlowAction(send, session.id, "delete", { flowName: deleteTarget });
          onClose();
        }}
        onCancel={onClose}
      />
    );
  }

  return (
    <SearchableSelectDialog
      title="Delete Flow"
      options={flows.map((f) => ({ value: f.name, label: f.name, description: f.description }))}
      placeholder="Search flows..."
      emptyMessage="No flows available"
      onSelect={(value) => setDeleteTarget(value)}
      onCancel={onClose}
    />
  );
}
