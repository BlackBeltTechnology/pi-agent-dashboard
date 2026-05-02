import React, { useState, useRef, useEffect } from "react";
import { Icon } from "@mdi/react";
import { mdiPlay } from "@mdi/js";
import { DialogPortal } from "../../../client/src/components/DialogPortal.js";
import { GateSlot, aggregateGateState } from "../../../client/src/components/extension-ui/GateSlot.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function FlowLaunchDialog({
  flowName,
  description,
  onSubmit,
  onCancel,
  session,
}: {
  flowName: string;
  description?: string;
  onSubmit: (task: string) => void;
  onCancel: () => void;
  /** Phase-2 decorator host — used to gate the Run button when an extension declares the flow unavailable. */
  session?: Pick<DashboardSession, "uiDecorators">;
}) {
  // Phase-2 (`add-extension-ui-decorations`): aggregate any `gate` decorators
  // targeting this flowId. Most-restrictive-wins: any `available: false`
  // disables the Run button and renders the reason inline.
  const gateState = aggregateGateState(session?.uiDecorators, flowName);
  const [task, setTask] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(task.trim());
  };

  return (
    <DialogPortal>
      <div className="fixed inset-0 z-[60] flex items-center justify-center">
        <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onCancel} />
        <div className="relative bg-[var(--bg-secondary)] rounded-xl border border-[var(--border-subtle)] shadow-2xl p-4 w-[90vw] max-w-md">
        <h3 className="text-sm font-medium text-[var(--text-primary)] mb-1">
          Run Flow: {flowName}
        </h3>
        {description && (
          <p className="text-[11px] text-[var(--text-tertiary)] mb-3">{description}</p>
        )}
        {/* Phase-2 gate decorator slot. See change: add-extension-ui-decorations. */}
        <GateSlot session={session} flowId={flowName} />
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            type="text"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe the task (optional)..."
            className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              type="button"
              onClick={onCancel}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!gateState.available}
              title={gateState.available ? undefined : gateState.reason}
              className={`text-xs px-3 py-1.5 rounded-lg ${
                gateState.available
                  ? "bg-blue-600 text-white hover:bg-blue-500"
                  : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
              }`}
              data-testid="flow-launch-run"
            >
              <Icon path={mdiPlay} size={0.45} className="inline mr-0.5" />Run
            </button>
          </div>
        </form>
        </div>
      </div>
    </DialogPortal>
  );
}
