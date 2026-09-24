/**
 * Lightweight in-process fake OIDC issuer for identity-plane tests
 * (openspec: add-multi-user-identity-plane §11.2).
 *
 * The mainstream best practice for testing an app that VALIDATES OIDC bearer
 * tokens is NOT to boot a real Keycloak, but to stand up a tiny issuer that
 * signs real RS256 JWTs with a real key pair and serves a real
 * `/.well-known/openid-configuration` + `/jwks`. The app's verification path
 * (discovery → JWKS fetch → `jose` RS256 verify → iss/aud/azp/sub) stays fully
 * exercised; only the heavyweight Keycloak dependency disappears. See
 * `oauth2-mock-server`, `navikt/mock-oauth2-server`.
 *
 * This is deliberately the smallest thing that satisfies the keycloak-resolver:
 * discovery + JWKS + a `mint()` for test-signed tokens. No auth-code/PKCE flow,
 * no user store — the isolation specs need bearer tokens with distinct `sub`,
 * not an interactive login. Dev/test ONLY; never shipped.
 *
 * `mint()` is an in-process method for same-process tests. For the Docker E2E
 * (server in-container, specs on the host) the host cannot call an in-process
 * method, so the server ALSO exposes `POST /mint` ({sub, aud?, azp?,
 * expSeconds?, extra?} → {access_token}) — the host mints over HTTP the same
 * key-signed token the in-container resolver will verify.
 */

import { createHash, randomBytes } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => resolve(raw));
  });
}

export interface MintInput {
  /** The `sub` claim — the identity-plane ownership key. */
  sub: string;
  /** Override `aud` (default: the issuer's configured audience). */
  aud?: string;
  /** Override `azp` (default: the issuer's configured authorized party). */
  azp?: string;
  /** Seconds until `exp` (default 300). */
  expSeconds?: number;
  /** Extra claims merged into the payload (e.g. `email`, `email_verified`). */
  extra?: Record<string, unknown>;
}

export interface FakeOidcIssuer {
  /** Exact issuer URL — no trailing slash. Configure the resolver with THIS. */
  readonly issuer: string;
  /** Default audience minted tokens carry. */
  readonly audience: string;
  /** Mint a signed RS256 access token. */
  mint(input: MintInput): Promise<string>;
  /** The public JWKS as served at `${issuer}/jwks`. */
  jwks(): { keys: JWK[] };
  /** Stop the HTTP server. */
  close(): Promise<void>;
}

export interface FakeOidcOptions {
  /** Default `aud` (default `pi-dashboard`). */
  audience?: string;
  /** Default `azp` (default `dashboard-web`). */
  azp?: string;
  /** JWK `kid` (default `fake-kid-1`) — echoed in JWT headers + JWKS. */
  kid?: string;
  /** Bind host (default `127.0.0.1`). */
  host?: string;
  /** Bind port (default `0` = ephemeral). */
  port?: number;
  /**
   * Advertised issuer identifier, decoupled from the bind address. Needed in
   * the Docker harness: the server binds `0.0.0.0` (so the host can reach
   * `/mint` via a mapped port) but the in-container resolver + the token `iss`
   * must agree on a stable identifier like `http://127.0.0.1:<port>`. Trailing
   * slash is stripped to match the resolver's exact-issuer check.
   */
  issuerUrl?: string;
  /**
   * Enable the INTERACTIVE authorization-code + PKCE flow (browser E2E):
   * `GET/POST /auth` login form (Keycloak-compatible `#username`/`#password`/
   * `#kc-login`), `POST /token` code exchange, `GET /logout` end-session, and an
   * SSO cookie so a second authorize skips the form until logout. Omitted ⇒ the
   * issuer stays mint-only (unchanged behavior).
   */
  users?: FakeOidcUser[];
  /**
   * Allowed `redirect_uri` / `post_logout_redirect_uri` prefixes (exact-prefix
   * match, like an IdP client's registered URIs). Empty ⇒ everything refused.
   */
  redirectUriPrefixes?: string[];
}

export interface FakeOidcUser {
  username: string;
  password: string;
  /** The `sub` claim minted for this user. */
  sub: string;
  email?: string;
}

const SSO_COOKIE = "fake_oidc_sso";
const CODE_TTL_MS = 60_000;

function escapeHtml(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function loginPage(query: string, error?: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Fake IdP sign-in</title></head><body>
<h1>Fake IdP</h1>${error ? `<p id="input-error">${escapeHtml(error)}</p>` : ""}
<form method="post" action="auth">
<input type="hidden" name="query" value="${escapeHtml(query)}">
<label>Username <input id="username" name="username" autocomplete="username"></label>
<label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label>
<button id="kc-login" type="submit">Sign In</button>
</form></body></html>`;
}

/** Start the fake issuer. Await the result, then read `.issuer`. */
export async function startFakeOidcIssuer(opts: FakeOidcOptions = {}): Promise<FakeOidcIssuer> {
  const audience = opts.audience ?? "pi-dashboard";
  const azpDefault = opts.azp ?? "dashboard-web";
  const kid = opts.kid ?? "fake-kid-1";
  const host = opts.host ?? "127.0.0.1";

  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };

  // Assigned after listen(); referenced by request handler + signToken() via closure.
  let issuer = "";

  async function signToken(input: MintInput): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ azp: input.azp ?? azpDefault, ...(input.extra ?? {}) })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setSubject(input.sub)
      .setAudience(input.aud ?? audience)
      .setIssuedAt(now)
      .setExpirationTime(now + (input.expSeconds ?? 300))
      .sign(privateKey);
  }

  async function handleMint(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const raw = await readBody(req);
      const input = raw ? (JSON.parse(raw) as MintInput) : ({} as MintInput);
      if (typeof input.sub !== "string" || input.sub.length === 0) {
        return sendJson(res, 400, { error: "missing sub" });
      }
      sendJson(res, 200, { access_token: await signToken(input) });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "mint failed" });
    }
  }

  // ── interactive auth-code flow (only when `users` is configured) ──────────
  const users = opts.users ?? [];
  const prefixes = opts.redirectUriPrefixes ?? [];
  const allowed = (uri: string | null): uri is string => !!uri && prefixes.some((p) => uri.startsWith(p));
  const codes = new Map<string, { user: FakeOidcUser; clientId: string; redirectUri: string; challenge: string; expiresAt: number }>();
  const sessions = new Map<string, FakeOidcUser>();

  function sendHtml(res: ServerResponse, status: number, html: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
    res.end(html);
  }
  function redirect(res: ServerResponse, location: string, headers: Record<string, string> = {}): void {
    // Every redirect target is a registered client URI (checked at parse time);
    // re-checked at the sink so no path can ever redirect off the allowlist.
    if (!allowed(location)) return sendJson(res, 400, { error: "redirect target not registered" });
    res.writeHead(302, { location, ...headers });
    res.end();
  }
  function ssoUser(req: IncomingMessage): FakeOidcUser | undefined {
    const m = /(?:^|;\s*)fake_oidc_sso=([^;]+)/.exec(req.headers.cookie ?? "");
    return m ? sessions.get(m[1]) : undefined;
  }
  /** Validate an authorize request; returns an error string or the parsed params. */
  function parseAuthorize(q: URLSearchParams): string | { clientId: string; redirectUri: string; state: string; challenge: string } {
    const redirectUri = q.get("redirect_uri");
    if (q.get("response_type") !== "code") return "unsupported response_type";
    if (q.get("client_id") !== azpDefault) return "unknown client_id";
    if (!allowed(redirectUri)) return "redirect_uri not registered";
    if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return "PKCE S256 required";
    return { clientId: azpDefault, redirectUri, state: q.get("state") ?? "", challenge: q.get("code_challenge") ?? "" };
  }
  function issueCode(res: ServerResponse, user: FakeOidcUser, a: { clientId: string; redirectUri: string; state: string; challenge: string }, headers: Record<string, string> = {}): void {
    const code = randomBytes(24).toString("base64url");
    codes.set(code, { user, clientId: a.clientId, redirectUri: a.redirectUri, challenge: a.challenge, expiresAt: Date.now() + CODE_TTL_MS });
    const loc = new URL(a.redirectUri);
    loc.searchParams.set("code", code);
    if (a.state) loc.searchParams.set("state", a.state);
    loc.searchParams.set("iss", issuer);
    redirect(res, loc.toString(), headers);
  }
  async function handleAuthorizePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const query = form.get("query") ?? "";
    const a = parseAuthorize(new URLSearchParams(query));
    if (typeof a === "string") return sendJson(res, 400, { error: a });
    const user = users.find((u) => u.username === form.get("username") && u.password === form.get("password"));
    if (!user) return sendHtml(res, 401, loginPage(query, "Invalid username or password."));
    const sid = randomBytes(16).toString("base64url");
    sessions.set(sid, user);
    issueCode(res, user, a, { "set-cookie": `${SSO_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  }
  async function handleToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const form = new URLSearchParams(await readBody(req));
    const code = form.get("code") ?? "";
    const entry = codes.get(code);
    codes.delete(code); // single-use, even when the exchange fails
    if (form.get("grant_type") !== "authorization_code" || !entry || entry.expiresAt < Date.now()) {
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    const verifier = form.get("code_verifier") ?? "";
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    if (entry.clientId !== form.get("client_id") || entry.redirectUri !== form.get("redirect_uri") || challenge !== entry.challenge) {
      return sendJson(res, 400, { error: "invalid_grant" });
    }
    const extra = { preferred_username: entry.user.username, ...(entry.user.email ? { email: entry.user.email, email_verified: true } : {}) };
    const accessToken = await signToken({ sub: entry.user.sub, extra });
    sendJson(res, 200, { access_token: accessToken, id_token: accessToken, token_type: "Bearer", expires_in: 300 });
  }
  function handleLogout(req: IncomingMessage, res: ServerResponse, q: URLSearchParams): void {
    const target = q.get("post_logout_redirect_uri");
    if (target && !allowed(target)) return sendJson(res, 400, { error: "post_logout_redirect_uri not registered" });
    const m = /(?:^|;\s*)fake_oidc_sso=([^;]+)/.exec(req.headers.cookie ?? "");
    if (m) sessions.delete(m[1]);
    const clear = { "set-cookie": `${SSO_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` };
    if (target) return redirect(res, target, clear);
    sendHtml(res, 200, "<!doctype html><p>Signed out.</p>", clear);
  }
  function handleAuthorizeGet(req: IncomingMessage, res: ServerResponse, q: URLSearchParams): void {
    const a = parseAuthorize(q);
    if (typeof a === "string") return sendJson(res, 400, { error: a });
    const user = ssoUser(req);
    if (user) return issueCode(res, user, a);
    // OIDC Core §3.1.2.6: prompt=none must never show UI — no session ⇒ error back to the client.
    if (q.get("prompt") === "none") {
      const loc = new URL(a.redirectUri);
      loc.searchParams.set("error", "login_required");
      if (a.state) loc.searchParams.set("state", a.state);
      return redirect(res, loc.toString());
    }
    sendHtml(res, 200, loginPage(q.toString()));
  }
  const interactiveRoutes = new Map<string, (req: IncomingMessage, res: ServerResponse, q: URLSearchParams) => void>([
    ["GET /auth", handleAuthorizeGet],
    ["POST /auth", (req, res) => void handleAuthorizePost(req, res)],
    ["POST /token", (req, res) => void handleToken(req, res)],
    ["GET /logout", handleLogout],
  ]);
  function handleInteractive(req: IncomingMessage, res: ServerResponse, path: string, q: URLSearchParams): boolean {
    const route = users.length > 0 ? interactiveRoutes.get(`${req.method} ${path}`) : undefined;
    if (!route) return false;
    route(req, res, q);
    return true;
  }

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? "/").split("?")[0];
    const query = new URL(req.url ?? "/", "http://x").searchParams;
    if (handleInteractive(req, res, path, query)) return;
    if (req.method === "GET" && path === "/.well-known/openid-configuration") {
      // `issuer` MUST equal the configured issuer exactly (the resolver checks it).
      sendJson(res, 200, {
        issuer,
        jwks_uri: `${issuer}/jwks`,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
      });
    } else if (req.method === "GET" && path === "/jwks") {
      sendJson(res, 200, { keys: [publicJwk] });
    } else if (req.method === "POST" && path === "/mint") {
      void handleMint(req, res);
    } else {
      sendJson(res, 404, { error: "not_found" });
    }
  }

  const server: Server = createServer(handleRequest);

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, host, resolve));
  const { port } = server.address() as AddressInfo;
  issuer = (opts.issuerUrl ?? `http://${host}:${port}`).replace(/\/$/, "");

  return {
    issuer,
    audience,
    mint: signToken,
    jwks: () => ({ keys: [publicJwk] }),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}
