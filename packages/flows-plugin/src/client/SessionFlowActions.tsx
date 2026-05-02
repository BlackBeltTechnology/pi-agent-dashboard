import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiPlay, mdiPlus } from "@mdi/js";
import type { FlowInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { ConfirmDialog } from "../../../client/src/components/ConfirmDialog.js";
import { SearchableSelectDialog, type SelectOption } from "../../../client/src/components/SearchableSelectDialog.js";

export function SessionFlowActions({
  flows,
  hasFlowsNew,
  hasFlowsEdit,
  hasFlowsDelete,
  onFlowAction,
}: {
  flows: FlowInfo[];
  hasFlowsNew: boolean;
  hasFlowsEdit?: boolean;
  hasFlowsDelete?: boolean;
  onFlowAction: (action: string, opts?: { flowName?: string; task?: string; description?: string }) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  const [editFlowName, setEditFlowName] = useState<string | null>(null);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowInfo | null>(null);
  const [newFlowOpen, setNewFlowOpen] = useState(false);

  if (flows.length === 0 && !hasFlowsNew) return null;

  const flowOptions: SelectOption[] = flows.map((f) => ({
    value: f.name,
    label: f.name,
    description: f.description,
  }));

  return (
    <>
      <div className="mt-1.5 pt-1.5 border-t border-[var(--border-subtle)]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-[var(--text-muted)]">Flows:</span>
          {flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            >
              <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />Run Flow...
            </button>
          )}
          {hasFlowsNew && (
            <button
              onClick={(e) => { e.stopPropagation(); setNewFlowOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            >
              <Icon path={mdiPlus} size={0.4} className="inline mr-0.5" />New Flow
            </button>
          )}
          {hasFlowsEdit && flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditPickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              &#x270E;&#xFE0E; Edit
            </button>
          )}
          {hasFlowsDelete && flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeletePickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              &#215; Delete
            </button>
          )}
        </div>
      </div>

      {/* Run: pick flow → task dialog */}
      {pickerOpen && (
        <SearchableSelectDialog
          title="Run Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            const flow = flows.find(f => f.name === value);
            if (flow) setSelectedFlow(flow);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {selectedFlow && (
        <FlowLaunchDialog
          flowName={selectedFlow.name}
          description={selectedFlow.description}
          onSubmit={(task) => {
            onFlowAction("run", { flowName: selectedFlow.name, task: task || undefined });
            setSelectedFlow(null);
          }}
          onCancel={() => setSelectedFlow(null)}
        />
      )}

      {/* Edit: pick flow → modification input dialog */}
      {editPickerOpen && (
        <SearchableSelectDialog
          title="Edit Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            setEditFlowName(value);
            setEditPickerOpen(false);
          }}
          onCancel={() => setEditPickerOpen(false)}
        />
      )}

      {editFlowName && (
        <FlowLaunchDialog
          flowName={editFlowName}
          description="Describe how this flow should be updated"
          onSubmit={(desc) => {
            if (desc.trim()) {
              onFlowAction("edit", { flowName: editFlowName, description: desc.trim() });
            }
            setEditFlowName(null);
          }}
          onCancel={() => setEditFlowName(null)}
        />
      )}

      {/* Delete: pick flow → confirm dialog */}
      {deletePickerOpen && (
        <SearchableSelectDialog
          title="Delete Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            setDeleteFlowName(value);
            setDeletePickerOpen(false);
          }}
          onCancel={() => setDeletePickerOpen(false)}
        />
      )}

      {deleteFlowName && (
        <ConfirmDialog
          message={`Delete flow "${deleteFlowName}"? This will remove the flow file and any associated agents.`}
          confirmLabel="Delete"
          onConfirm={() => {
            onFlowAction("delete", { flowName: deleteFlowName });
            setDeleteFlowName(null);
          }}
          onCancel={() => setDeleteFlowName(null)}
        />
      )}

      {/* New: description dialog */}
      {newFlowOpen && (
        <FlowLaunchDialog
          flowName="flows:new"
          description="Design a new flow with the Flow Architect"
          onSubmit={(task) => {
            if (task.trim()) {
              onFlowAction("new", { description: task.trim() });
            }
            setNewFlowOpen(false);
          }}
          onCancel={() => setNewFlowOpen(false)}
        />
      )}
    </>
  );
}
