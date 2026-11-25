/**
 * Agent-teams plugin i18n catalog — UNPREFIXED leaf keys, merged by the shell
 * under `plugin.agent-teams.*` and resolved by the scoped `useT()`. It is a
 * static export of the main client entry, so it lands in the cold index chunk:
 * it holds the session-card BADGE labels only (design D9, budget ≤ 400 B gz).
 * Every other string lives in the en/zh-CN/hu tables of the lazy modules
 * (picked with `useLanguage()`), never here. `{var}` placeholders are
 * interpolated by `t`; the call-site fallback equals the `en` block.
 * See change: add-agent-teams-core, add-agent-teams-ui (task 9.5).
 */
export const catalog = {
  en: {
    badgeLead: "Lead",
    badgeTeam: "Team",
    badgeOpen: "Open team view, {role}",
  },
  "zh-CN": {
    badgeLead: "组长",
    badgeTeam: "团队",
    badgeOpen: "打开团队视图，{role}",
  },
  hu: {
    badgeLead: "Vezető",
    badgeTeam: "Csapat",
    badgeOpen: "Csapatnézet megnyitása, {role}",
  },
};
