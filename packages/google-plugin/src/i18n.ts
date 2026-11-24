/**
 * Google accounts plugin i18n catalog — UNPREFIXED leaf keys, merged by the shell under
 * `plugin.google.*`; components resolve via the scoped `useT()`. English lives at the call sites as the
 * fallback. `zh-CN` and `hu` MUST keep identical key sets (scripts/i18n-parity).
 * See change: add-google-connect.
 */
export const catalog = {
  "zh-CN": {
    title: "Google 账户",
    intro: "在此连接 Google 账户（Gmail、日历、云端硬盘等）。",
  },
  hu: {
    title: "Google-fiókok",
    intro: "Itt kapcsolhatod össze a Google-fiókjaidat (Gmail, Naptár, Drive stb.).",
  },
} as const;
