/**
 * Built-in app availability per browser, client selection order, and which client a grant refreshes with
 * (test-plan A1–A13, A42–A46, B20; scenario-gate A7/A11). See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { account, LOCAL, memoryCredentials, OWN_BB, OWN_SEMMI, ownClient, REMOTE } from "../../__tests__/fakes.js";
import type { BuiltInClients, Switches } from "../../shared/default-clients.js";
import { availability, builtinFor, clientForGrant, selectClient } from "../clients.js";
import { acctKey, clientKey, GoogleStore } from "../store.js";

function deps(opts: { builtIn?: BuiltInClients; sw?: Partial<Switches>; initial?: Record<string, never> } = {}) {
  const store = new GoogleStore(memoryCredentials((opts.initial ?? {}) as never));
  const sw: Switches = { defaultClients: true, remoteReturn: true, ...opts.sw };
  return { store, builtIn: opts.builtIn ?? { local: LOCAL, remote: REMOTE }, switches: () => sw, sw };
}

describe("built-in app availability per browser (A1–A2, A7–A10, B20)", () => {
  it("ships empty: no browser gets it", () => {
    const d = deps({ builtIn: { local: null, remote: null } });
    expect(builtinFor(d, "local")).toBeNull();
    expect(builtinFor(d, "remote")).toBeNull();
  });
  it("local browser → desktop client `builtin`; remote browser → web client `builtin-remote`", () => {
    const d = deps();
    expect(builtinFor(d, "local")).toMatchObject({ ref: "builtin", type: "installed", clientId: LOCAL.clientId });
    expect(builtinFor(d, "remote")).toMatchObject({ ref: "builtin-remote", type: "web", clientId: REMOTE.clientId });
  });
  it("only the local project shipped: a remote browser has no built-in app", () => {
    const d = deps({ builtIn: { local: LOCAL, remote: null } });
    expect(builtinFor(d, "local")).not.toBeNull();
    expect(builtinFor(d, "remote")).toBeNull();
  });
  it("PI_GOOGLE_REMOTE_RETURN=off gates the remote path only; the local browser ignores it", () => {
    const d = deps({ sw: { remoteReturn: false } });
    expect(builtinFor(d, "remote")).toBeNull();
    expect(builtinFor(d, "local")).not.toBeNull();
  });
  it("PI_GOOGLE_DEFAULT_CLIENTS=off removes the built-in app for every browser", () => {
    const d = deps({ sw: { defaultClients: false } });
    expect(builtinFor(d, "local")).toBeNull();
    expect(builtinFor(d, "remote")).toBeNull();
  });
  it("availability lists clients without secrets", async () => {
    const d = deps({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    const a = await availability(d, "remote");
    expect(a).toMatchObject({ browser: "remote", builtin: { available: true, ref: "builtin-remote" } });
    expect(JSON.stringify(a)).not.toContain("SECRET");
  });
});

describe("client selection order (D5; A42–A46)", () => {
  const withSemmi = (builtIn?: BuiltInClients) =>
    deps({
      builtIn,
      initial: {
        [clientKey("semmi")]: ownClient("semmi", "Semmi", OWN_SEMMI, { domains: ["semmi.se"] }) as never,
        [clientKey("bb")]: ownClient("bb", "BlackBelt", OWN_BB, { domains: ["blackbelt.hu"] }) as never,
      },
    });
  const pick = async (d: ReturnType<typeof deps>, input: { client?: string; email?: string }, browser: "local" | "remote" = "local") => {
    const r = await selectClient(d, { ...input, browser });
    return r.ok ? r.client.ref : r.error;
  };
  it("explicit > domain match > built-in > client_required — in every combination (A42)", async () => {
    const d = withSemmi();
    expect(await pick(d, { client: "own:bb", email: "x@semmi.se" })).toBe("own:bb"); // explicit beats a domain match
    expect(await pick(d, { email: "x@semmi.se" })).toBe("own:semmi");
    expect(await pick(d, { email: "x@gmail.com" })).toBe("builtin");
    expect(await pick(d, {})).toBe("builtin");
    const none = withSemmi({ local: null, remote: null });
    expect(await pick(none, { client: "own:bb", email: "x@semmi.se" })).toBe("own:bb");
    expect(await pick(none, { email: "x@semmi.se" })).toBe("own:semmi");
    expect(await pick(none, { email: "x@gmail.com" })).toBe("client_required");
    expect(await pick(none, {})).toBe("client_required");
  });
  it("matches the email domain case-insensitively and exactly — a subdomain does not match (A44)", async () => {
    const d = withSemmi({ local: null, remote: null });
    expect(await pick(d, { email: "Robson@SEMMI.SE" })).toBe("own:semmi");
    expect(await pick(d, { email: "a@mail.semmi.se" })).toBe("client_required");
  });
  it("no silent fallback to an unrelated own client; the reply lists the clients to pick (A45)", async () => {
    const d = withSemmi({ local: null, remote: null });
    const r = await selectClient(d, { email: "x@gmail.com", browser: "local" });
    expect(r).toMatchObject({ ok: false, status: 400, error: "client_required" });
    expect(r.ok ? [] : r.clients.map((c) => c.id)).toEqual(["semmi", "bb"]);
  });
  it("the built-in app is chosen for THIS browser (A46)", async () => {
    const d = withSemmi();
    expect(await pick(d, { email: "x@gmail.com" }, "remote")).toBe("builtin-remote");
  });
  it("an unknown explicit client → 404 client_not_found (A7); explicit `builtin` needs availability", async () => {
    const d = withSemmi({ local: null, remote: null });
    expect(await selectClient(d, { client: "own:ghost", browser: "local" })).toMatchObject({ ok: false, status: 404, error: "client_not_found" });
    expect(await selectClient(d, { client: "builtin", browser: "local" })).toMatchObject({ ok: false, error: "default_client_unavailable" });
  });
  it("explicit `builtin` from a remote browser resolves to the remote project; `builtin-remote` never to the local one", async () => {
    const d = deps();
    expect(await pick(d, { client: "builtin" }, "remote")).toBe("builtin-remote");
    expect(await pick(d, { client: "builtin-remote" }, "local")).toBe("builtin-remote");
    const only = deps({ builtIn: { local: LOCAL, remote: null } });
    expect(await pick(only, { client: "builtin-remote" }, "local")).toBe("default_client_unavailable");
  });
});

describe("the client a grant refreshes with (A3–A5, A11)", () => {
  it("built-in refs need the shipped client id to match the recorded one", async () => {
    const d = deps();
    expect(await clientForGrant(d, "builtin", LOCAL.clientId)).toMatchObject({ ok: true, client: { clientSecret: LOCAL.clientSecret } });
    expect(await clientForGrant(d, "builtin", "rotated.apps.googleusercontent.com")).toEqual({ ok: false, error: "default_client_unavailable" });
    expect(await clientForGrant(deps({ builtIn: { local: null, remote: null } }), "builtin", LOCAL.clientId)).toEqual({ ok: false, error: "default_client_unavailable" });
  });
  it("PI_GOOGLE_DEFAULT_CLIENTS=off is a hard stop for both built-in refs, not for own clients", async () => {
    const d = deps({ sw: { defaultClients: false }, initial: { [clientKey("bb")]: ownClient("bb", "BB") as never } });
    expect(await clientForGrant(d, "builtin", LOCAL.clientId)).toEqual({ ok: false, error: "default_client_unavailable" });
    expect(await clientForGrant(d, "builtin-remote", REMOTE.clientId)).toEqual({ ok: false, error: "default_client_unavailable" });
    expect(await clientForGrant(d, "own:bb", OWN_BB.clientId)).toMatchObject({ ok: true });
  });
  it("PI_GOOGLE_REMOTE_RETURN=off does not stop refresh of a builtin-remote grant (A11)", async () => {
    const d = deps({ sw: { remoteReturn: false } });
    expect(await clientForGrant(d, "builtin-remote", REMOTE.clientId)).toMatchObject({ ok: true });
  });
  it("an own client that vanished, or whose Google id changed, is `no_client`", async () => {
    const d = deps({ initial: { [clientKey("bb")]: ownClient("bb", "BB") as never, [acctKey("s1")]: account("s1", "a@x.com") as never } });
    expect(await clientForGrant(d, "own:ghost", OWN_BB.clientId)).toEqual({ ok: false, error: "no_client" });
    expect(await clientForGrant(d, "own:bb", "other.apps.googleusercontent.com")).toEqual({ ok: false, error: "no_client" });
  });
});
