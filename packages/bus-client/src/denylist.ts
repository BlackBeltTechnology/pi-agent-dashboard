/**
 * Client-intercepted denylist.
 *
 * Some `BrowserToServerMessage` union members are NOT forwarded over the WS by
 * the real web client — they are intercepted client-side and routed to REST
 * instead (e.g. `plugin_config_write` → `POST /api/config/plugins/:id`, asserted
 * by `client/src/lib/__tests__/plugin-config-write.test.ts`). Naive codegen from
 * the raw union would emit a WS helper that silently fails. The verb generator
 * therefore excludes every member listed here, and a completeness test asserts
 * every *generated* verb reaches a real server-side handler.
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting (design.md — Verb codegen).
 */
export const CLIENT_INTERCEPTED_DENYLIST: readonly string[] = [
  "plugin_config_write",
] as const;

export function isDenylisted(verbType: string): boolean {
  return CLIENT_INTERCEPTED_DENYLIST.includes(verbType);
}
