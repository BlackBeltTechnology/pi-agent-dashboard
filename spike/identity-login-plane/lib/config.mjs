/**
 * Login-plane config. The plugin offers sign-in ONLY when Keycloak is
 * configured: an http(s) `issuer` AND a `clientId`. There is NO built-in
 * default — an unconfigured plugin registers no routes and no login
 * descriptor, so core never shows a sign-in for a Keycloak nobody set up.
 *
 * Source order per field: plugin config (`plugins["identity-login-plane"]`
 * in config.json) → env (`PI_LOGIN_ISSUER` / `PI_LOGIN_BROWSER_ISSUER` /
 * `PI_LOGIN_CLIENT_ID`, used by the docker + e2e harnesses).
 *
 * @returns {{ok:true, issuer:string, browserIssuer:string, clientId:string} | {ok:false, missing:string[]}}
 */
export function resolveLoginPlaneConfig(pluginConfig, env) {
  const cfg = pluginConfig && typeof pluginConfig === "object" ? pluginConfig : {};
  const pick = (key, envKey) => {
    for (const v of [cfg[key], env?.[envKey]]) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  const issuer = httpUrl(pick("issuer", "PI_LOGIN_ISSUER"));
  const clientId = pick("clientId", "PI_LOGIN_CLIENT_ID");
  const missing = [...(issuer ? [] : ["issuer"]), ...(clientId ? [] : ["clientId"])];
  if (missing.length > 0) return { ok: false, missing };
  const browserIssuer = httpUrl(pick("browserIssuer", "PI_LOGIN_BROWSER_ISSUER")) ?? issuer;
  return { ok: true, issuer, browserIssuer, clientId };
}

function httpUrl(value) {
  if (!value) return undefined;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  } catch {
    return undefined;
  }
  return value.replace(/\/+$/, "");
}
