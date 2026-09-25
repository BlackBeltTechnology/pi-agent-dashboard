/**
 * identity-smoke-plugin · SERVER entry (TEMPORARY smoke artifact, D19).
 *
 * A DROP-IN, SERVER-ONLY plugin that proves the "separate view" login provider
 * end to end. It claims NO client slot and ships nothing into the dashboard's
 * client bundle — instead it registers its OWN pages on the shared Fastify
 * instance and tells core to redirect there:
 *
 *   GET /identity-smoke/login   → its own sign-in page
 *   GET /identity-smoke/logout  → its own sign-out page
 *   ctx.registerBrowserLoginConfig({ loginUrl, logoutUrl })
 *
 * Core's gate then redirects: `/logout` (and the auth-required "Sign in"
 * affordance) sends the browser to these pages instead of mounting a bundled
 * component. Both paths sit OUTSIDE the network guard's jurisdiction
 * (`/api/`, `/v1/`, `/editor/`, `/live/`), so they are reachable pre-auth —
 * exactly like the legacy server-rendered `/auth/login`.
 *
 * Wiring requirements (the smoke setup must supply BOTH):
 *   1. this directory under `<state-dir>/plugins/` (e.g. ~/.pi/dashboard/plugins/)
 *   2. its id in `identity.trustedResolverPlugins`, or the host ignores the
 *      descriptor (trust is a host-owned grant — see ResolverRegistry.isTrusted)
 *
 * STUBBED HANDOFF: these pages do not mint or hand a token to the SPA. They
 * prove discovery → descriptor → dispatch → plugin-owned view, nothing more.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ID = "identity-smoke";

/** Same-origin paths core redirects to. Kept in one place so they cannot drift. */
const LOGIN_PATH = "/identity-smoke/login";
const LOGOUT_PATH = "/identity-smoke/logout";

async function sendView(reply, file) {
  const html = await readFile(join(HERE, "views", file), "utf-8");
  return reply.type("text/html; charset=utf-8").send(html);
}

export default async function registerPlugin(ctx) {
  // The plugin id the host will stamp on the descriptor — logged so the smoke
  // can prove which plugin served a page.
  ctx.fastify.get("/identity-smoke/whoami", async () => ({ pluginId: PLUGIN_ID, loginPath: LOGIN_PATH, logoutPath: LOGOUT_PATH }));

  ctx.fastify.get(LOGIN_PATH, async (_req, reply) => sendView(reply, "login.html"));
  ctx.fastify.get(LOGOUT_PATH, async (_req, reply) => sendView(reply, "logout.html"));

  if (typeof ctx.registerBrowserLoginConfig !== "function") {
    ctx.logger.warn("[identity-smoke] host exposes no registerBrowserLoginConfig; pages served but core will not route here");
    return;
  }

  ctx.registerBrowserLoginConfig({ loginUrl: LOGIN_PATH, logoutUrl: LOGOUT_PATH });
  ctx.logger.info(`[identity-smoke] browser login offered as a separate view (${LOGIN_PATH})`);

  // OPTIONAL banner demo: PI_SMOKE_REQUIRE_AUTH=1 registers an ACTIVE resolver
  // that resolves nothing, so every un-authenticated request is denied and the
  // client shows its `auth_required` banner. That is the one path that reaches
  // the login view THROUGH core (banner → Sign in link → loginUrl) rather than
  // by typing the URL. While this is on the dashboard is deliberately unusable
  // (nothing can authenticate) — it exists only to exercise the dispatch.
  if (process.env.PI_SMOKE_REQUIRE_AUTH === "1" && typeof ctx.registerPrincipalResolver === "function") {
    ctx.registerPrincipalResolver(async () => null, { active: true });
    ctx.logger.info("[identity-smoke] PI_SMOKE_REQUIRE_AUTH=1 — active deny-all resolver (banner smoke)");
  }
}
