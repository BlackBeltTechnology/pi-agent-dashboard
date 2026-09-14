/**
 * Relay-side CDP deny-list (change: add-browser-relay, spec `browser-relay`
 * "Relay-side CDP deny-list").
 *
 * The relay sits between a pi session's Playwright `connectOverCDP` client and
 * the user's REAL, logged-in Chrome profile, so two things get a policy:
 *
 *  - **Cookie/secret reads and download-path control are always refused.**
 *    They have no legitimate use in the automation the relay exists for, and
 *    `Storage.getCookies` / `Network.getAllCookies` would hand the agent the
 *    user's SSO session tokens.
 *  - **Top-level navigation is fenced** to `http(s)`/other host-bearing schemes
 *    and, when the profile configures `allowedDomains`, to those hosts.
 *
 * `allowedDomains` is a NAVIGATION GUARDRAIL, not a sandbox: it is checked on
 * `Page.navigate` / `Target.createTarget` only, so `Runtime.evaluate`
 * (`location.href = …`), a link click, or an HTTP redirect can still leave the
 * list. The settings help text says so; do not describe it as containment.
 *
 * Denied verbs get a real CDP error (`-32000`, the standard "server error"
 * code) and are never forwarded — a silent drop would leave the client
 * hanging, and a loud failure is what the skill's recipe tells the agent to
 * surface rather than retry.
 */

/** Refused regardless of parameters. */
export const ALWAYS_DENIED_METHODS: readonly string[] = [
  "Storage.getCookies",
  "Network.getAllCookies",
  "Network.getCookies",
  "Browser.setDownloadBehavior",
];

/** Methods whose `url` parameter is subject to the navigation policy. */
const URL_POLICY_METHODS: readonly string[] = ["Page.navigate", "Target.createTarget"];

/** Schemes with no host-bearing navigation semantics. Always refused. */
const DENIED_SCHEMES: readonly string[] = ["file:", "javascript:", "data:", "blob:"];

const DENY_ERROR_CODE = -32000;

/** The CDP error message shape the spec pins. */
function denyErrorMessage(method: string): string {
  return `Denied by dashboard relay policy: ${method}`;
}

export function denyError(method: string): { code: number; message: string } {
  return { code: DENY_ERROR_CODE, message: denyErrorMessage(method) };
}

/** Does one entry admit `host`? Leading dot = bare host + subdomains. */
function matchesEntry(host: string, raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const entry = raw.toLowerCase().trim();
  if (entry === "") return false;
  if (!entry.startsWith(".")) return host === entry;
  const bare = entry.slice(1);
  return bare !== "" && (host === bare || host.endsWith(`.${bare}`));
}

/**
 * Host allowlist match. `entry` with a leading dot matches the bare host and
 * every subdomain; without one it matches the exact host only. Never a
 * suffix-lookalike: `.github.com` must NOT admit `github.com.evil.io`.
 * `host` is already lowercased + port-stripped by `URL.hostname`.
 */
export function hostAllowed(host: string, allowedDomains: readonly string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const h = host.toLowerCase();
  if (h === "") return false;
  return allowedDomains.some((entry) => matchesEntry(h, entry));
}

/** The URL a URL-policy method targets, when present and a string. */
function urlParam(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined;
  const url = (params as { url?: unknown }).url;
  return typeof url === "string" ? url : undefined;
}

/**
 * Decide whether `method` must be refused for this profile's
 * `allowedDomains`. Returns the method name to report (for the error message
 * and the audit `detail`) when denied, or `null` when the command may proceed.
 */
export function deniedMethod(
  method: string,
  params: unknown,
  allowedDomains: readonly string[] = [],
): string | null {
  if (ALWAYS_DENIED_METHODS.includes(method)) return method;
  if (!URL_POLICY_METHODS.includes(method)) return null;

  const raw = urlParam(params);
  // A URL-policy verb with no usable url is malformed → fail closed.
  if (raw === undefined) return method;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    // Unparseable is indistinguishable from hostile for a navigation verb.
    return method;
  }
  if (DENIED_SCHEMES.includes(parsed.protocol)) return method;
  if (!hostAllowed(parsed.hostname, allowedDomains)) return method;
  return null;
}
