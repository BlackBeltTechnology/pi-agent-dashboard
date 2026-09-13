/**
 * Browser plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The generated plugin registry imports the `catalog` named export (declared
 * as `i18nCatalog` in package.json's `pi-dashboard-plugin` manifest) and the
 * shell merges it under `plugin.browser.*`. zh-CN and hu MUST keep parity
 * (identical key sets). Real entries land with workstream 4 (client); this
 * stub keeps the catalog contract in place from day one.
 *
 * See change: add-browser-relay (task 2.1).
 */
export const catalog = {
  "zh-CN": {},
  hu: {},
} as const;
