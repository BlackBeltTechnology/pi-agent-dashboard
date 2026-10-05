import type { Principal } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { describe, expect, it, vi } from "vitest";
import { ALLOW_ALL_GRANTS, DENY_ALL_GRANTS, decideBootstrapGrants } from "../bootstrap-grants.js";
import { LOCAL_OPERATOR } from "../session-access.js";

const anna: Principal = { iss: "https://idp", sub: "anna" };
const policy = (decide: (action: string) => boolean | Promise<boolean>) => ({
  hasPolicy: () => true,
  authorize: vi.fn(async ({ action }: { action: string }) => decide(action)),
});

describe("decideBootstrapGrants (18.37a)", () => {
  it("asks the policy once per non-session family with the *.read action, probe-free (a real decision)", async () => {
    const p = policy(() => true);
    const g = await decideBootstrapGrants(anna, p);
    expect(g).toMatchObject({ workspace: true, openspec: true, branch: true, terminal: true });
    expect(p.authorize.mock.calls.map((c) => (c[0] as { action: string }).action).sort()).toEqual(
      ["branch.read", "openspec.read", "terminal.read", "workspace.read"],
    );
  });

  it("grants exactly what the policy permits", async () => {
    const g = await decideBootstrapGrants(anna, policy((a) => a === "workspace.read" || a === "terminal.read"));
    expect(g).toMatchObject({ workspace: true, openspec: false, branch: false, terminal: true });
  });

  it("no principal ⇒ nothing; break-glass operator ⇒ everything, policy not consulted", async () => {
    const p = policy(() => true);
    expect(await decideBootstrapGrants(null, p)).toEqual(DENY_ALL_GRANTS);
    expect(await decideBootstrapGrants(LOCAL_OPERATOR, p)).toEqual(ALLOW_ALL_GRANTS);
    expect(p.authorize).not.toHaveBeenCalled();
  });

  it("a throwing / non-boolean policy denies (fail-closed)", async () => {
    const boom = { hasPolicy: () => true, authorize: vi.fn(async () => { throw new Error("x"); }) };
    expect(await decideBootstrapGrants(anna, boom)).toEqual(DENY_ALL_GRANTS);
    expect(await decideBootstrapGrants(anna, policy(() => "yes" as never))).toEqual(DENY_ALL_GRANTS);
  });

  it("no policy ⇒ allow all, policy not consulted", async () => {
    const none = { hasPolicy: () => false, authorize: vi.fn() };
    expect(await decideBootstrapGrants(anna, none)).toEqual(ALLOW_ALL_GRANTS);
    expect(none.authorize).not.toHaveBeenCalled();
  });
});

describe("decideBootstrapGrants — per-terminal decisions (review r2 B2)", () => {
  const owned = [
    { id: "ta", principalOwner: anna },
    { id: "tb", principalOwner: anna },
    { id: "tc", principalOwner: { iss: "https://idp", sub: "bela" } },
  ];
  const perId = (denyId: string) => ({
    hasPolicy: () => true,
    authorize: vi.fn(async ({ resource }: { resource: { kind: string; id?: string } }) => !(resource.kind === "terminal" && resource.id === denyId)),
  });

  it("generic allow + specific deny: the denied terminal is excluded, the others kept", async () => {
    const g = await decideBootstrapGrants(anna, perId("tb"), owned);
    expect(g.terminal).toBe(true);
    expect([...(g.terminals as ReadonlySet<string>)].sort()).toEqual(["ta"]);
  });

  it("only terminals the principal OWNS are put to the policy (no probing someone else's ids)", async () => {
    const p = perId("zz");
    await decideBootstrapGrants(anna, p, owned);
    const asked = p.authorize.mock.calls.map((c) => (c[0] as { resource: { id?: string } }).resource.id).filter(Boolean).sort();
    expect(asked).toEqual(["ta", "tb"]);
  });

  it("generic deny ⇒ no terminal at all; operator ⇒ all; no policy ⇒ all", async () => {
    const denyGeneric = { hasPolicy: () => true, authorize: vi.fn(async ({ resource }: { resource: { id?: string } }) => resource.id !== undefined) };
    const g = await decideBootstrapGrants(anna, denyGeneric as never, owned);
    expect(g.terminal).toBe(false);
    expect([...(g.terminals as ReadonlySet<string>)]).toEqual([]);
    expect((await decideBootstrapGrants(LOCAL_OPERATOR, perId("ta"), owned)).terminals).toBe("all");
    expect((await decideBootstrapGrants(anna, { hasPolicy: () => false, authorize: vi.fn() }, owned)).terminals).toBe("all");
  });

  it("a throwing per-terminal decision denies that terminal only", async () => {
    const p = { hasPolicy: () => true, authorize: vi.fn(async ({ resource }: { resource: { id?: string } }) => { if (resource.id === "ta") throw new Error("x"); return true; }) };
    const g = await decideBootstrapGrants(anna, p as never, owned);
    expect([...(g.terminals as ReadonlySet<string>)]).toEqual(["tb"]);
  });
});
