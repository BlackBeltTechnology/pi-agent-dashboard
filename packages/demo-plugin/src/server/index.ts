/**
 * Demo plugin server entry (fixture — loads only under
 * PI_DASHBOARD_FIXTURE_PLUGINS=1). Exercises the plugin seams end-to-end:
 * - `demo/echo` on the private bridge request lane (`registerPiRequestHandler`);
 * - a fake OAuth login started via `ctx.oauth.startFlow` (auth URL +
 *   `manual_code` prompt; the answer `ok` completes it);
 * - the credential persisted via `ctx.credentials` under key `demo-account`.
 * See change: expose-plugin-credential-and-oauth-seams (D8).
 */
import type {
  PluginOAuthLoginFlow,
  ServerPluginContext,
} from "@blackbelt-technology/dashboard-plugin-runtime/server";

export const DEMO_ACCOUNT_KEY = "demo-account";
export const DEMO_ECHO_TYPE = "demo/echo";

/** Fake login: auth URL + paste prompt; the answer `ok` yields a dummy credential. */
export const demoLoginFlow: PluginOAuthLoginFlow = {
  name: "Demo",
  async login(ix) {
    ix.notify({ type: "auth_url", url: "https://example.invalid/demo/authorize" });
    const answer = await ix.prompt({ type: "manual_code", message: "Paste the demo code (type ok)" });
    if (answer.trim() !== "ok") throw new Error("Invalid demo code");
    return {
      type: "oauth",
      access: "demo-access",
      refresh: "demo-refresh",
      expires: Date.now() + 3_600_000,
      email: "demo@example.invalid",
    };
  },
};

export default async function registerPlugin(ctx: ServerPluginContext): Promise<void> {
  ctx.registerPiRequestHandler?.(DEMO_ECHO_TYPE, (payload) => {
    const text = (payload as { text?: unknown } | null)?.text;
    return `echo: ${typeof text === "string" ? text : ""}`;
  });

  ctx.fastify.get("/api/plugins/demo/account", async () => ({
    signedIn: (await ctx.credentials?.list())?.includes(DEMO_ACCOUNT_KEY) ?? false,
  }));

  ctx.fastify.post("/api/plugins/demo/sign-in", async (_request, reply) => {
    if (!ctx.oauth || !ctx.credentials) {
      return reply.code(501).send({ error: "Host does not provide plugin OAuth" });
    }
    const credentials = ctx.credentials;
    try {
      return await ctx.oauth.startFlow({
        key: "default",
        loginFlow: demoLoginFlow,
        persist: (credential) => credentials.set(DEMO_ACCOUNT_KEY, { ...credential }),
      });
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  ctx.fastify.delete("/api/plugins/demo/account", async () => {
    await ctx.credentials?.remove(DEMO_ACCOUNT_KEY);
    return { ok: true };
  });
}
