import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { mdiSend } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

/**
 * Propose dialog — name-only (optional) launcher for the `propose` workflow.
 *
 * Distinct from NewChangeDialog (`new`): propose creates the change AND all
 * planning artifacts in one step, so it needs no separate description field —
 * just an optional change name (or short description). The `propose` skill
 * accepts a kebab-case name OR a plain description as its single argument.
 *
 * See change: add-openspec-profile-settings (split-propose-button).
 */
interface Props {
  onSend: (prompt: string) => void;
  onClose: () => void;
}

export function formatProposePrompt(name: string): string {
  const trimmed = name.trim();
  return trimmed ? `/skill:openspec-propose ${trimmed}` : "/skill:openspec-propose";
}

export function ProposeDialog({ onSend, onClose }: Props) {
  const [name, setName] = useState("");

  const handleSend = () => {
    onSend(formatProposePrompt(name));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      // Single-field dialog: plain Enter submits.
      handleSend();
    }
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("common.proposeChange", undefined, "Propose Change")} testId="propose-dialog">
      <p className="text-xs text-[var(--text-tertiary)] mb-2">
        {i18nT("common.createsAChangeAndGeneratesAll", undefined, "Creates a change and generates all planning artifacts in one step.")}
      </p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={i18nT("common.changeNameOrDescriptionOptional", undefined, "change-name or description (optional)")}
        className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded p-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500"
        autoFocus
        data-testid="propose-name"
      />
      <Dialog.Footer>
        <Dialog.Cancel onClick={onClose} testId="propose-cancel" />
        <Dialog.Action onClick={handleSend} testId="propose-send">
          <Icon path={mdiSend} size={0.45} className="inline mr-0.5" />{i18nT("common.propose", undefined, "Propose")}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
