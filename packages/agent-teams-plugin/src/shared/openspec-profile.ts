/**
 * Names shared by the server profile module and the bridge: which bundled templates carry a profile,
 * the spawn-contributor env key (the host maps `openspecProfile` → `PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE`)
 * and the profile kinds. The env value is a HINT for tool/guard selection only; the server re-checks the
 * profile of the team on every profile tool call.
 * See change: add-agent-teams-openspec.
 */

const OPENSPEC_PROFILE_KINDS = ["group", "apply"] as const;
export type OpenspecProfileKind = (typeof OPENSPEC_PROFILE_KINDS)[number];

/** Bundled template name → profile kind (a profile is bound to the NAME and only to the `bundled` source). */
export const OPENSPEC_TEMPLATE_PROFILES: Readonly<Record<string, OpenspecProfileKind>> = Object.freeze({
  "openspec-group": "group",
  "openspec-apply": "apply",
});

/** `extensionConfig["agent-teams"]` key of the profile hint (env `PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE`). */
export const EXT_KEY_OPENSPEC_PROFILE = "openspecProfile";
export const ENV_OPENSPEC_PROFILE = "PI_EXT_AGENT_TEAMS_OPENSPEC_PROFILE";

/** Profile kind named by a template name, or `undefined` for a plain template. */
export function profileKindOfTemplate(name: string): OpenspecProfileKind | undefined {
  return Object.hasOwn(OPENSPEC_TEMPLATE_PROFILES, name) ? OPENSPEC_TEMPLATE_PROFILES[name] : undefined;
}
