/**
 * Fake Google (authorize / token / revoke / minimal Gmail REST) for the
 * gmail-plugin L3 specs. See change: add-gmail-plugin (design D8, task 4b.2).
 *
 * Runs INSIDE the harness container, bound to 127.0.0.1 — the only place the
 * dashboard's loopback-only `PI_E2E_GOOGLE_BASE_URL` gate (set by
 * docker/test-up.sh) accepts. The workspace is path-identical in the container
 * and the image is Node 24, so this file runs directly via type stripping:
 * keep it ERASABLE TS (no enums / parameter properties / non-type imports of
 * .ts files). The spec side (`startFakeGoogle`, `fakeGoogle*`) drives it with
 * `docker exec`.
 *
 * Control API (POST JSON unless noted):
 *   GET  /_control/health           → {ok:true}
 *   GET  /_control/state            → {sends, drafts, calls, revokes}
 *   POST /_control/config {nextEmail?, invalidGrant?, revokeDown?, expiresIn?}
 *   POST /_control/reset
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

export const FAKE_GOOGLE_PORT = 18090;
export const FAKE_GOOGLE_BASE = `http://127.0.0.1:${FAKE_GOOGLE_PORT}`;

// ── server (in-container) ───────────────────────────────────────────────────

interface Config {
  nextEmail: string;
  invalidGrant: boolean;
  revokeDown: boolean;
  expiresIn: number;
}

interface CodeGrant {
  email: string;
  nonce: string;
  scope: string;
  clientId: string;
}

function defaultConfig(): Config {
  return { nextEmail: "a@fake.test", invalidGrant: false, revokeDown: false, expiresIn: 3600 };
}

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const subOf = (email: string) => `sub-${createHash("sha256").update(email).digest("hex").slice(0, 16)}`;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
    });
    req.on("end", () => resolve(s));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

export function runFakeGoogle(port: number): void {
  const base = `http://127.0.0.1:${port}`;
  let config = defaultConfig();
  let codes = new Map<string, CodeGrant>();
  let refreshTokens = new Map<string, string>(); // refresh → email
  let state = { sends: [] as unknown[], drafts: [] as unknown[], calls: [] as string[], revokes: 0 };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const p = url.pathname;
    const body = req.method === "POST" ? await readBody(req) : "";
    if (!p.startsWith("/_control")) state.calls.push(`${req.method} ${p}`);

    if (p === "/_control/health") return json(res, 200, { ok: true });
    if (p === "/_control/state") return json(res, 200, state);
    if (p === "/_control/config") {
      config = { ...config, ...(JSON.parse(body || "{}") as Partial<Config>) };
      return json(res, 200, config);
    }
    if (p === "/_control/reset") {
      config = defaultConfig();
      codes = new Map();
      refreshTokens = new Map();
      state = { sends: [], drafts: [], calls: [], revokes: 0 };
      return json(res, 200, { ok: true });
    }

    if (p === "/o/oauth2/v2/auth") {
      const redirect = url.searchParams.get("redirect_uri") ?? "";
      const code = randomBytes(12).toString("hex");
      codes.set(code, {
        email: config.nextEmail,
        nonce: url.searchParams.get("nonce") ?? "",
        scope: (url.searchParams.get("scope") ?? "").split(" ").filter((s) => s.startsWith("https://")).join(" "),
        clientId: url.searchParams.get("client_id") ?? "",
      });
      const to = new URL(redirect);
      to.searchParams.set("code", code);
      to.searchParams.set("state", url.searchParams.get("state") ?? "");
      res.writeHead(302, { location: to.toString() });
      return res.end();
    }

    if (p === "/token") {
      const form = new URLSearchParams(body);
      const now = Math.floor(Date.now() / 1000);
      if (form.get("grant_type") === "authorization_code") {
        const grant = codes.get(form.get("code") ?? "");
        if (!grant) return json(res, 400, { error: "invalid_grant" });
        codes.delete(form.get("code") ?? "");
        const refresh = `refresh-${randomBytes(8).toString("hex")}`;
        refreshTokens.set(refresh, grant.email);
        return json(res, 200, {
          access_token: `access-${randomBytes(8).toString("hex")}`,
          refresh_token: refresh,
          expires_in: config.expiresIn,
          token_type: "Bearer",
          scope: `openid https://www.googleapis.com/auth/userinfo.email ${grant.scope}`,
          id_token: `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u({
            iss: base,
            aud: grant.clientId,
            sub: subOf(grant.email),
            email: grant.email,
            email_verified: true,
            nonce: grant.nonce,
            iat: now,
            exp: now + 3600,
          })}.c2ln`,
        });
      }
      if (form.get("grant_type") === "refresh_token") {
        if (config.invalidGrant || !refreshTokens.has(form.get("refresh_token") ?? "")) {
          return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        }
        return json(res, 200, {
          access_token: `access-${randomBytes(8).toString("hex")}`,
          expires_in: config.expiresIn,
          token_type: "Bearer",
        });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }

    if (p === "/revoke") {
      if (config.revokeDown) return json(res, 503, { error: "unavailable" });
      state.revokes++;
      refreshTokens.delete(new URLSearchParams(body).get("token") ?? "");
      return json(res, 200, {});
    }

    const gmail = "/gmail/v1/users/me/";
    if (p.startsWith(gmail)) {
      const rest = p.slice(gmail.length);
      if (rest === "messages/send") {
        const msg = JSON.parse(body || "{}") as { raw?: string; threadId?: string };
        const raw = Buffer.from(msg.raw ?? "", "base64url").toString("utf8");
        const to = /^To: (.*)$/m.exec(raw)?.[1]?.trim() ?? "";
        state.sends.push({ to: to.split(",").map((s) => s.trim()), threadId: msg.threadId ?? null });
        return json(res, 200, { id: `sent-${state.sends.length}`, threadId: msg.threadId ?? "t-new" });
      }
      if (rest === "drafts") {
        state.drafts.push(JSON.parse(body || "{}"));
        return json(res, 200, { id: `draft-${state.drafts.length}` });
      }
      if (rest === "messages") return json(res, 200, { messages: [{ id: "m1", threadId: "t1" }] });
      if (rest === "messages/m1") {
        return json(res, 200, {
          id: "m1",
          threadId: "t1",
          snippet: "fake message",
          payload: { headers: [{ name: "From", value: "bob@fake.test" }, { name: "Subject", value: "Fake" }] },
        });
      }
      if (rest === "labels") return json(res, 200, { labels: [{ id: "INBOX", name: "INBOX" }] });
      return json(res, 404, { error: { code: 404 } });
    }
    json(res, 404, { error: "not_found" });
  });
  server.listen(port, "127.0.0.1");
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
  } catch {
    return false;
  }
})();
if (isMain) {
  const i = process.argv.indexOf("--port");
  runFakeGoogle(i > 0 ? Number(process.argv[i + 1]) : FAKE_GOOGLE_PORT);
}

// ── spec side (host) ────────────────────────────────────────────────────────

const HERE = new URL(import.meta.url).pathname;

function dockerExec(containerId: string, args: string[], detach = false): string {
  return execFileSync("docker", ["exec", ...(detach ? ["-d"] : []), containerId, ...args], {
    encoding: "utf8",
    timeout: 30_000,
  });
}

/** Run a fetch INSIDE the container (the fake is loopback-only there). */
function inContainerFetch(containerId: string, url: string, init?: { method?: string; body?: unknown; manual?: boolean }): string {
  const script = `
    const i = ${JSON.stringify(init ?? {})};
    fetch(${JSON.stringify(url)}, {
      method: i.method ?? "GET",
      redirect: i.manual ? "manual" : "follow",
      headers: i.body ? { "content-type": "application/json" } : {},
      body: i.body ? JSON.stringify(i.body) : undefined,
    }).then(async (r) => process.stdout.write(i.manual ? (r.headers.get("location") ?? "") : await r.text()))
      .catch((e) => { process.stderr.write(String(e)); process.exit(1); });`;
  return dockerExec(containerId, ["node", "-e", script]);
}

/** Start the fake inside the container (idempotent) and wait for health. */
export async function startFakeGoogle(containerId: string): Promise<void> {
  const healthy = () => {
    try {
      return JSON.parse(inContainerFetch(containerId, `${FAKE_GOOGLE_BASE}/_control/health`)).ok === true;
    } catch {
      return false;
    }
  };
  if (!healthy()) dockerExec(containerId, ["node", HERE, "--port", String(FAKE_GOOGLE_PORT)], true);
  for (let i = 0; i < 50; i++) {
    if (healthy()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("fake-google did not become healthy inside the container");
}

export function fakeGoogleControl(containerId: string, path: "reset" | "config", body?: Record<string, unknown>): void {
  inContainerFetch(containerId, `${FAKE_GOOGLE_BASE}/_control/${path}`, { method: "POST", body: body ?? {} });
}

export interface FakeGoogleState {
  sends: Array<{ to: string[]; threadId: string | null }>;
  drafts: unknown[];
  calls: string[];
  revokes: number;
}

export function fakeGoogleState(containerId: string): FakeGoogleState {
  return JSON.parse(inContainerFetch(containerId, `${FAKE_GOOGLE_BASE}/_control/state`)) as FakeGoogleState;
}

/** Follow the auth URL inside the container; returns the redirect URL to paste. */
export function fakeGoogleConsent(containerId: string, authUrl: string): string {
  return inContainerFetch(containerId, authUrl, { manual: true });
}
