import React from "react";

export interface FlowTab {
  id: string;
  label: string;
  isActive: boolean;
}

export function FlowTabBar({
  tabs,
  activeTabId,
  followMode,
  onTabClick,
  onToggleFollow,
}: {
  tabs: FlowTab[];
  activeTabId: string;
  followMode: boolean;
  onTabClick: (tabId: string) => void;
  onToggleFollow: () => void;
}) {
  if (tabs.length <= 1) return null; // No tab bar for single flow

  return (
    <div className="flex items-center gap-1 mb-1.5 overflow-x-auto text-[11px]">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabClick(tab.id)}
          className={`px-2 py-0.5 rounded border whitespace-nowrap ${
            tab.id === activeTabId
              ? "border-blue-500/40 text-blue-400 bg-blue-500/10"
              : "border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          }`}
        >
          {tab.label}
        </button>
      ))}
      <button
        onClick={onToggleFollow}
        className={`ml-auto px-1.5 py-0.5 rounded border text-[10px] whitespace-nowrap ${
          followMode
            ? "border-green-500/40 text-green-400 bg-green-500/10"
            : "border-[var(--border-subtle)] text-[var(--text-tertiary)]"
        }`}
        title={followMode ? "Following latest active flow" : "Click to follow latest active flow"}
      >
        FOLLOW
      </button>
    </div>
  );
}
