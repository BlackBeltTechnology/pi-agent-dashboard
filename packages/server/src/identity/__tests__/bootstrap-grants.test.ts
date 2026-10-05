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
    expect(g).toEqual(ALLOW_ALL_GRANTS);
    expect(p.authorize.mock.calls.map((c) => (c[0] as { action: string }).action).sort()).toEqual(
      ["branch.read", "openspec.read", "terminal.read", "workspace.read"],
    );
  });

  it("grants exactly what the policy permits", async () => {
    const g = await decideBootstrapGrants(anna, policy((a) => a === "workspace.read" || a === "terminal.read"));
    expect(g).toEqual({ workspace: true, openspec: false, branch: false, terminal: true });
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
