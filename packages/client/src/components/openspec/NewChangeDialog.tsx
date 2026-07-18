import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { mdiSend } from "@mdi/js";
import { Icon } from "@mdi/react";
import type React from "react";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

interface Props {
  onSend: (prompt: string) => void;
  onClose: () => void;
}

export function formatNewChangePrompt(name: string, description: string): string {
  const trimName = name.trim();
  const trimDesc = description.trim();
  if (trimName && trimDesc) return `/skill:openspec-new-change ${trimName}\n${trimDesc}`;
  if (trimName) return `/skill:openspec-new-change ${trimName}`;
  if (trimDesc) return `/skill:openspec-new-change\n${trimDesc}`;
  return "/skill:openspec-new-change";
}

export function NewChangeDialog({ onSend, onClose }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const handleSend = () => {
    onSend(formatNewChangePrompt(name, description));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleSend();
    }
  };

  return (
    <Dialog open onClose={onClose} title={i18nT("openspec.newChange", undefined, "New Change")} testId="new-change-dialog">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={i18nT("common.changeNameOptional", undefined, "change-name (optional)")}
          className="w-full bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded p-2 text-sm text-[var(--text-secondary)] focus:outline-none focus:border-blue-500"
          autoFocus
          data-testid="new-change-name"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={i18nT("common.descriptionOptional", undefined, "Description (optional)")}
          className="w-full h-24 bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded p-2 text-sm text-[var(--text-secondary)] resize-none focus:outline-none focus:border-blue-500"
          data-testid="new-change-description"
        />
        <Dialog.Footer>
          <Dialog.Cancel onClick={onClose} testId="new-change-cancel" />
          <Dialog.Action onClick={handleSend} testId="new-change-send">
            <Icon path={mdiSend} size={0.45} className="inline mr-0.5" />{i18nT("common.send", undefined, "Send")}
          </Dialog.Action>
        </Dialog.Footer>
    </Dialog>
  );
}
