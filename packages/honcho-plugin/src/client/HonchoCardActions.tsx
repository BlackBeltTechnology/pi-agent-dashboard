/**
 * HonchoCardActions — session-card-memory slot.
 * Returns null when extension uninstalled.
 * Renders [Brain Interview] [Sync] [Tag Map name] icon-buttons.
 * Uses MDI icons for size consistency.
 * Tasks 7.2–7.4.
 */
import React, { useState } from "react";
import Icon from "@mdi/react";
import { mdiBrain, mdiSync, mdiTagOutline, mdiLoading } from "@mdi/js";
import { useExtensionInstalled } from "./hooks.js";
import { triggerSync, submitInterview } from "./api.js";

interface Props {
  cwd?: string;
  onOpenPopover?: (anchorId: string) => void;
  sessionId?: string;
}

export function HonchoCardActions({ cwd: _cwd, onOpenPopover, sessionId }: Props) {
  const { installed, checking } = useExtensionInstalled();
  const [interviewOpen, setInterviewOpen] = useState(false);
  const [interviewText, setInterviewText] = useState("");
  const [interviewBusy, setInterviewBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  if (checking || !installed) return null;

  const handleSync = async () => {
    setSyncBusy(true);
    try {
      await triggerSync();
    } finally {
      setSyncBusy(false);
    }
  };

  const handleInterview = async () => {
    if (!interviewText.trim()) return;
    setInterviewBusy(true);
    try {
      await submitInterview(interviewText.trim());
      setInterviewText("");
      setInterviewOpen(false);
    } finally {
      setInterviewBusy(false);
    }
  };

  const handleMapName = () => {
    if (onOpenPopover && sessionId) {
      onOpenPopover(`honcho-map-${sessionId}`);
    }
  };

  // Match dashboard convention from SessionOpenSpecActions exactly.
  // text-[10px] is critical: without it, buttons inherit parent font-size and
  // line-height inflates them from 18-20px → 24px (visible inconsistency).
  const btnClass =
    "inline-flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400 hover:border-blue-500/50 disabled:opacity-40 disabled:cursor-not-allowed";

  // Inline vertical-align: middle on every button so they sit on the same
  // line as sibling pills (e.g. HonchoBadge). Without this, the buttons
  // baseline-align via their internal SVG (bottom edge) and float ~2-3px
  // higher than pills that align by text middle.
  const btnStyle = { verticalAlign: "middle" as const };

  return (
    // verticalAlign: middle on the outer wrapper so the entire action bar
    // aligns with sibling pills (e.g. HonchoBadge) on the same line.
    // Without this, the wrapper sits ~2px higher (baseline-aligned) than
    // the middle-aligned pills.
    <div className="inline-flex gap-1" style={{ verticalAlign: "middle" }}>
      {/* Interview — wrapper must be inline-flex so it doesn't create a
          tall line-box (24px from inherited font/line-height) and force
          sibling buttons to stretch via flex align-items: stretch.
          verticalAlign: middle keeps wrapper baseline aligned with pills. */}
      <div className="relative inline-flex" style={{ verticalAlign: "middle" }}>
        <button
          onClick={() => setInterviewOpen(!interviewOpen)}
          className={btnClass}
          style={btnStyle}
          title="Save a preference (Honcho interview)"
          aria-label="Honcho interview"
        >
          <Icon path={mdiBrain} size={0.5} />
        </button>
        {interviewOpen && (
          <div className="absolute z-50 bottom-full mb-1 left-0 w-52 bg-[var(--bg-secondary)] border border-[var(--border)] rounded shadow-lg p-2 space-y-1">
            <input
              type="text"
              value={interviewText}
              onChange={(e) => setInterviewText(e.target.value)}
              placeholder="Save a preference…"
              className="w-full bg-[var(--bg)] text-[var(--text)] border border-[var(--border)] rounded px-2 py-1 text-[10px]"
              onKeyDown={(e) => e.key === "Enter" && handleInterview()}
              autoFocus
            />
            <button
              onClick={handleInterview}
              disabled={interviewBusy || !interviewText.trim()}
              className="text-[10px] px-2 py-0.5 rounded bg-blue-600 text-white disabled:opacity-50 inline-flex items-center gap-1"
            >
              {interviewBusy && <Icon path={mdiLoading} size={0.4} spin />}
              Save
            </button>
          </div>
        )}
      </div>

      {/* Sync */}
      <button
        onClick={handleSync}
        disabled={syncBusy}
        className={btnClass}
        style={btnStyle}
        title="Force refresh (Honcho sync)"
        aria-label="Honcho sync"
      >
        <Icon path={syncBusy ? mdiLoading : mdiSync} size={0.5} spin={syncBusy} />
      </button>

      {/* Map name */}
      <button
        onClick={handleMapName}
        className={btnClass}
        style={btnStyle}
        title="Map Honcho session name"
        aria-label="Honcho map name"
      >
        <Icon path={mdiTagOutline} size={0.5} />
      </button>
    </div>
  );
}
