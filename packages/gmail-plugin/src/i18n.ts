/**
 * Gmail plugin i18n catalog — UNPREFIXED leaf keys, merged by the shell under
 * `plugin.gmail.*`; components resolve via the scoped `useT()`. English lives
 * at the call sites as the fallback. `zh-CN` and `hu` MUST keep identical key
 * sets (scripts/i18n-parity). Account / client / setup management moved to the
 * Google plugin, so only the pointer notice is left. See change: add-google-connect.
 */
export const catalog = {
  "zh-CN": {
    googleOff: "请开启 Google 账户以管理 Gmail 账户",
    movedLink: "打开 Google 账户",
    movedNotice: "Gmail 账户现在在“设置 → Google 账户”中管理。无需重新连接。",
    title: "Gmail",
  },
  hu: {
    googleOff: "Kapcsold be a Google-fiókokat a Gmail-fiókok kezeléséhez",
    movedLink: "Google-fiókok megnyitása",
    movedNotice: "A Gmail-fiókok kezelése mostantól a Beállítások → Google-fiókok alatt történik. Nem kell újracsatlakoztatni.",
    title: "Gmail",
  },
} as const;
