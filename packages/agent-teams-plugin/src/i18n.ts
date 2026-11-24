/**
 * Agent-teams plugin i18n catalog — UNPREFIXED leaf keys, merged by the shell
 * under `plugin.agent-teams.*` and resolved by the scoped `useT()`. English
 * lives in each `t(key, vars, default)` fallback. zh-CN and hu MUST keep
 * identical key sets; `{var}` placeholders are interpolated by `t`.
 *
 * Minimal in the core change: the plugin claims no client slots yet (the team
 * UI is a later change). The export exists so the manifest's `i18nCatalog` and
 * the generated plugin registry resolve; `scripts/i18n-parity.mjs` skips empty
 * catalogs, so one real key keeps the plugin covered by the parity gate.
 * See change: add-agent-teams-core.
 */
export const catalog = {
  "zh-CN": {
    title: "智能体团队",
  },
  hu: {
    title: "Ügynökcsapatok",
  },
};
