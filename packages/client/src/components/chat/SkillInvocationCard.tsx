/**
 * Renders a `<skill name=...>...</skill>` user invocation as a collapsible
 * card. Visually distinct from regular user bubbles (purple-tinted left
 * border, wrench icon) so the user sees at-a-glance that this was a skill
 * invocation, and reads the slash form (`/skill:name args`) in the header.
 *
 * Default state: collapsed (body hidden). The body re-uses `MarkdownContent`
 * so all existing markdown features (mermaid, math, code highlighting, etc.)
 * work inside the expansion.
 *
 * Footer mirrors `MessageBubble`:
 *   - Copy as Markdown — copies the raw stored `<skill>...</skill>` content
 *   - Copy as plain text — copies the rendered DOM innerText (body + args)
 *   - Copy as command   — NEW: copies the condensed slash form
 *   - Fork-from-message — when entryId is provided
 *
 * See change: render-skill-invocations-collapsibly.
 */

import type { SkillBlock } from "@blackbelt-technology/pi-dashboard-shared/skill-block-parser.js";
import {
  mdiChevronDown,
  mdiChevronRight,
  mdiContentCopy,
  mdiMessageOutline,
  mdiSlashForward,
  mdiSourceFork,
  mdiTextBox,
  mdiTools,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useRef, useState } from "react";
import { formatMessageTime } from "../../lib/util/format.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { MarkdownContent } from "../preview/MarkdownContent.js";

interface Props {
  /** Parsed skill metadata stamped on the ChatMessage. */
  skill: SkillBlock;
  /** Raw expanded message content (the full `<skill>...</skill>\n\nargs` string). */
  rawContent: string;
  /** Wall-clock timestamp for display. */
  timestamp?: number;
  /** Pi entry id for fork-from-message. */
  entryId?: string;
  /** Optional className to control max-width / margin from the parent (matches MessageBubble). */
  className?: string;
  /** Fork-from-message callback. */
  onFork?: (entryId: string) => void;
}

export function SkillInvocationCard({
  skill,
  rawContent,
  timestamp,
  entryId,
  className = "",
  onFork,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const getPlainText = useCallback(() => {
    return contentRef.current?.innerText ?? skill.body;
  }, [skill.body]);

  return (
    <div
      className={`bg-purple-500/10 border border-purple-400/30 border-l-2 border-l-purple-400 rounded-xl shadow-md ${className}`}
    >
      {/* Header — always visible. Only the chevron is a button so the
          condensed slash text remains mouse-selectable for drag-copy.
          See change: render-skill-invocations-collapsibly (smoke-test fix 6.7). */}
      <div className="flex items-start gap-2 px-4 py-2">
        <span className="flex-shrink-0 mt-0.5 text-purple-300">
          <Icon path={mdiTools} size={0.7} />
        </span>
        <span className="flex-1 font-mono text-sm break-all whitespace-pre-wrap select-text">
          {skill.condensed}
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 mt-0.5 p-0.5 rounded hover:bg-purple-500/10 text-[var(--text-secondary)]"
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse skill body" : "Expand skill body"}
        >
          <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.7} />
        </button>
      </div>

      {/* Body — only when expanded */}
      {expanded && (
        <div className="px-4 pb-2">
          <div className="border-t border-purple-400/20 pt-2" />
          <div ref={contentRef}>
            <MarkdownContent content={skill.body} />
          </div>
          {skill.args && (
            <>
              <div className="border-t border-purple-400/20 mt-2 pt-2 text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                args
              </div>
              <div className="font-mono text-sm whitespace-pre-wrap mt-1">
                {skill.args}
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer — always visible */}
      <div className="border-t border-purple-400/20 mx-4 mt-1 pt-1.5 pb-1.5 flex justify-end items-center gap-0.5 opacity-50 hover:opacity-100 transition-opacity">
        {timestamp != null && (
          <span className="text-[10px] text-[var(--text-tertiary)] mr-auto">
            {formatMessageTime(timestamp)}
          </span>
        )}
        <CopyButton
          getText={() => rawContent}
          icon={<Icon path={mdiContentCopy} size={0.6} />}
          title={i18nT("common.copyAsMarkdown", undefined, "Copy as Markdown")}
        />
        <CopyButton
          getText={getPlainText}
          icon={<Icon path={mdiTextBox} size={0.6} />}
          title={i18nT("common.copyAsPlainText", undefined, "Copy as plain text")}
        />
        <CopyButton
          getText={() => skill.condensed}
          icon={<Icon path={mdiSlashForward} size={0.6} />}
          title={i18nT("common.copyAsSkillCommand", undefined, "Copy as /skill: command")}
        />
        {skill.args && (
          <CopyButton
            getText={() => skill.args ?? ""}
            icon={<Icon path={mdiMessageOutline} size={0.6} />}
            title={i18nT("session.copyAsMessage", undefined, "Copy as message")}
          />
        )}
        {entryId && onFork && (
          <button
            onClick={() => onFork(entryId)}
            title={i18nT("session.forkFromHere", undefined, "Fork from here")}
            className="p-0.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
          >
            <Icon path={mdiSourceFork} size={0.6} />
          </button>
        )}
      </div>
    </div>
  );
}
