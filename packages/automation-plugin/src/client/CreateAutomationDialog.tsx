/**
 * Create-automation editor dialog. Collects trigger (schedule cron), action
 * (prompt | skill), model (`@role` or provider/model id), scope (folder |
 * global), mode, sandbox, concurrency, and an OPTIONAL per-automation
 * visibility override, then writes `automation.yaml` (+ `prompt.md`) to the
 * chosen scope via the create route.
 *
 * See change: add-automation-plugin.
 */
import React, { useState } from "react";
import { createAutomation } from "./api.js";
import type {
  AutomationConfig,
  AutomationScope,
  Concurrency,
  RunMode,
  Sandbox,
  Visibility,
} from "../shared/automation-types.js";

export interface CreateAutomationDialogProps {
  /** Repo cwd used for folder-scope writes. */
  cwd?: string;
  onClose: () => void;
  onCreated?: () => void;
}

type VisibilityChoice = "default" | Visibility;

export function CreateAutomationDialog({
  cwd,
  onClose,
  onCreated,
}: CreateAutomationDialogProps): React.ReactElement {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<AutomationScope>("folder");
  const [cron, setCron] = useState("0 9 * * 1");
  const [actionKind, setActionKind] = useState<"prompt" | "skill">("prompt");
  const [promptBody, setPromptBody] = useState("");
  const [skill, setSkill] = useState("");
  const [model, setModel] = useState("@fast");
  const [mode, setMode] = useState<RunMode>("worktree");
  const [sandbox, setSandbox] = useState<Sandbox>("workspace-write");
  const [concurrency, setConcurrency] = useState<Concurrency>("skip");
  const [visibility, setVisibility] = useState<VisibilityChoice>("default");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    setError(null);
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    const config: AutomationConfig = {
      on: { kind: "schedule", cron: cron.trim() },
      action:
        actionKind === "prompt"
          ? { kind: "prompt", prompt: "./prompt.md" }
          : { kind: "skill", skill: skill.trim().startsWith("$") ? skill.trim() : `$${skill.trim()}` },
      model: model.trim(),
      mode,
      sandbox,
      concurrency,
      ...(visibility !== "default" ? { visibility } : {}),
    };
    setBusy(true);
    const res = await createAutomation({
      scope,
      ...(scope === "folder" && cwd ? { cwd } : {}),
      name: name.trim(),
      config,
      ...(actionKind === "prompt" ? { promptBody } : {}),
    });
    setBusy(false);
    if (res.ok) {
      onCreated?.();
      onClose();
    } else {
      setError(res.error ?? "Failed to create automation.");
    }
  }

  return (
    <div
      data-testid="create-automation-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4 space-y-3 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Create Automation</h2>

        <Field label="Name">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="weekly-brief"
            data-testid="create-name"
            className="input font-mono"
          />
        </Field>

        <Field label="Scope">
          <select value={scope} onChange={(e) => setScope(e.target.value as AutomationScope)} data-testid="create-scope" className="input">
            <option value="folder">folder (this repo)</option>
            <option value="global">global (~/.pi/automation)</option>
          </select>
        </Field>

        <Field label="Schedule (cron)">
          <input type="text" value={cron} onChange={(e) => setCron(e.target.value)} data-testid="create-cron" className="input font-mono" />
        </Field>

        <Field label="Action">
          <select value={actionKind} onChange={(e) => setActionKind(e.target.value as "prompt" | "skill")} data-testid="create-action-kind" className="input">
            <option value="prompt">prompt</option>
            <option value="skill">skill</option>
          </select>
        </Field>

        {actionKind === "prompt" ? (
          <Field label="Prompt (durable, saved to prompt.md)">
            <textarea
              value={promptBody}
              onChange={(e) => setPromptBody(e.target.value)}
              rows={4}
              data-testid="create-prompt"
              className="input"
            />
          </Field>
        ) : (
          <Field label="Skill ($skill-name)">
            <input type="text" value={skill} onChange={(e) => setSkill(e.target.value)} placeholder="$recent-code-bugfix" data-testid="create-skill" className="input font-mono" />
          </Field>
        )}

        <Field label="Model (provider/model id or @role)">
          <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="@fast" data-testid="create-model" className="input font-mono" />
        </Field>

        <div className="grid grid-cols-3 gap-2">
          <Field label="Mode">
            <select value={mode} onChange={(e) => setMode(e.target.value as RunMode)} data-testid="create-mode" className="input">
              <option value="worktree">worktree</option>
              <option value="local">local</option>
            </select>
          </Field>
          <Field label="Sandbox">
            <select value={sandbox} onChange={(e) => setSandbox(e.target.value as Sandbox)} data-testid="create-sandbox" className="input">
              <option value="read-only">read-only</option>
              <option value="workspace-write">workspace-write</option>
              <option value="full-access">full-access</option>
            </select>
          </Field>
          <Field label="Concurrency">
            <select value={concurrency} onChange={(e) => setConcurrency(e.target.value as Concurrency)} data-testid="create-concurrency" className="input">
              <option value="skip">skip</option>
              <option value="queue">queue</option>
              <option value="parallel">parallel</option>
            </select>
          </Field>
        </div>

        <Field label="Board visibility override">
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as VisibilityChoice)} data-testid="create-visibility" className="input">
            <option value="default">use settings default</option>
            <option value="hidden">hidden</option>
            <option value="shown">shown</option>
          </select>
        </Field>

        {error && (
          <p className="text-xs text-[var(--danger,#ef4444)]" data-testid="create-error">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-1 text-xs rounded border border-[var(--border-secondary)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            data-testid="create-submit"
            className="px-3 py-1 text-xs rounded bg-[var(--accent,#6366f1)] text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <label className="block text-xs text-[var(--text-secondary)]">
      <span className="block mb-0.5">{label}</span>
      {children}
    </label>
  );
}
