/**
 * Pure link-handling helpers used by the Electron shell to keep external
 * URL clicks from stranding the user on a page outside the dashboard.
 *
 * This module intentionally imports NOTHING from electron so it can be
 * unit-tested in isolation. The shell wiring in `main.ts` is the only
 * code that ties these decisions to `shell.openExternal` /
 * `setWindowOpenHandler` / `will-navigate`.
 *
 * See issue #13 and change: harden-external-link-handling.
 */

/**
 * Returns true when `href` resolves to the same origin as `serverOrigin`.
 *
 * Handles:
 *   - Absolute URLs with matching origin → true
 *   - Absolute URLs with different origin → false
 *   - Relative paths (`/settings`) → true (resolved against serverOrigin)
 *   - Fragment-only hrefs (`#top`) → true
 *   - Malformed hrefs or broken serverOrigin → false (caller treats as
 *     external and routes through shell.openExternal, which itself filters
 *     by scheme).
 *   - `javascript:` / `mailto:` / `data:` etc. → origin is "null", so
 *     these are classified as external. shell.openExternal refuses
 *     `javascript:` by default.
 */
export function isSameOriginUrl(href: string, serverOrigin: string): boolean {
	if (!href) return false;
	let serverOriginParsed: string;
	try {
		serverOriginParsed = new URL(serverOrigin).origin;
	} catch {
		return false;
	}
	try {
		const resolved = new URL(href, serverOrigin);
		return resolved.origin === serverOriginParsed;
	} catch {
		return false;
	}
}

/**
 * Decision helper for the Electron `will-navigate` callback.
 *
 * The naive "intercept any non-same-origin target" rule used by the original
 * `harden-external-link-handling` change breaks dashboard OIDC login: while
 * the user is mid-OAuth on a provider page (e.g. `accounts.google.com`,
 * `github.com`), the provider's own multi-step navigations (login
 * → challenge, challenge → consent, etc.) are also "not same origin" relative
 * to the dashboard, and intercepting them would bounce the user to the OS
 * default browser mid-login.
 *
 * This helper distinguishes by **current page origin**:
 *   - If the BrowserWindow currently shows the dashboard origin and the
 *     navigation target is NOT same-origin → `"open-external"` (the
 *     "trapped in webview" guard fires — hand the URL to
 *     `shell.openExternal` and `event.preventDefault()`).
 *   - If the current page is anywhere else (mid-OAuth on a provider page,
 *     intermediate identity broker, etc.) → `"allow"` and let the navigation
 *     proceed; the eventual redirect back to the dashboard origin is itself
 *     same-origin and lands cleanly.
 *   - If the dashboard origin itself is unparseable → fail closed (`"cancel"`).
 *
 * Same-origin targets always return `"allow"`. The helper does not classify
 * non-http(s) schemes specially — `shell.openExternal` already refuses
 * `javascript:` and `data:`, and the existing flow has shipped this way under
 * `harden-external-link-handling`.
 *
 * Pure helper; imports nothing from electron. Unit-tested in
 * `__tests__/link-handling.test.ts`.
 *
 * See change: fix-oauth-blocked-by-external-link-guard.
 */
export type WillNavigateDecision = "allow" | "open-external" | "cancel";

export function decideWillNavigate(
	serverOrigin: string,
	currentUrl: string,
	targetUrl: string,
): WillNavigateDecision {
	// Validate the dashboard origin first — if we can't parse it we cannot make
	// a safe decision and must fail closed.
	let dashboardOrigin: string;
	try {
		dashboardOrigin = new URL(serverOrigin).origin;
		if (!dashboardOrigin || dashboardOrigin === "null") return "cancel";
	} catch {
		return "cancel";
	}

	// If we know the current page origin and it is NOT the dashboard, this is
	// mid-flight navigation on an external page (e.g. an OAuth provider). Allow
	// it — the only "trap" we care about is leaving the dashboard.
	let currentOrigin: string | null = null;
	try {
		currentOrigin = new URL(currentUrl).origin;
	} catch {
		currentOrigin = null;
	}
	if (currentOrigin !== null && currentOrigin !== dashboardOrigin) {
		return "allow";
	}

	// We're on the dashboard (or the current URL is unparseable — treat that
	// as the dashboard so the trap guard still fires defensively).
	return isSameOriginUrl(targetUrl, dashboardOrigin) ? "allow" : "open-external";
}
