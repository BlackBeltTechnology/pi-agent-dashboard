/**
 * AgentCardShell: reusable card container for agent-like UI.
 * Provides: status-colored border, header row (icon + name), optional stats line.
 * Consumers pass tool-specific content as children.
 */
import React, { type ReactNode } from "react";
import { getStatusIcon } from "./agent-card-utils.js";

interface Props {
  /** Agent display name (e.g. "Explore", "general-purpose") */
  name: string;
  /** Status key for icon + border color */
  status: string;
  /** Optional right-aligned header content (e.g. duration badge) */
  headerRight?: ReactNode;
  /** Optional stats line below header */
  stats?: ReactNode;
  /** Whether the card is clickable/selected */
  onClick?: () => void;
  selected?: boolean;
  /** Tool-specific content */
  children?: ReactNode;
}

export function AgentCardShell({ name, status, headerRight, stats, onClick, selected, children }: Props) {
  const { icon, color } = getStatusIcon(status);

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-2.5 transition-all duration-150 flex flex-col
        ${onClick ? "cursor-pointer hover:shadow-md" : ""}
        ${selected ? "border-blue-500/60 bg-[var(--bg-surface)]" : "border-[var(--border-subtle)] bg-[color-mix(in_srgb,var(--bg-secondary),var(--bg-tertiary))]"}
        ${status === "running" ? "border-yellow-500/30" : ""}
        ${status === "error" ? "border-red-500/30" : ""}
        ${status === "queued" ? "border-dashed !border-[var(--severity-neutral-border)]" : ""}
      `}
    >
      {/* Header: icon + name + optional right content */}
      <div className="flex items-center gap-1.5">
        <span className={`${color} inline-flex`}>{icon}</span>
        <span className="text-sm font-medium text-[var(--text-primary)] truncate flex-1">{name}</span>
        {headerRight}
      </div>

      {/* Stats line */}
      {stats && (
        <div className="text-[11px] text-[var(--text-tertiary)] mt-0.5 truncate">
          {stats}
        </div>
      )}

      {/* Tool-specific content */}
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
}
