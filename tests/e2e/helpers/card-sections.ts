/**
 * Server-side setup/teardown glue for the card-block / Focus / accordion L3
 * specs. Card-section prefs, Focus state and pinned-open folders live in
 * `preferences.json` and OUTLIVE the page and the spec file, so every spec
 * must restore what it touched (shared container).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { busSend } from "./folder-collapse.js";

export async function setSectionViaBus(section: string, visible: boolean | null, path?: string): Promise<void> {
  await busSend([
    path === undefined
      ? { type: "set_card_section_visibility", section, visible }
      : { type: "set_card_section_visibility", path, section, visible },
  ]);
}

export async function setExpandedViaBus(path: string, expanded: boolean): Promise<void> {
  await busSend([{ type: "set_folder_expanded", path, expanded }]);
}

/** Put Focus off, reset its profile, and clear the given global section keys. */
export async function resetCardPrefs(globalKeys: string[] = []): Promise<void> {
  await busSend([
    { type: "set_focus_mode", enabled: false },
    { type: "set_focus_profile", profile: null },
    ...globalKeys.map((section) => ({ type: "set_card_section_visibility" as const, section, visible: null })),
  ]);
}
