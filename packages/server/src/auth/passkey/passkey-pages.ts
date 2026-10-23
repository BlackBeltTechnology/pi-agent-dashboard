/**
 * Server-rendered pre-auth passkey pages (design D5; tasks 4B.5).
 *
 * Pre-auth surfaces cannot use the SPA: under OAuth every non-`/auth/` asset
 * needs a session. So, like the existing login page, these are small server-
 * rendered HTML pages. They hold NO inline script or style: the page script and
 * stylesheet are static same-origin assets (`passkey-assets.ts`, served under
 * `/auth/passkey/`) next to the `@simplewebauthn/browser` UMD bundle at
 * `/auth/passkey/webauthn.js`, so the strict CSP (`script-src 'self'`) covers them.
 *
 * XSS discipline: no untrusted value is interpolated into HTML. Requester
 * metadata is written with `textContent`; the QR is an `<img>` data URL; the
 * only server-interpolated value is the sanitized return path, in a
 * `<script type="application/json">` data island (`<`/U+2028/U+2029 escaped).
 *
 * Secrets ride the URL FRAGMENT (`/auth/invite#<token>`, `/auth/phone#<token>`)
 * so they never reach server logs, and the page strips the fragment at once.
 *
 * See change: add-passkey-user-auth; harden-cors-and-csp-reporting (D9).
 */
import type { RpContext, UnstableReason } from "./rp-context.js";

const UNSTABLE_REASON_TEXT: Record<UnstableReason, string> = {
  ephemeral_tunnel:
    "The dashboard's primary address is temporary (ephemeral tunnel). Use a reserved zrok name or Tailscale, or set auth.redirectBaseUrl.",
  no_public_origin: "No public HTTPS address is configured for this dashboard.",
  not_https: "The dashboard's public address is not HTTPS.",
  ip_or_localhost: "Passkeys need a domain name, not an IP address or localhost.",
  invalid_origin: "auth.redirectBaseUrl is not a valid URL.",
};

function shell(title: string, inner: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>PI Dashboard — ${title}</title>
<link rel="stylesheet" href="/auth/passkey/pages.css">
</head><body><div class="card">${inner}</div></body></html>`;
}

/** JSON for a `<script type="application/json">` data island (cannot close the tag or break a JS line). */
function scriptJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

/**
 * Passkey section appended to the OAuth login card. Shown whenever passkeys
 * are enabled; DISABLED with the reason (never hidden) on an unstable origin.
 */
export function renderLoginPasskeySection(rp: RpContext, returnUrl: string): string {
  if (!rp.stable) {
    const reason = rp.reason ? UNSTABLE_REASON_TEXT[rp.reason] : "";
    return `<button class="btn" disabled aria-describedby="pk-reason">Sign in with passkey</button>
<button class="btn secondary" disabled aria-describedby="pk-reason">Sign in with phone</button>
<p id="pk-reason" class="muted" data-testid="passkey-unavailable">${reason}</p>`;
  }
  return `<button id="pk-login" class="btn" type="button">Sign in with passkey</button>
<button id="pk-phone" class="btn secondary" type="button">Sign in with phone</button>
<div id="pk-phone-box" hidden>
<p class="muted">Scan with your phone, or open <b>${rp.rpOrigin.replace(/[<>&"]/g, "")}/auth/phone</b> and enter the code.</p>
<img id="pk-qr" class="qr" alt="Sign-in QR code">
<p>Code: <b id="pk-code" data-testid="phone-code"></b></p>
<p id="pk-status" class="muted" role="status"></p>
</div>
<p id="pk-err" class="err" role="alert"></p>
<script type="application/json" id="pk-data">${scriptJson({ returnUrl })}</script>
<script src="/auth/passkey/webauthn.js"></script>
<script src="/auth/passkey/common.js"></script>
<script src="/auth/passkey/login.js"></script>`;
}

/** `/auth/invite#<token>` — enroll a passkey from an invite. */
export function renderInvitePage(): string {
  return shell(
    "Set up passkey",
    `<h1>🔐 Set up your passkey</h1>
<p class="muted" id="who">This creates a passkey for this dashboard on this device.</p>
<button id="go" class="btn" type="button" disabled>Create passkey</button>
<p id="msg" class="err" role="alert"></p>
<a id="open" class="btn secondary" href="/" hidden>Open dashboard</a>
<script src="/auth/passkey/webauthn.js"></script>
<script src="/auth/passkey/common.js"></script>
<script src="/auth/passkey/invite.js"></script>`,
  );
}

/** `/auth/phone#<token>` (or code entry) — approve/deny a desktop sign-in. */
export function renderPhonePage(): string {
  return shell(
    "Approve sign-in",
    `<h1>🔐 Sign-in request</h1>
<div id="code-form" hidden>
<p class="muted">Enter the code shown on the other screen.</p>
<input id="code" autocomplete="off" autocapitalize="characters" maxlength="9" aria-label="Sign-in code">
<button id="code-go" class="btn" type="button">Continue</button>
</div>
<div id="req" hidden>
<p>A device is asking to sign in to this dashboard:</p>
<dl><dt>Browser</dt><dd id="r-browser"></dd><dt>System</dt><dd id="r-os"></dd><dt>Address</dt><dd id="r-host"></dd><dt>IP</dt><dd id="r-ip"></dd><dt>Code</dt><dd id="r-code"></dd></dl>
<p class="muted">Approve only if you started this sign-in yourself and the code matches the other screen.</p>
<button id="approve" class="btn" type="button" disabled>Approve with passkey</button>
<button id="deny" class="btn secondary" type="button">Deny</button>
</div>
<p id="msg" class="err" role="alert"></p>
<script src="/auth/passkey/webauthn.js"></script>
<script src="/auth/passkey/common.js"></script>
<script src="/auth/passkey/phone.js"></script>`,
  );
}
