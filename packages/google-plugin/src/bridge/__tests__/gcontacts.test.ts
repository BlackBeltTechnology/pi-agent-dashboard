/**
 * L1 Contacts tools (test-plan #C109–#C117; tasks 12.108–12.116; scenario-gate C2–C5 as they apply to Contacts) against
 * the REAL lease handler and a fake People API. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { createFakeGoogle, type FakeGoogle, googleError, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const WORK = { sub: "s1", email: "a@x.com", alias: "work", products: { contacts: "write" } } as const;

interface Person {
  resourceName: string;
  etag: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value: string; type?: string }>;
  phoneNumbers?: Array<{ value: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}
const anna = (): Person => ({
  resourceName: "people/c1",
  etag: "e1",
  names: [{ displayName: "Anna Kovacs", givenName: "Anna", familyName: "Kovacs" }],
  emailAddresses: [{ value: "anna@example.com", type: "work" }, { value: "anna.k@home.example" }],
  phoneNumbers: [{ value: "+36 30 123 4567", type: "mobile" }],
  organizations: [{ name: "A", title: "Engineer" }],
});
const bob = (): Person => ({ resourceName: "people/c2", etag: "b1", names: [{ displayName: "Bob Smith", givenName: "Bob", familyName: "Smith" }], emailAddresses: [{ value: "bob@example.com" }] });
const BARE = (): Person => ({ resourceName: "people/c3", etag: "z1" });

const ARGS_CREATE = { givenName: "Cleo", emails: ["cleo@example.com"] };
const WRITE_NAMES = ["gcontacts_create", "gcontacts_update"] as const;
const PERSON_PATH = /^\/people\/c\d+$/;
const UPDATE_PATH = /^\/people\/c\d+:updateContact$/;

/** A tiny stateful People API: search matches the typed text against names, emails and phone digits; update enforces the etag. */
function people(google: FakeGoogle, initial: Person[] = [anna(), bob(), BARE()]) {
  const store = new Map<string, Person>(initial.map((p) => [p.resourceName, p]));
  let rev = 1;
  const digits = (s: string) => s.replace(/\D/g, "");
  const hit = (p: Person, q: string) => {
    const ql = q.toLowerCase();
    return (
      (p.names ?? []).some((n) => n.displayName?.toLowerCase().includes(ql)) ||
      (p.emailAddresses ?? []).some((e) => e.value.toLowerCase().startsWith(ql)) ||
      (digits(q).length > 3 && (p.phoneNumbers ?? []).some((e) => digits(e.value).includes(digits(q))))
    );
  };
  google
    .on("GET", "/people:searchContacts", (req) => ({ json: { results: [...store.values()].filter((p) => hit(p, req.query.query ?? "")).map((person) => ({ person })) } }))
    .on("GET", PERSON_PATH, (req) => {
      const p = store.get(req.path.slice(1));
      return p ? { json: p } : googleError(404, "NOT_FOUND", undefined, "Requested entity was not found.");
    })
    .on("POST", "/people:createContact", (req) => {
      const p = { resourceName: `people/c${100 + store.size}`, etag: "n1", ...(req.body as object) } as Person;
      store.set(p.resourceName, p);
      return { json: p };
    })
    .on("PATCH", UPDATE_PATH, (req) => {
      const name = req.path.slice(1).replace(":updateContact", "");
      const cur = store.get(name) as Person;
      const body = req.body as Person;
      if (body.etag !== cur.etag) return { status: 400, json: { error: { code: 400, message: "Request person.etag is different than the current person.etag.", status: "FAILED_PRECONDITION" } } };
      const merged: Record<string, unknown> = { ...cur };
      for (const f of (req.query.updatePersonFields ?? "").split(",")) merged[f] = (body as unknown as Record<string, unknown>)[f];
      const next = { ...merged, etag: `e${++rev}` } as unknown as Person;
      store.set(name, next);
      return { json: next };
    });
  return store;
}

type HostRuntime = NonNullable<NonNullable<Parameters<typeof makeToolHost>[0]>["runtime"]>;
function host(over: { account?: Record<string, unknown>; people?: Person[]; runtime?: HostRuntime } = {}) {
  const google = createFakeGoogle();
  const store = people(google, over.people);
  const h = makeToolHost({ accounts: [{ ...WORK, ...over.account } as never], google, ...(over.runtime ? { runtime: over.runtime } : {}) });
  return { ...h, store };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const confirmText = (c: ReturnType<typeof uiCtx>) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");
type Shaped = { resourceName: string; etag: string; names: string[]; emails: string[]; phones: string[]; organizations: Array<{ name: string; title: string }> };
const search = async (h: ReturnType<typeof host>, query: string) => jsonOf<{ contacts: Shaped[] }>(await h.run("gcontacts_search", { account: "work", query })).contacts;

describe("read tools", () => {
  it("#C109 searching an email returns Anna with resourceName, names, emails, phones and organisations — Bob absent", async () => {
    const h = host();
    const found = await search(h, "anna@example.com");
    expect(found).toEqual([
      {
        resourceName: "people/c1",
        etag: "e1",
        names: ["Anna Kovacs"],
        emails: ["anna@example.com", "anna.k@home.example"],
        phones: ["+36 30 123 4567"],
        organizations: [{ name: "A", title: "Engineer" }],
      },
    ]);
    expect(h.google.calls[0]?.query).toMatchObject({ query: "anna@example.com" });
    expect(h.google.calls[0]?.query.readMask).toContain("emailAddresses");
  });

  it("#C110/#GC22 the query goes to Google exactly as typed (no phone normalising, no warm-up call); formats and partial names are the service's matching", async () => {
    const h = host();
    expect((await search(h, "+36 30 123 4567")).map((c) => c.resourceName)).toEqual(["people/c1"]);
    expect((await search(h, "+36301234567")).map((c) => c.resourceName)).toEqual(["people/c1"]);
    expect((await search(h, "Ann")).map((c) => c.resourceName)).toEqual(["people/c1"]);
    expect(h.google.calls.map((c) => c.query.query)).toEqual(["+36 30 123 4567", "+36301234567", "Ann"]);
    expect(h.google.calls.every((c) => c.path === "/people:searchContacts")).toBe(true);
  });

  it("#C110 0 hits → an empty list; an empty or blank query is an argument error with no HTTP call", async () => {
    const h = host();
    expect(await search(h, "nobody-at-all")).toEqual([]);
    for (const query of ["", "   "]) expect((await err(h.run("gcontacts_search", { account: "work", query })))?.code).toBe("invalid_params");
    expect((await err(h.run("gcontacts_search", { account: "work" })))?.code).toBe("invalid_params");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#C111 `people/c1` and `c1` both read the contact; one without email/phone has empty arrays", async () => {
    const h = host();
    for (const resourceName of ["people/c1", "c1"]) {
      const c = jsonOf<Shaped>(await h.run("gcontacts_get", { account: "work", resourceName }));
      expect(c).toMatchObject({ resourceName: "people/c1", etag: "e1", names: ["Anna Kovacs"] });
    }
    expect(h.google.calls.map((c) => c.path)).toEqual(["/people/c1", "/people/c1"]);
    expect(jsonOf<Shaped>(await h.run("gcontacts_get", { account: "work", resourceName: "people/c3" }))).toEqual({ resourceName: "people/c3", etag: "z1", names: [], emails: [], phones: [], organizations: [] });
  });

  it("#C111 `people/me`, a bogus value or a path trick is an argument error with no HTTP call; an unknown contact is `contacts_error` 404", async () => {
    const h = host();
    for (const resourceName of ["people/me", "bogus", "people/c1/../me", "c1:batch", "otherContacts/c1", ""]) {
      expect((await err(h.run("gcontacts_get", { account: "work", resourceName })))?.code, resourceName).toBe("invalid_params");
    }
    expect(h.google.calls).toHaveLength(0);
    const e = await err(h.run("gcontacts_get", { account: "work", resourceName: "people/c999" }));
    expect(e?.code).toBe("contacts_error");
    expect(e?.status).toBe(404);
    expect(h.google.calls).toHaveLength(1);
  });
});

describe("write tools", () => {
  it("#C112 update preview lists only the changed fields old → new; the request mask and body carry only those plus the etag", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ updated: boolean; etag: string }>(await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", phones: ["+36 30 123 4567", "+36 1 555 0000"], organization: "B" }, ui.ctx));
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "Contact: Anna Kovacs [people/c1]", "Change phones: +36 30 123 4567 \u2192 +36 30 123 4567, +36 1 555 0000", "Change organization: A \u2192 B"]) expect(text).toContain(part);
    expect(text).not.toContain("emails");
    expect(text).not.toContain("job title");
    const w = h.google.writes();
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ method: "PATCH", path: "/people/c1:updateContact" });
    expect(w[0]?.query.updatePersonFields).toBe("phoneNumbers,organizations");
    expect(w[0]?.body).toEqual({
      etag: "e1",
      phoneNumbers: [{ value: "+36 30 123 4567", type: "mobile" }, { value: "+36 1 555 0000" }],
      organizations: [{ name: "B", title: "Engineer" }],
    });
    expect(r).toMatchObject({ updated: true, etag: "e2" });
  });

  it("#C112 a field passed with its current value is not part of the preview, the mask or the body", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", emails: ["anna@example.com", "anna.k@home.example"], givenName: "Anna", organization: "B" }, ui.ctx);
    expect(confirmText(ui)).not.toContain("emails");
    expect(confirmText(ui)).not.toContain("given name");
    expect(h.google.writes()[0]?.query.updatePersonFields).toBe("organizations");
    expect(Object.keys(h.google.writes()[0]?.body as object).sort()).toEqual(["etag", "organizations"]);
  });

  it("#C112 a field that had no value shows `(none) → …`", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcontacts_update", { account: "work", resourceName: "people/c3", phones: ["+36 1 555 0000"] }, ui.ctx);
    expect(confirmText(ui)).toContain("Change phones: (none) \u2192 +36 1 555 0000");
  });

  it("#C112 an update that changes nothing is `unchanged`: no dialog, no write", async () => {
    const h = host();
    const ui = uiCtx(true);
    expect(jsonOf(await h.run("gcontacts_update", { account: "work", resourceName: "c1", organization: "A", emails: ["anna@example.com", "anna.k@home.example"] }, ui.ctx))).toEqual({ unchanged: true, resourceName: "people/c1" });
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.writes()).toHaveLength(0);
  });

  it("#C113 create with name + email: dialog shows the new values, one POST, resourceName returned; the contact exists", async () => {
    const h = host();
    const ui = uiCtx(true);
    const r = jsonOf<{ created: boolean; resourceName: string; emails: string[] }>(await h.run("gcontacts_create", { account: "work", givenName: "Cleo", familyName: "Nagy", emails: ["cleo@example.com"] }, ui.ctx));
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "Given name: Cleo", "Family name: Nagy", "Emails: cleo@example.com"]) expect(text).toContain(part);
    expect(h.google.writes()).toHaveLength(1);
    expect(h.google.writes()[0]).toMatchObject({ method: "POST", path: "/people:createContact", body: { names: [{ givenName: "Cleo", familyName: "Nagy" }], emailAddresses: [{ value: "cleo@example.com" }] } });
    expect(Object.keys(h.google.writes()[0]?.body as object).sort()).toEqual(["emailAddresses", "names"]);
    expect(r).toMatchObject({ created: true, resourceName: "people/c103", emails: ["cleo@example.com"] });
    expect(h.store.has("people/c103")).toBe(true);
  });

  it("#C113 create with no fields, only blanks, or an invalid email/phone is an argument error before the dialog; 0 HTTP calls", async () => {
    for (const args of [{}, { givenName: "" }, { emails: [] }, { givenName: "  ", phones: [] }, { emails: ["not-an-email"] }, { emails: ["a@b.com", "x@"] }, { phones: ["call me"] }, { emails: "a@b.com" }, { givenName: 5 }]) {
      const h = host();
      const ui = uiCtx(true);
      expect((await err(h.run("gcontacts_create", { account: "work", ...args }, ui.ctx)))?.code, JSON.stringify(args)).toBe("invalid_params");
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.calls).toHaveLength(0);
    }
  });

  it("#C114/#GC15 a contact changed after the read (etag e1 → e2): the update with e1 fails `revision_changed`; the contact is unchanged", async () => {
    const h = host();
    const read = jsonOf<Shaped>(await h.run("gcontacts_get", { account: "work", resourceName: "people/c1" }));
    expect(read.etag).toBe("e1");
    h.store.set("people/c1", { ...(h.store.get("people/c1") as Person), etag: "e2", organizations: [{ name: "Z" }] });
    const before = JSON.stringify(h.store.get("people/c1"));
    const e = await err(h.run("gcontacts_update", { account: "work", resourceName: "people/c1", etag: read.etag, organization: "B" }, uiCtx(true).ctx));
    expect(e?.code).toBe("revision_changed");
    expect(JSON.stringify(h.store.get("people/c1"))).toBe(before);
    expect(h.google.writes()[0]?.body).toMatchObject({ etag: "e1" });
  });

  it("#C114 without an etag argument the update is guarded by the etag read for the dialog (a change during the dialog is `revision_changed`)", async () => {
    const h = host();
    const ui = uiCtx(async () => {
      h.store.set("people/c1", { ...(h.store.get("people/c1") as Person), etag: "e9" });
      return true;
    });
    expect((await err(h.run("gcontacts_update", { account: "work", resourceName: "people/c1", organization: "B" }, ui.ctx)))?.code).toBe("revision_changed");
    expect(h.google.writes()[0]?.body).toMatchObject({ etag: "e1" });
    expect(h.store.get("people/c1")?.organizations?.[0]?.name).toBe("A");
  });

  it("#C114 other 400s stay `contacts_error` (only FAILED_PRECONDITION is a stale version)", async () => {
    const h = host();
    h.google.on("PATCH", UPDATE_PATH, googleError(400, "INVALID_ARGUMENT", undefined, "bad field"));
    expect((await err(h.run("gcontacts_update", { account: "work", resourceName: "people/c1", organization: "B" }, uiCtx(true).ctx)))?.code).toBe("contacts_error");
  });

  it("#C115 a second update that reuses the old etag fails `revision_changed`; the first returned the new etag", async () => {
    const h = host();
    const first = jsonOf<{ etag: string }>(await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", etag: "e1", organization: "B" }, uiCtx(true).ctx));
    expect(first.etag).toBe("e2");
    expect((await err(h.run("gcontacts_update", { account: "work", resourceName: "people/c1", etag: "e1", organization: "C" }, uiCtx(true).ctx)))?.code).toBe("revision_changed");
    expect(h.store.get("people/c1")?.organizations?.[0]?.name).toBe("B");
    const third = jsonOf<{ etag: string }>(await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", etag: first.etag, organization: "C" }, uiCtx(true).ctx));
    expect(third.etag).toBe("e3");
  });

  const WRITES = ["gcontacts_create", "gcontacts_update"] as const;
  const ARGS: Record<(typeof WRITES)[number], Record<string, unknown>> = {
    gcontacts_create: { givenName: "Cleo", emails: ["cleo@example.com"] },
    gcontacts_update: { resourceName: "people/c1", organization: "B" },
  };

  it("#C116 deny, dismiss and timeout on create/update: 0 write requests, contacts unchanged", async () => {
    for (const tool of WRITES) {
      for (const answer of [false, "throw", "never"] as const) {
        const h = host({ runtime: { confirmTimeoutMs: 20 } });
        const before = JSON.stringify([...h.store]);
        const e = await err(h.run(tool, { account: "work", ...ARGS[tool] }, uiCtx(answer).ctx));
        expect(e?.code, `${tool}/${answer}`).toBe("denied");
        expect(h.google.writes(), `${tool}/${answer}`).toHaveLength(0);
        expect(JSON.stringify([...h.store]), `${tool}/${answer}`).toBe(before);
      }
    }
  });

  it("#C116 with no UI both writes are blocked before any HTTP call", async () => {
    for (const tool of WRITES) {
      const h = host();
      expect((await err(h.run(tool, { account: "work", ...ARGS[tool] }, NO_UI)))?.code, tool).toBe("blocked");
      expect(h.google.calls, tool).toHaveLength(0);
    }
  });

  it("#C116 no delete tool is registered — the contact tools are exactly search, get, create, update", async () => {
    const h = host();
    const names = h.tools.map((t) => t.name).filter((n) => n.startsWith("gcontacts_")).sort();
    expect(names).toEqual(["gcontacts_create", "gcontacts_get", "gcontacts_search", "gcontacts_update"]);
    expect(h.tools.some((t) => /delete|remove/i.test(t.name) && t.name.includes("contact"))).toBe(false);
  });

  it("#C117 removing the only email and clearing the organisation: preview says `old → (removed)`; the mask carries the fields with empty values, the rest untouched", async () => {
    const h = host({ people: [{ ...anna(), emailAddresses: [{ value: "anna@example.com" }], organizations: [{ name: "A" }] }] });
    const ui = uiCtx(true);
    await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", emails: [], organization: "" }, ui.ctx);
    const text = confirmText(ui);
    expect(text).toContain("Change emails: anna@example.com \u2192 (removed)");
    expect(text).toContain("Change organization: A \u2192 (removed)");
    expect(text).not.toContain("phones");
    const w = h.google.writes()[0];
    expect(w?.query.updatePersonFields).toBe("emailAddresses,organizations");
    expect(w?.body).toEqual({ etag: "e1", emailAddresses: [], organizations: [] });
    expect(h.store.get("people/c1")).toMatchObject({ emailAddresses: [], organizations: [], phoneNumbers: [{ value: "+36 30 123 4567", type: "mobile" }], names: [{ displayName: "Anna Kovacs", givenName: "Anna", familyName: "Kovacs" }] });
  });

  it("#C117 clearing only the job title keeps the organisation name", async () => {
    const h = host();
    await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", jobTitle: "" }, uiCtx(true).ctx);
    expect(h.google.writes()[0]?.body).toEqual({ etag: "e1", organizations: [{ name: "A" }] });
  });

  it("renaming sends only the changed name part merged with the stored one", async () => {
    const h = host();
    await h.run("gcontacts_update", { account: "work", resourceName: "people/c1", givenName: "Annabel" }, uiCtx(true).ctx);
    expect(h.google.writes()[0]?.query.updatePersonFields).toBe("names");
    expect(h.google.writes()[0]?.body).toEqual({ etag: "e1", names: [{ givenName: "Annabel", familyName: "Kovacs" }] });
  });
});

describe("scenario-gate decisions (Contacts)", () => {
  it("#GC1 Retry-After: 86400 fails at once with rate_limited (1 attempt)", async () => {
    const h = host();
    h.google.on("GET", "/people:searchContacts", { status: 429, headers: { "retry-after": "86400" }, json: {} });
    expect((await err(h.run("gcontacts_search", { account: "work", query: "anna" })))?.code).toBe("rate_limited");
    expect(h.google.calls).toHaveLength(1);
  });

  it("#GC2 a Contacts write that gets 503 is not retried (POST and PATCH); a read is", async () => {
    const c = host();
    c.google.on("POST", "/people:createContact", [{ status: 503, json: {} }, { json: anna() }]);
    expect((await err(c.run("gcontacts_create", { account: "work", ...ARGS_CREATE }, uiCtx(true).ctx)))?.status).toBe(503);
    expect(c.google.to("POST")).toHaveLength(1);

    const u = host();
    u.google.on("PATCH", UPDATE_PATH, [{ status: 503, json: {} }, { json: anna() }]);
    expect((await err(u.run("gcontacts_update", { account: "work", resourceName: "people/c1", organization: "B" }, uiCtx(true).ctx)))?.status).toBe(503);
    expect(u.google.to("PATCH")).toHaveLength(1);

    const r = host();
    r.google.on("GET", "/people:searchContacts", [{ status: 503, json: {} }, { json: {} }]);
    expect(await search(r, "anna")).toEqual([]);
    expect(r.google.calls).toHaveLength(2);
  });

  it("#GC3 the confirm text clips long values (≤ 500 chars each)", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcontacts_create", { account: "work", organization: "O".repeat(900) }, ui.ctx);
    const text = confirmText(ui);
    expect(text).not.toContain("O".repeat(501));
    expect(text.length).toBeLessThan(1500);
  });

  it("#GC4 an unclassified 403 is `contacts_error`", async () => {
    const h = host();
    h.google.on("GET", "/people:searchContacts", googleError(403, "forbidden", undefined, "nope"));
    expect((await err(h.run("gcontacts_search", { account: "work", query: "anna" })))?.code).toBe("contacts_error");
  });

  it("#GC5 both write tools with Contacts at `read` are `level_insufficient` naming Settings → Google accounts, before any HTTP call", async () => {
    for (const tool of WRITE_NAMES) {
      const h = host({ account: { products: { contacts: "read" } } });
      const ui = uiCtx(true);
      const e = await err(h.run(tool, { account: "work", ...(tool === "gcontacts_create" ? ARGS_CREATE : { resourceName: "people/c1", organization: "B" }) }, ui.ctx));
      expect(e?.code, tool).toBe("level_insufficient");
      expect(e?.message, tool).toContain("Settings \u2192 Google accounts");
      expect(h.google.calls, tool).toHaveLength(0);
      expect(ui.confirm).not.toHaveBeenCalled();
    }
    const ro = host({ account: { products: { contacts: "read" } } });
    expect(await search(ro, "bob")).toHaveLength(1);
  });
});

