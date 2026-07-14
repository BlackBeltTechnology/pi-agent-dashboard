/**
 * FlowQuestionCard — renders a pending `flow-question` prompt inside
 * FlowDashboard's upper slot, above the agent grid.
 *
 * Routes to the appropriate input affordance based on the prompt's
 * `type` (`confirm` / `select` / `multiselect` / `input`). On submit,
 * dispatches `prompt_response` via the plugin's send fn. On dismiss,
 * dispatches `prompt_cancel`.
 *
 * V1 inlines minimal renderers for the 4 prompt types. Extracting these
 * into shared UI primitives is tracked as follow-up tech debt — for now
 * each renderer is ~10 LOC and the duplication is contained.
 *
 * See change: route-flow-asks-to-upper-slot.
 */

import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiClose, mdiHelpCircleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useState } from "react";

export interface FlowQuestionCardProps {
  sessionId: string;
  promptId: string;
  flowId: string;
  stepId: string;
  question: string;
  type: "select" | "input" | "confirm" | "editor" | "multiselect";
  options?: string[];
  defaultValue?: string;
  /** Number of queued questions for this flow (head + queue). 0 or 1 hides the badge. */
  queueDepth: number;
  /** Dispatch `prompt_response`. */
  onSubmit: (answer: string) => void;
  /** Dispatch `prompt_cancel`. */
  onDismiss: () => void;
}

export function FlowQuestionCard({
  question,
  type,
  options,
  defaultValue,
  queueDepth,
  onSubmit,
  onDismiss,
}: FlowQuestionCardProps) {
  const t = useT();
  return (
    <div
      data-testid="flow-question-card"
      className="mt-2 mb-2 p-3 border border-purple-500/40 bg-purple-500/5 rounded"
    >
      <div className="flex items-start gap-2 mb-2">
        <Icon path={mdiHelpCircleOutline} size={0.7} className="text-purple-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-[var(--text-primary)] font-medium">{question}</div>
        </div>
        {queueDepth > 1 && (
          <span className="text-[10px] text-purple-300 bg-purple-500/20 px-1.5 py-0.5 rounded flex-shrink-0">
            +{queueDepth - 1} more queued
          </span>
        )}
        <button
          onClick={onDismiss}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] flex-shrink-0"
          title={t("dismiss", undefined, "Dismiss")}
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      </div>
      <FlowQuestionInput
        type={type}
        options={options}
        defaultValue={defaultValue}
        onSubmit={onSubmit}
      />
    </div>
  );
}

function FlowQuestionInput({
  type,
  options,
  defaultValue,
  onSubmit,
}: {
  type: FlowQuestionCardProps["type"];
  options?: string[];
  defaultValue?: string;
  onSubmit: (answer: string) => void;
}) {
  if (type === "confirm") return <ConfirmRow onSubmit={onSubmit} />;
  if (type === "select") return <SelectRow options={options ?? []} onSubmit={onSubmit} />;
  if (type === "multiselect") return <MultiselectRow options={options ?? []} onSubmit={onSubmit} />;
  return <InputRow defaultValue={defaultValue} onSubmit={onSubmit} />;
}

function ConfirmRow({ onSubmit }: { onSubmit: (answer: string) => void }) {
  return (
    <div className="flex gap-2 justify-end">
      <button
        onClick={() => onSubmit("no")}
        className="px-3 py-1 text-xs rounded border border-[var(--border-primary)] hover:bg-[var(--bg-surface)]"
      >
        No
      </button>
      <button
        onClick={() => onSubmit("yes")}
        className="px-3 py-1 text-xs rounded bg-purple-500 text-white hover:bg-purple-600"
      >
        Yes
      </button>
    </div>
  );
}

function SelectRow({
  options,
  onSubmit,
}: {
  options: string[];
  onSubmit: (answer: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSubmit(opt)}
          className="px-2.5 py-1 text-xs rounded border border-[var(--border-primary)] hover:bg-purple-500/10 hover:border-purple-500/40"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function MultiselectRow({
  options,
  onSubmit,
}: {
  options: string[];
  onSubmit: (answer: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const toggle = (opt: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(opt)) next.delete(opt);
      else next.add(opt);
      return next;
    });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => toggle(opt)}
            className={`px-2.5 py-1 text-xs rounded border ${
              picked.has(opt)
                ? "bg-purple-500/20 border-purple-500"
                : "border-[var(--border-primary)] hover:bg-purple-500/10 hover:border-purple-500/40"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button
          onClick={() => onSubmit(JSON.stringify(Array.from(picked)))}
          disabled={picked.size === 0}
          className="px-3 py-1 text-xs rounded bg-purple-500 text-white hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Submit ({picked.size})
        </button>
      </div>
    </div>
  );
}

function InputRow({
  defaultValue,
  onSubmit,
}: {
  defaultValue?: string;
  onSubmit: (answer: string) => void;
}) {
  const [val, setVal] = useState(defaultValue ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(val);
      }}
      className="flex gap-2"
    >
      <input
        autoFocus
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        className="flex-1 px-2 py-1 text-xs bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded focus:outline-none focus:border-purple-500"
      />
      <button
        type="submit"
        className="px-3 py-1 text-xs rounded bg-purple-500 text-white hover:bg-purple-600"
      >
        Submit
      </button>
    </form>
  );
}
