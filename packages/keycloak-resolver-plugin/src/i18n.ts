/**
 * Keycloak resolver plugin i18n catalog — UNPREFIXED leaf keys.
 *
 * The shell merges this under `plugin.keycloak-resolver.*`; the login component
 * resolves keys via the scoped `useT()` hook (auto-prefixes the id) with an
 * English fallback passed inline. zh-CN and hu keep key parity. The login
 * component renders pre-shell (no shell translator wired), so `useT` returns
 * the inline English fallback there — the catalog covers the in-shell paths.
 * See change: add-multi-user-identity-plane (D16).
 */
export const catalog = {
  "zh-CN": {
    signingIn: "正在跳转到登录…",
    completing: "正在完成登录…",
    signIn: "登录",
    failed: "登录失败。",
    notConfigured: "未配置登录。",
    returnHome: "返回首页",
  },
  hu: {
    signingIn: "Átirányítás a bejelentkezéshez…",
    completing: "Bejelentkezés befejezése…",
    signIn: "Bejelentkezés",
    failed: "A bejelentkezés sikertelen.",
    notConfigured: "A bejelentkezés nincs beállítva.",
    returnHome: "Vissza a főoldalra",
  },
};
