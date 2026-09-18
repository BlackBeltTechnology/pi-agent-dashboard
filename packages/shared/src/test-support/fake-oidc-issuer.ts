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

  function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const path = (req.url ?? "/").split("?")[0];
    if (req.method === "GET" && path === "/.well-known/openid-configuration") {
      // `issuer` MUST equal the configured issuer exactly (the resolver checks it).
      sendJson(res, 200, {
        issuer,
        jwks_uri: `${issuer}/jwks`,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
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
