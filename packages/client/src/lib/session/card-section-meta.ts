/**
 * Display metadata for the toggleable card sections, shared by the Directory
 * Settings › Session cards page and the global Settings block + Focus profile
 * editor. Built-in rows are static; per-plugin rows (`badge-*`, `actionbar-*`,
 * `pill-*`) are generated from the installed plugins' slot claims.
 * See changes: configurable-session-card-sections (design D9),
 * add-focus-mode-and-card-block-toggles (design D3).
 */
import { useSlotHasAnyClaims, useSlotPluginIds } from "@blackbelt-technology/dashboard-plugin-runtime";
import { type PluginSectionKind, pluginSectionId } from "@blackbelt-technology/pi-dashboard-shared/card-sections.js";
import { t as i18nT } from "../i18n/i18n.js";
import { usePluginNames } from "../state/CardSectionsContext.js";

export type CardSectionGroup = "builtin" | "plugin" | "lines" | "directory" | "effects";

export interface CardSectionMeta {
  id: string;
  group: CardSectionGroup;
  /** Slot whose claims mean "a plugin contributes this section". */
  slot?: "worktree-card-section" | "session-card-badge" | "session-card-flows" | "session-card-memory";
  /** Global-only (never offered per folder), e.g. the `fx-*` effects. */
  globalOnly?: boolean;
  label: () => string;
  description: () => string;
}

const CARD_SECTION_META: readonly CardSectionMeta[] = [
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
    id: "openspec-badge",
    group: "lines",
    label: () => i18nT("cardSections.labelOpenspecBadge", undefined, "OpenSpec phase line"),
    description: () =>
      i18nT("cardSections.descOpenspecBadge", undefined, "Phase, change name and task progress (and the mobile attached-proposal chip)."),
  },
  {
    id: "tags",
    group: "lines",
    label: () => i18nT("cardSections.labelTags", undefined, "Tags strip"),
    description: () => i18nT("cardSections.descTags", undefined, "Your tags."),
  },
  {
    id: "spawn",
    group: "lines",
    label: () => i18nT("cardSections.labelSpawn", undefined, "+Session / +Worktree buttons"),
    description: () => i18nT("cardSections.descSpawn", undefined, "Quick new-session and new-worktree buttons."),
  },
  {
    id: "folder-git",
    group: "directory",
    label: () => i18nT("cardSections.labelFolderGit", undefined, "Git row"),
    description: () => i18nT("cardSections.descFolderGit", undefined, "Branch and dirty state on the directory card (the group-by chip stays)."),
  },
  {
    id: "folder-banner",
    group: "directory",
    label: () => i18nT("cardSections.labelFolderBanner", undefined, "Setup banner"),
    description: () =>
      i18nT("cardSections.descFolderBanner", undefined, "Setup / init / re-trust banner. When hidden, a compact warning chip still shows if the folder needs action."),
  },
  {
    id: "folder-openspec",
    group: "directory",
    label: () => i18nT("cardSections.labelFolderOpenspec", undefined, "OpenSpec pill"),
    description: () => i18nT("cardSections.descFolderOpenspec", undefined, "OpenSpec status pill on the directory card."),
  },
  {
    id: "folder-create",
    group: "directory",
    label: () => i18nT("cardSections.labelFolderCreate", undefined, "Create buttons"),
    description: () => i18nT("cardSections.descFolderCreate", undefined, "CREATE divider, new-session / new-worktree buttons and the SESSIONS divider."),
  },
  {
    id: "folder-ended",
    group: "directory",
    label: () => i18nT("cardSections.labelFolderEnded", undefined, "Ended sessions row"),
    description: () => i18nT("cardSections.descFolderEnded", undefined, "The “Show N ended” expander."),
  },
  {
    id: "fx-status-animation",
    group: "effects",
    globalOnly: true,
    label: () => i18nT("cardSections.labelFxStatus", undefined, "Animated status gradients"),
    description: () =>
      i18nT("cardSections.descFxStatus", undefined, "Running / unread / needs-input cards sweep. Off keeps a static tint in the same color."),
  },
  {
    id: "fx-selected-glow",
    group: "effects",
    globalOnly: true,
    label: () => i18nT("cardSections.labelFxGlow", undefined, "Selected-card glow"),
    description: () => i18nT("cardSections.descFxGlow", undefined, "Rotating glow ring on the selected card. Off keeps the static selected border."),
  },
];

function pluginRows(
  kind: PluginSectionKind,
  pluginIds: readonly string[],
  names: Record<string, string> | undefined,
  group: CardSectionGroup,
): CardSectionMeta[] {
  const rows: CardSectionMeta[] = [];
  for (const pid of pluginIds) {
    const id = pluginSectionId(kind, pid);
    if (id === null) continue; // invalid derived id → no switch, always visible
    const name = names?.[pid] ?? pid;
    rows.push({
      id,
      group,
      label: () =>
        kind === "badge"
          ? i18nT("cardSections.labelPluginBadge", { plugin: name }, "{plugin} badge")
          : kind === "actionbar"
            ? i18nT("cardSections.labelPluginActionbar", { plugin: name }, "{plugin} actions")
            : i18nT("cardSections.labelPluginPill", { plugin: name }, "{plugin} pill"),
      description: () =>
        kind === "badge"
          ? i18nT("cardSections.descPluginBadge", { plugin: name }, "Badges contributed by {plugin} on the session card.")
          : kind === "actionbar"
            ? i18nT("cardSections.descPluginActionbar", { plugin: name }, "Footer actions contributed by {plugin}.")
            : i18nT("cardSections.descPluginPill", { plugin: name }, "Pill contributed by {plugin} on the directory card."),
    });
  }
  return rows;
}

/**
 * Metadata rows to offer as settings: built-in sections, lines, directory
 * blocks and effects always; plugin sections only when an installed plugin
 * claims their slot; per-plugin badge / action-bar / pill rows generated from
 * the claims. Fixed hook order.
 */
export function useOfferedCardSections(): readonly CardSectionMeta[] {
  const present: Record<NonNullable<CardSectionMeta["slot"]>, boolean> = {
    "worktree-card-section": useSlotHasAnyClaims("worktree-card-section"),
    "session-card-badge": useSlotHasAnyClaims("session-card-badge"),
    "session-card-flows": useSlotHasAnyClaims("session-card-flows"),
    "session-card-memory": useSlotHasAnyClaims("session-card-memory"),
  };
  const badgeIds = useSlotPluginIds("session-card-badge");
  const actionIds = useSlotPluginIds("session-card-action-bar");
  const pillIds = useSlotPluginIds("sidebar-folder-section");
  const names = usePluginNames();
  const fixed = CARD_SECTION_META.filter((m) => !m.slot || present[m.slot]);
  const plugin = [
    ...pluginRows("badge", badgeIds, names, "plugin"),
    ...pluginRows("actionbar", actionIds, names, "plugin"),
  ];
  const pills = pluginRows("pill", pillIds, names, "directory");
  // Group order is stable: fixed rows first, generated rows appended per group.
  return [...fixed, ...plugin, ...pills];
}
