/**
 * `ctx.identity` — the plugin CONSUMER seam (D24, task 18.27): a plugin reads the
 * caller's principal on its HTTP routes and WS upgrades, asks the ONE host policy
 * (actions namespaced `plugin:<id>:`), and stores per-user data under a stable
 * hash of `(iss, sub)`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { createPluginIdentity, type PluginIdentityDeps } from "../plugin-identity.js";
import { LOCAL_OPERATOR } from "../session-access.js";

const anna: Principal = Object.freeze({ iss: "https://idp", sub: "anna" });
const bela: Principal = Object.freeze({ iss: "https://idp", sub: "bela" });

function deps(over: Partial<PluginIdentityDeps> = {}): PluginIdentityDeps & { root: string; authorize: ReturnType<typeof vi.fn> } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plugin-identity-"));
  const authorize = vi.fn(async () => true);
  return {
    root,
    isEnforced: () => true,
    principalOfRequest: (r: unknown) => (r as { p?: Principal } | null)?.p ?? null,
    resolveUpgrade: async () => null,
    policy: { authorize },
    pluginDataRoot: (id: string) => path.join(root, id),
    authorize,
    ...over,
  } as never;
}

describe("isEnforced / principalOf", () => {
  it("reflects the host latch", () => {
    expect(createPluginIdentity("p", deps({ isEnforced: () => false })).isEnforced()).toBe(false);
    expect(createPluginIdentity("p", deps()).isEnforced()).toBe(true);
  });

  it("returns the host-resolved principal of a request, else null", () => {
    const id = createPluginIdentity("p", deps());
    expect(id.principalOf({ p: anna })).toBe(anna);
    expect(id.principalOf({})).toBeNull();
    expect(id.principalOf(null)).toBeNull();
  });
});

describe("principalOfUpgrade (WS routes)", () => {
  it("resolves the upgrade's credential through the host; refusal/no credential ⇒ null; resolver throw ⇒ null", async () => {
    const resolveUpgrade = vi.fn(async (r: { headers: { authorization?: string } }) => (r.headers.authorization === "Bearer ok" ? anna : null));
    const id = createPluginIdentity("p", deps({ resolveUpgrade: resolveUpgrade as never }));
    expect(await id.principalOfUpgrade({ headers: { authorization: "Bearer ok" } } as never)).toBe(anna);
    expect(await id.principalOfUpgrade({ headers: {} } as never)).toBeNull();
    const boom = createPluginIdentity("p", deps({ resolveUpgrade: async () => { throw new Error("x"); } }));
    expect(await boom.principalOfUpgrade({ headers: {} } as never)).toBeNull();
  });

  it("is null while identity is not enforced (inert plane makes no claim)", async () => {
    const resolveUpgrade = vi.fn(async () => anna);
    const id = createPluginIdentity("p", deps({ isEnforced: () => false, resolveUpgrade }));
    expect(await id.principalOfUpgrade({ headers: {} } as never)).toBeNull();
    expect(resolveUpgrade).not.toHaveBeenCalled();
  });
});

describe("authorize — namespaced, policy-decided", () => {
  it("namespaces the action as plugin:<id>:<action> and asks the ONE policy", async () => {
    const d = deps();
    const id = createPluginIdentity("notes", d);
    expect(await id.authorize(anna, "export", { kind: "note", id: "1" })).toBe(true);
    expect(d.authorize).toHaveBeenCalledWith({ principal: anna, action: "plugin:notes:export", resource: { kind: "note", id: "1" } });
  });

  it("a policy denial is a denial", async () => {
    const id = createPluginIdentity("notes", deps({ policy: { authorize: async () => false } }));
    expect(await id.authorize(anna, "export", { kind: "note" })).toBe(false);
  });

  it("a plugin cannot escape its namespace (separator / empty / oversized / non-string actions are refused, policy not consulted)", async () => {
    const d = deps();
    const id = createPluginIdentity("notes", d);
    for (const bad of ["", "a:b", "plugin:other:x", "../x", "a b", "x".repeat(65), 42 as never]) {
      expect(await id.authorize(anna, bad, { kind: "k" })).toBe(false);
    }
    expect(d.authorize).not.toHaveBeenCalled();
  });

  it("enforced + no principal ⇒ false; inert ⇒ true (no claim, ungated); break-glass operator passes", async () => {
    const d = deps();
    const id = createPluginIdentity("notes", d);
    expect(await id.authorize(null as never, "export", { kind: "k" })).toBe(false);
    expect(await createPluginIdentity("notes", deps({ isEnforced: () => false })).authorize(null as never, "export", { kind: "k" })).toBe(true);
    expect(await id.authorize(LOCAL_OPERATOR, "export", { kind: "k" })).toBe(true);
    expect(d.authorize).not.toHaveBeenCalledWith(expect.objectContaining({ principal: null }));
  });
});

describe("userDataDir — per-user, stable, isolated", () => {
  it("is <pluginDataRoot>/users/<sha256(iss,sub)> and creates it 0700", () => {
    const d = deps();
    const dir = createPluginIdentity("notes", d).userDataDir(anna);
    expect(path.dirname(dir)).toBe(path.join(d.root, "notes", "users"));
    expect(path.basename(dir)).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.statSync(dir).isDirectory()).toBe(true);
    if (process.platform !== "win32") expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it("is stable per (iss, sub) and distinct across users and across issuers", () => {
    const id = createPluginIdentity("notes", deps());
    expect(id.userDataDir(anna)).toBe(id.userDataDir({ ...anna }));
    expect(id.userDataDir(anna)).not.toBe(id.userDataDir(bela));
    expect(id.userDataDir(anna)).not.toBe(id.userDataDir({ iss: "https://other", sub: "anna" }));
  });

  it("(iss, sub) pairs that concatenate alike do not collide", () => {
    const id = createPluginIdentity("notes", deps());
    expect(id.userDataDir({ iss: "a", sub: "bc" })).not.toBe(id.userDataDir({ iss: "ab", sub: "c" }));
  });

  it("never derives a path from the raw sub (traversal-safe) and refuses a missing principal", () => {
    const id = createPluginIdentity("notes", deps());
    expect(path.basename(id.userDataDir({ iss: "i", sub: "../../etc" }))).toMatch(/^[0-9a-f]{64}$/);
    expect(() => id.userDataDir(null as never)).toThrow();
  });

  it("two plugins never share a directory for the same user", () => {
    const d = deps();
    expect(createPluginIdentity("a", d).userDataDir(anna)).not.toBe(createPluginIdentity("b", d).userDataDir(anna));
  });
});
