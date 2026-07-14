import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
// GateSlot is a slot CONSUMER and aggregateGateState is a pure helper —
// neither qualifies as a primitive. Direct import. See add-plugin-ui-primitive-
// registry Decision 4.
import { aggregateGateState, GateSlot } from "@blackbelt-technology/pi-dashboard-client-utils/extension-ui/GateSlot";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiPlay } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

// Registry lookup hoisted into the exported component below — see body.
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
  const t = useT();
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
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
    <Dialog
      open
      onClose={onCancel}
      title={t("runFlowTitle", { flowName }, `Run Flow: ${flowName}`)}
      size="md"
      testId="flow-launch-dialog"
    >
      {description && (
        <p className="text-[11px] text-[var(--text-tertiary)]">{description}</p>
      )}
      {/* Phase-2 gate decorator slot. See change: add-extension-ui-decorations. */}
      <GateSlot session={session} flowId={flowName} />
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          ref={inputRef}
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder={t("taskPlaceholder", undefined, "Describe the task (optional)...")}
          className="w-full px-3 py-2 text-sm bg-[var(--bg-tertiary)] border border-[var(--border-subtle)] rounded-lg text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-blue-500/50"
        />
        <Dialog.Footer>
          <Dialog.Cancel onClick={onCancel} />
          <button
            type="submit"
            disabled={!gateState.available}
            title={gateState.available ? undefined : gateState.reason}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              gateState.available
                ? "bg-[var(--accent-primary)] text-white hover:opacity-90"
                : "bg-[var(--bg-tertiary)] text-[var(--text-muted)] cursor-not-allowed"
            }`}
            data-testid="flow-launch-run"
          >
            <Icon path={mdiPlay} size={0.45} className="inline mr-0.5" />{t("run", undefined, "Run")}
          </button>
        </Dialog.Footer>
      </form>
    </Dialog>
  );
}
