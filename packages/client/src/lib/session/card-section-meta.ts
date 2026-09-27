/**
 * Display metadata for the toggleable session-card sections, shared by the
 * Directory Settings › Session cards page and the global Settings block.
 * Plugin sections carry the slot whose claims gate their settings row.
 * See change: configurable-session-card-sections (design D9).
 */
import { useSlotHasAnyClaims } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { CardSectionId } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { t as i18nT } from "../i18n/i18n.js";

export type CardSectionGroup = "builtin" | "plugin" | "lines";

export interface CardSectionMeta {
  id: CardSectionId;
  group: CardSectionGroup;
  /** Slot whose claims mean "a plugin contributes this section". */
  slot?: "worktree-card-section" | "session-card-badge" | "session-card-flows" | "session-card-memory";
  label: () => string;
  description: () => string;
}

export const CARD_SECTION_META: readonly CardSectionMeta[] = [
  {
    id: "openspec",
    group: "builtin",
    label: () => i18nT("session.subcardOpenspec", undefined, "OPENSPEC"),
    description: () => i18nT("cardSections.descOpenspec", undefined, "Attached change, artifact chips, workflow actions."),
  },
  {
    id: "git",
    group: "builtin",
    label: () => i18nT("session.subcardGit", undefined, "GIT"),
    description: () => i18nT("cardSections.descGit", undefined, "Branch, ahead/behind, worktree pill and actions."),
  },
  {
    id: "process",
    group: "builtin",
    label: () => i18nT("session.subcardProcess", undefined, "PROCESS"),
    description: () =>
      i18nT(
        "cardSections.descProcess",
        undefined,
        "Running bash tools and background processes. When hidden, running background processes still show as a warning chip.",
      ),
  },
  {
    id: "kb",
    group: "plugin",
    slot: "worktree-card-section",
    label: () => i18nT("cardSections.labelKb", undefined, "KB"),
    description: () => i18nT("cardSections.descKb", undefined, "Knowledge-base row (worktree sessions only)."),
  },
  {
    id: "status",
    group: "plugin",
    slot: "session-card-badge",
    label: () => i18nT("session.subcardStatus", undefined, "STATUS"),
    description: () => i18nT("cardSections.descStatus", undefined, "Goal and automation badges."),
  },
  {
    id: "flows",
    group: "plugin",
    slot: "session-card-flows",
    label: () => i18nT("session.subcardFlows", undefined, "FLOWS"),
    description: () => i18nT("cardSections.descFlows", undefined, "Flow launcher and active flow."),
  },
  {
    id: "memory",
    group: "plugin",
    slot: "session-card-memory",
    label: () => i18nT("session.subcardMemory", undefined, "MEMORY"),
    description: () => i18nT("cardSections.descMemory", undefined, "Memory plugin row."),
  },
  {
    id: "tags",
    group: "lines",
    label: () => i18nT("cardSections.labelTags", undefined, "Tags strip"),
    description: () => i18nT("cardSections.descTags", undefined, "User tags and the OpenSpec phase chip."),
  },
  {
    id: "spawn",
    group: "lines",
    label: () => i18nT("cardSections.labelSpawn", undefined, "+Session / +Worktree buttons"),
    description: () => i18nT("cardSections.descSpawn", undefined, "Quick sibling and worktree spawn."),
  },
];

/**
 * Metadata rows to offer as settings: built-in sections and card lines
 * always; plugin sections only when an installed plugin claims their slot.
 * Fixed hook order (one `useSlotHasAnyClaims` per plugin slot).
 */
export function useOfferedCardSections(): readonly CardSectionMeta[] {
  const present: Record<NonNullable<CardSectionMeta["slot"]>, boolean> = {
    "worktree-card-section": useSlotHasAnyClaims("worktree-card-section"),
    "session-card-badge": useSlotHasAnyClaims("session-card-badge"),
    "session-card-flows": useSlotHasAnyClaims("session-card-flows"),
    "session-card-memory": useSlotHasAnyClaims("session-card-memory"),
  };
  return CARD_SECTION_META.filter((m) => !m.slot || present[m.slot]);
}
