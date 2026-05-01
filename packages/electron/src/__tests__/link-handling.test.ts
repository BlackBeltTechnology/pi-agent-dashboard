import { describe, it, expect } from "vitest";
import { decideWillNavigate, isSameOriginUrl } from "../lib/link-handling.js";

describe("isSameOriginUrl", () => {
	const origin = "http://localhost:8000";

	it("returns true for a same-origin absolute URL", () => {
		expect(isSameOriginUrl("http://localhost:8000/settings", origin)).toBe(true);
	});

	it("returns true for the auth-login redirect style URL", () => {
		// Mirrors App.tsx:673 — /auth/login?return=/ resolved against server origin
		expect(isSameOriginUrl("http://localhost:8000/auth/login?return=/", origin)).toBe(true);
	});

	it("returns true for a relative path", () => {
		expect(isSameOriginUrl("/settings", origin)).toBe(true);
	});

	it("returns true for a relative path with query and fragment", () => {
		expect(isSameOriginUrl("/auth/login?return=/#top", origin)).toBe(true);
	});

	it("returns true for a fragment-only href", () => {
		expect(isSameOriginUrl("#section", origin)).toBe(true);
	});

	it("returns false for a different-origin https URL", () => {
		expect(isSameOriginUrl("https://example.com", origin)).toBe(false);
	});

	it("returns false for a different-scheme URL against http origin", () => {
		expect(isSameOriginUrl("https://localhost:8000/", origin)).toBe(false);
	});

	it("returns false for a different port", () => {
		expect(isSameOriginUrl("http://localhost:9000/", origin)).toBe(false);
	});

	it("returns false for different host even if port matches", () => {
		expect(isSameOriginUrl("http://127.0.0.1:8000/", origin)).toBe(false);
	});

	it("returns false for a javascript: URL", () => {
		// Parses with origin "null" — not same-origin — so caller routes it
		// through shell.openExternal, which Electron refuses by default.
		expect(isSameOriginUrl("javascript:alert(1)", origin)).toBe(false);
	});

	it("returns false for a mailto: URL", () => {
		expect(isSameOriginUrl("mailto:foo@example.com", origin)).toBe(false);
	});

	it("returns false for a malformed URL", () => {
		expect(isSameOriginUrl("http:///", origin)).toBe(false);
	});

	it("returns false for an empty string", () => {
		expect(isSameOriginUrl("", origin)).toBe(false);
	});

	it("returns true for a same-origin URL with implicit default port", () => {
		// https://example.com on https origin → both normalize to port 443
		expect(isSameOriginUrl("https://example.com/foo", "https://example.com")).toBe(true);
	});

	it("returns false when the server origin itself is malformed", () => {
		// Defensive: if the caller passes a broken origin we should not crash
		// and should not treat anything as same-origin.
		expect(isSameOriginUrl("http://localhost:8000/", "not a url")).toBe(false);
	});
});

describe("decideWillNavigate (current-origin-aware will-navigate decision)", () => {
	const SERVER = "http://localhost:8000";

	it("on dashboard → same-origin absolute target is allowed", () => {
		expect(
			decideWillNavigate(SERVER, "http://localhost:8000/sessions", "http://localhost:8000/x"),
		).toBe("allow");
	});

	it("on dashboard → same-origin relative target is allowed", () => {
		// Mirrors /auth/login?return=/ from useAuthStatus.redirectToLogin.
		expect(decideWillNavigate(SERVER, "http://localhost:8000/", "/auth/login?return=/")).toBe(
			"allow",
		);
	});

	it("on dashboard → external http(s) target opens externally", () => {
		expect(decideWillNavigate(SERVER, "http://localhost:8000/", "https://example.com/")).toBe(
			"open-external",
		);
		expect(decideWillNavigate(SERVER, "http://localhost:8000/", "http://other-host:8000/")).toBe(
			"open-external",
		);
	});

	it("on OAuth provider → provider-internal navigation is allowed (OIDC fix)", () => {
		// User is mid-login on accounts.google.com; Google's own multi-step
		// navigation must NOT be intercepted by the dashboard guard. This is
		// the regression in harden-external-link-handling that this change fixes.
		expect(
			decideWillNavigate(
				SERVER,
				"https://accounts.google.com/signin/oauth",
				"https://accounts.google.com/signin/v2/challenge/pwd",
			),
		).toBe("allow");
	});

	it("on OAuth provider → navigation back to dashboard origin is allowed", () => {
		expect(
			decideWillNavigate(
				SERVER,
				"https://accounts.google.com/signin/oauth",
				"http://localhost:8000/auth/callback/google?code=abc",
			),
		).toBe("allow");
	});

	it("on OAuth provider → navigation to a third-party identity broker is allowed", () => {
		// Conservative: once we're already off-dashboard we don't second-guess
		// where the flow goes next. The trap we care about is dashboard→external.
		expect(
			decideWillNavigate(
				SERVER,
				"https://accounts.google.com/",
				"https://login.microsoftonline.com/oauth2/authorize",
			),
		).toBe("allow");
	});

	it("unparseable current URL → falls back to leaving-dashboard rules", () => {
		// Defensive: if we cannot read the current URL we treat the call as if it
		// were dashboard→target so the trap guard still fires.
		expect(decideWillNavigate(SERVER, "", "https://example.com/")).toBe("open-external");
		expect(decideWillNavigate(SERVER, "", "http://localhost:8000/")).toBe("allow");
	});

	it("unparseable server origin → cancels everything (fail closed)", () => {
		expect(
			decideWillNavigate("not a url", "http://localhost:8000/", "https://example.com/"),
		).toBe("cancel");
	});
});
