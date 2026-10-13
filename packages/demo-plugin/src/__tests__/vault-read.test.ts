/**
 * The demo plugin's vault read: presence + length only, never the value, and
 * nothing when the host does not wire `ctx.vault`.
 * See change: add-credential-vault (task 6.2).
 */
import { describe, expect, it } from "vitest";
import registerPlugin, { DEMO_VAULT_BINDING } from "../server/index.js";

type Handler = () => Promise<unknown>;
async function routes(vault?: { read(name: string): Promise<string | undefined> }) {
  const got = new Map<string, Handler>();
  const ctx = {
    fastify: { get: (p: string, h: Handler) => got.set(`GET ${p}`, h), post: () => {}, delete: () => {} },
    ...(vault ? { vault } : {}),
  };
  await registerPlugin(ctx as never);
  return got;
}

describe("demo vault-read", () => {
  it("manifest declares the binding it reads", async () => {
    const pkg = (await import("../../package.json", { with: { type: "json" } })).default as { "pi-dashboard-plugin": { vaultBindings: string[] } };
    expect(pkg["pi-dashboard-plugin"].vaultBindings).toEqual([DEMO_VAULT_BINDING]);
  });
  it("reports presence and length, never the value", async () => {
    const r = await routes({ read: async (n) => (n === DEMO_VAULT_BINDING ? "poly-key-0001" : undefined) });
    const res = await r.get("GET /api/plugins/demo/vault-read")!();
    expect(res).toEqual({ binding: DEMO_VAULT_BINDING, present: true, length: 13 });
    expect(JSON.stringify(res)).not.toContain("poly-key-0001");
  });
  it("reports absent when the vault returns nothing or is not wired", async () => {
    expect(await (await routes({ read: async () => undefined })).get("GET /api/plugins/demo/vault-read")!()).toMatchObject({ present: false, length: null });
    expect(await (await routes()).get("GET /api/plugins/demo/vault-read")!()).toMatchObject({ present: false });
  });
});
