/**
 * L1 Calendar tools (test-plan #C22, #C27–#C39; tasks 12.22, 12.27–12.39) against the REAL lease handler and a
 * fake Google Calendar. See change: add-google-connect.
 */
import { describe, expect, it } from "vitest";
import { createFakeGoogle, type FakeGoogle, googleError, jsonOf, makeToolHost, NO_UI, uiCtx } from "./fake-google.js";

const ME = "a@x.com";
const WORK = { sub: "s1", email: ME, alias: "work", products: { calendar: "write" } } as const;

const meeting = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  status: "confirmed",
  summary: "Standup",
  location: "Room 4",
  start: { dateTime: "2026-05-10T09:00:00+02:00", timeZone: "Europe/Budapest" },
  end: { dateTime: "2026-05-10T09:15:00+02:00", timeZone: "Europe/Budapest" },
  organizer: { email: "boss@x.com" },
  attendees: [
    { email: "boss@x.com", organizer: true, responseStatus: "accepted" },
    { email: ME, self: true, responseStatus: "needsAction" },
    { email: "pat@x.com", displayName: "Pat", responseStatus: "declined" },
  ],
  ...over,
});

/** A tiny stateful calendar behind the fake: GET/PATCH/DELETE one event, POST creates. */
function calendar(google: FakeGoogle, initial: Array<ReturnType<typeof meeting>> = [meeting()]) {
  const store = new Map<string, ReturnType<typeof meeting>>(initial.map((e) => [e.id, e]));
  google
    .on("GET", /^\/calendars\/[^/]+\/events\/[^/]+$/, (req) => {
      const e = store.get(decodeURIComponent(req.path.split("/").pop() ?? ""));
      return e ? { json: e } : googleError(404, "notFound", undefined, "Not Found");
    })
    .on("PATCH", /^\/calendars\/[^/]+\/events\/[^/]+$/, (req) => {
      const id = req.path.split("/").pop() ?? "";
      const e = { ...(store.get(id) as object), ...(req.body as object) } as ReturnType<typeof meeting>;
      store.set(id, e);
      return { json: e };
    })
    .on("DELETE", /^\/calendars\/[^/]+\/events\/[^/]+$/, (req) => {
      store.delete(req.path.split("/").pop() ?? "");
      return { status: 204 };
    })
    .on("POST", /^\/calendars\/[^/]+\/events$/, (req) => {
      const id = `new${store.size + 1}`;
      const e = { id, status: "confirmed", ...(req.body as object) } as ReturnType<typeof meeting>;
      store.set(id, e);
      return { json: e };
    });
  return store;
}

function host(over: { account?: Record<string, unknown>; events?: Array<ReturnType<typeof meeting>> } = {}) {
  const google = createFakeGoogle();
  const store = calendar(google, over.events);
  const h = makeToolHost({ accounts: [{ ...WORK, ...over.account } as never], google });
  return { ...h, store };
}
const err = (p: Promise<unknown>) => p.then(() => undefined, (e: Error & { code?: string; status?: number }) => e);
const RANGE = { timeMin: "2026-05-10T00:00:00+02:00", timeMax: "2026-05-11T00:00:00+02:00" };
const confirmText = (c: ReturnType<typeof uiCtx>) => (c.confirm.mock.calls[0] as [string, string]).slice(0, 2).join("\n");

describe("read tools", () => {
  it("#C27 gcal_events: ids, offset/zone times, title, location, attendees with response status; all-day has `date`", async () => {
    const h = host();
    h.google.on("GET", "/calendars/primary/events", {
      json: {
        timeZone: "Europe/Budapest",
        items: [meeting({ id: "allday", summary: "Holiday", location: undefined, attendees: undefined, start: { date: "2026-05-10" }, end: { date: "2026-05-11" } }), meeting()],
      },
    });
    const r = jsonOf<{ calendar: string; timeZone: string; events: Array<Record<string, any>> }>(await h.run("gcal_events", { account: "work", calendarId: "primary", ...RANGE }));
    expect(r.timeZone).toBe("Europe/Budapest");
    const [allday, timed] = r.events;
    expect(allday).toMatchObject({ id: "allday", title: "Holiday", start: { date: "2026-05-10" }, end: { date: "2026-05-11" } });
    expect(allday?.start.dateTime).toBeUndefined();
    expect(timed).toMatchObject({ id: "e1", title: "Standup", location: "Room 4", start: { dateTime: "2026-05-10T09:00:00+02:00", timeZone: "Europe/Budapest" } });
    expect(timed?.attendees).toEqual([
      { email: "boss@x.com", responseStatus: "accepted", organizer: true },
      { email: ME, responseStatus: "needsAction", self: true },
      { email: "pat@x.com", name: "Pat", responseStatus: "declined" },
    ]);
    const q = h.google.calls[0]?.query;
    expect(q).toMatchObject({ singleEvents: "true", orderBy: "startTime", timeMin: RANGE.timeMin, timeMax: RANGE.timeMax, maxResults: "50" });
    expect(h.google.calls[0]?.token).toBe("ACCESS-s1");
  });

  it("#C26 a page holds ≤ 50 events and hands back Google's nextPageToken; a pageToken is forwarded", async () => {
    const h = host();
    h.google.on("GET", "/calendars/primary/events", (req) => ({ json: { items: [meeting()], nextPageToken: req.query.pageToken ? undefined : "TOK2" } }));
    expect((await err(h.run("gcal_events", { account: "work", ...RANGE, maxResults: 500 })))?.code).toBe("invalid_params");
    const ok = jsonOf<{ nextPageToken?: string }>(await h.run("gcal_events", { account: "work", ...RANGE, maxResults: 50 }));
    expect(ok.nextPageToken).toBe("TOK2");
    const last = jsonOf<{ nextPageToken?: string }>(await h.run("gcal_events", { account: "work", ...RANGE, pageToken: "TOK2" }));
    expect(last.nextPageToken).toBeUndefined();
    expect(h.google.calls).toHaveLength(2);
    expect(h.google.calls[0]?.query.maxResults).toBe("50");
    expect(h.google.calls[1]?.query.pageToken).toBe("TOK2");
  });

  it("#C28 range bounds pass through verbatim (DST day, 23 h); an event ending at timeMin is not returned, a spanning one once", async () => {
    const h = host();
    const dst = { timeMin: "2026-03-29T00:00:00+01:00", timeMax: "2026-03-30T00:00:00+02:00" };
    const all = [
      meeting({ id: "ends-at-start", start: { dateTime: "2026-03-28T23:00:00+01:00" }, end: { dateTime: "2026-03-29T00:00:00+01:00" } }),
      meeting({ id: "spanning", start: { dateTime: "2026-03-28T22:00:00+01:00" }, end: { dateTime: "2026-03-29T01:00:00+01:00" } }),
      meeting({ id: "starts-at-end", start: { dateTime: "2026-03-30T00:00:00+02:00" }, end: { dateTime: "2026-03-30T01:00:00+02:00" } }),
      meeting({ id: "inside", start: { dateTime: "2026-03-29T12:00:00+02:00" }, end: { dateTime: "2026-03-29T13:00:00+02:00" } }),
    ];
    // Google semantics: timeMin is compared with an event's END (exclusive), timeMax with its START (exclusive)
    h.google.on("GET", "/calendars/primary/events", (req) => ({
      json: { items: all.filter((e) => Date.parse(e.end.dateTime) > Date.parse(req.query.timeMin as string) && Date.parse(e.start.dateTime) < Date.parse(req.query.timeMax as string)) },
    }));
    const r = jsonOf<{ events: Array<{ id: string }> }>(await h.run("gcal_events", { account: "work", ...dst }));
    expect(r.events.map((e) => e.id)).toEqual(["spanning", "inside"]);
    expect(h.google.calls).toHaveLength(1);
    expect(h.google.calls[0]?.query).toMatchObject(dst);
    expect(Date.parse(dst.timeMax) - Date.parse(dst.timeMin)).toBe(23 * 3_600_000);
  });

  it("#C29 q is forwarded; 0 matches → an empty list, no error", async () => {
    const h = host();
    h.google.on("GET", "/calendars/primary/events", { json: { items: [] } });
    const r = jsonOf<{ events: unknown[] }>(await h.run("gcal_events", { account: "work", ...RANGE, q: "standup" }));
    expect(r.events).toEqual([]);
    expect(h.google.calls[0]?.query.q).toBe("standup");
  });

  it("#C30 end ≤ start, a non-ISO date or a missing UTC offset is an argument error before any HTTP call", async () => {
    const h = host();
    const bad = [
      { timeMin: "2026-05-11T00:00:00+02:00", timeMax: "2026-05-10T00:00:00+02:00" },
      { timeMin: "2026-05-10T00:00:00+02:00", timeMax: "2026-05-10T00:00:00+02:00" },
      { timeMin: "yesterday", timeMax: "2026-05-11T00:00:00+02:00" },
      { timeMin: "2026-05-10", timeMax: "2026-05-11" },
      { timeMin: "2026-05-10T00:00:00", timeMax: "2026-05-11T00:00:00" },
      { timeMin: "2026-13-10T00:00:00Z", timeMax: "2026-14-11T00:00:00Z" },
      { timeMin: "2026-05-10T00:00:00+02:00" },
    ];
    for (const range of bad) {
      for (const tool of ["gcal_events", "gcal_freebusy"]) {
        const e = await err(h.run(tool, { account: "work", ...range }));
        expect(e?.code, `${tool} ${JSON.stringify(range)}`).toBe("invalid_params");
      }
    }
    expect(h.google.calls).toHaveLength(0);
    expect(h.leaseCalls()).toHaveLength(0);
  });

  it("#C31 gcal_calendars lists id, name, access role and zone; gcal_event_get on an unknown id → calendar_error 404, not retried", async () => {
    const h = host();
    h.google.on("GET", "/users/me/calendarList", {
      json: { items: [{ id: "primary", summary: "a@x.com", timeZone: "Europe/Budapest", accessRole: "owner", primary: true }, { id: "team@group", summary: "Team", summaryOverride: "Team (mine)", timeZone: "UTC", accessRole: "reader" }] },
    });
    const r = jsonOf<{ calendars: unknown[] }>(await h.run("gcal_calendars", { account: "work" }));
    expect(r.calendars).toEqual([
      { id: "primary", name: "a@x.com", accessRole: "owner", tz: "Europe/Budapest", primary: true },
      { id: "team@group", name: "Team (mine)", accessRole: "reader", tz: "UTC" },
    ]);
    const e = await err(h.run("gcal_event_get", { account: "work", eventId: "nope" }));
    expect(e?.code).toBe("calendar_error");
    expect(e?.status).toBe(404);
    expect(h.google.to("GET", /events\/nope$/)).toHaveLength(1);
  });

  it("gcal_event_get returns the event with its description (bounded)", async () => {
    const h = host({ events: [meeting({ description: "d".repeat(6000) } as never)] });
    const r = jsonOf<{ id: string; description: string }>(await h.run("gcal_event_get", { account: "work", eventId: "e1" }));
    expect(r.id).toBe("e1");
    expect(r.description.length).toBe(5001);
  });

  it("#C32 gcal_freebusy: busy intervals per calendar; a calendar Google reports an error for is not silently empty", async () => {
    const h = host();
    h.google.on("POST", "/freeBusy", {
      json: { calendars: { primary: { busy: [{ start: "2026-05-10T09:00:00Z", end: "2026-05-10T10:00:00Z" }] }, "gone@group": { busy: [], errors: [{ domain: "global", reason: "notFound" }] } } },
    });
    const r = jsonOf<{ calendars: Array<Record<string, unknown>> }>(await h.run("gcal_freebusy", { account: "work", calendarIds: ["primary", "gone@group"], ...RANGE }));
    expect(r.calendars).toEqual([
      { id: "primary", busy: [{ start: "2026-05-10T09:00:00Z", end: "2026-05-10T10:00:00Z" }] },
      { id: "gone@group", busy: [], errors: ["notFound"] },
    ]);
    expect(h.google.calls[0]?.body).toEqual({ ...RANGE, items: [{ id: "primary" }, { id: "gone@group" }] });
  });

  it("#C33 Calendar disabled → product_disabled naming Settings → Google, no HTTP call", async () => {
    const h = host({ account: { products: { gmail: "readonly" } } });
    for (const tool of ["gcal_calendars", "gcal_events", "gcal_event_get", "gcal_freebusy"]) {
      const e = await err(h.run(tool, { account: "work", eventId: "e1", ...RANGE }));
      expect(e?.code).toBe("product_disabled");
      expect(e?.message).toContain("Settings \u2192 Google");
    }
    expect(h.google.calls).toHaveLength(0);
  });

  it("a Calendar level `read` account can use every read tool", async () => {
    const h = host({ account: { products: { calendar: "read" } } });
    h.google.on("GET", "/calendars/primary/events", { json: { items: [] } });
    await h.run("gcal_events", { account: "work", ...RANGE });
    expect(h.leaseCalls()[0]?.payload).toEqual({ account: "s1", product: "calendar", level: "read" });
  });
});

const WRITES = ["gcal_event_create", "gcal_event_update", "gcal_event_delete", "gcal_event_respond"] as const;
const ARGS: Record<(typeof WRITES)[number], Record<string, unknown>> = {
  gcal_event_create: { title: "Lunch", start: "2026-05-12T12:00:00+02:00", end: "2026-05-12T13:00:00+02:00", attendees: ["x@y.com", "z@y.com"] },
  gcal_event_update: { eventId: "e1", title: "Standup (moved)" },
  gcal_event_delete: { eventId: "e1" },
  gcal_event_respond: { eventId: "e1", response: "accepted" },
};
const METHOD = { gcal_event_create: "POST", gcal_event_update: "PATCH", gcal_event_delete: "DELETE", gcal_event_respond: "PATCH" } as const;

describe("write tools", () => {
  it("#C34 the create dialog shows account, calendar, title, start, end, attendees and that nobody is emailed", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcal_event_create", { account: "work", calendarId: "team@group", ...ARGS.gcal_event_create, timeZone: "Europe/Budapest", location: "Cafe" }, ui.ctx);
    const text = confirmText(ui);
    for (const part of ["Account: a@x.com", "Calendar: team@group", "Title: Lunch", "Start: 2026-05-12T12:00:00+02:00 (Europe/Budapest)", "End: 2026-05-12T13:00:00+02:00", "Attendees (2): x@y.com, z@y.com", "Location: Cafe", "attendees will NOT be emailed"]) {
      expect(text).toContain(part);
    }
    const w = h.google.writes();
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe("/calendars/team%40group/events");
    expect(w[0]?.body).toEqual({
      summary: "Lunch",
      start: { dateTime: "2026-05-12T12:00:00+02:00", timeZone: "Europe/Budapest" },
      end: { dateTime: "2026-05-12T13:00:00+02:00", timeZone: "Europe/Budapest" },
      location: "Cafe",
      attendees: [{ email: "x@y.com" }, { email: "z@y.com" }],
    });
  });

  it("an all-day event is created with dates", async () => {
    const h = host();
    await h.run("gcal_event_create", { account: "work", title: "Off", start: "2026-05-12", end: "2026-05-13" }, uiCtx(true).ctx);
    expect(h.google.writes()[0]?.body).toMatchObject({ start: { date: "2026-05-12" }, end: { date: "2026-05-13" } });
    expect(h.google.writes()[0]?.query.sendUpdates).toBe("none");
  });

  it("#C35 invitations are silent unless notify is true — request and dialog agree, for all four writes", async () => {
    for (const tool of WRITES) {
      for (const notify of [undefined, false, true]) {
        const h = host();
        const ui = uiCtx(true);
        await h.run(tool, { account: "work", ...ARGS[tool], ...(notify === undefined ? {} : { notify }) }, ui.ctx);
        const write = h.google.to(METHOD[tool])[0];
        expect(write?.query.sendUpdates, `${tool} notify=${notify}`).toBe(notify ? "all" : "none");
        expect(confirmText(ui)).toContain(notify ? "attendees WILL be emailed" : "attendees will NOT be emailed");
        expect(confirmText(ui)).not.toContain(notify ? "will NOT" : "WILL be");
      }
    }
  });

  it("#C36 a denied dialog changes nothing and says denied — all four tools", async () => {
    for (const tool of WRITES) {
      const h = host();
      const e = await err(h.run(tool, { account: "work", ...ARGS[tool] }, uiCtx(false).ctx));
      expect(e?.code, tool).toBe("denied");
      expect(h.google.writes(), tool).toHaveLength(0);
    }
  });

  it("#C7 with no UI every calendar write is blocked before any HTTP call", async () => {
    for (const tool of WRITES) {
      const h = host();
      expect((await err(h.run(tool, { account: "work", ...ARGS[tool] }, NO_UI)))?.code).toBe("blocked");
      expect(h.google.calls).toHaveLength(0);
    }
  });

  it("#C37 respond: accepted/declined/tentative patch the user's own attendee row; 'maybe' fails before the dialog; an organiser without a self row gets calendar_error", async () => {
    for (const response of ["accepted", "declined", "tentative"]) {
      const h = host();
      await h.run("gcal_event_respond", { account: "work", eventId: "e1", response }, uiCtx(true).ctx);
      const body = h.google.writes()[0]?.body as { attendees: Array<{ email: string; responseStatus: string }> };
      expect(body.attendees.find((a) => a.email === ME)?.responseStatus).toBe(response);
      expect(body.attendees.find((a) => a.email === "pat@x.com")?.responseStatus).toBe("declined");
      expect(body.attendees).toHaveLength(3);
    }
    const h = host();
    const ui = uiCtx(true);
    expect((await err(h.run("gcal_event_respond", { account: "work", eventId: "e1", response: "maybe" }, ui.ctx)))?.code).toBe("invalid_params");
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(h.google.calls).toHaveLength(0);

    const org = host({ events: [meeting({ attendees: [{ email: "pat@x.com", responseStatus: "accepted" }] } as never)] });
    const ui2 = uiCtx(true);
    const e = await err(org.run("gcal_event_respond", { account: "work", eventId: "e1", response: "accepted" }, ui2.ctx));
    expect(e?.code).toBe("calendar_error");
    expect(ui2.confirm).not.toHaveBeenCalled();
    expect(org.google.writes()).toHaveLength(0);
  });

  it("#C38/#GC3 invalid create arguments are rejected before the dialog; 0 attendees and 1 000 attendees are accepted", async () => {
    const base = { account: "work", title: "T", start: "2026-05-12T12:00:00+02:00", end: "2026-05-12T13:00:00+02:00" };
    const bad: Array<Record<string, unknown>> = [
      { end: "2026-05-12T12:00:00+02:00" },
      { end: "2026-05-12T11:00:00+02:00" },
      { start: "2026-05-12", end: "2026-05-12" },
      { start: "2026-05-12", end: "2026-05-13T00:00:00Z" },
      { start: "noon" },
      { start: "2026-02-30", end: "2026-03-02" },
      { attendees: ["not-an-email"] },
      { attendees: ["a@b"] },
      { attendees: Array.from({ length: 1001 }, (_, i) => `u${i}@x.com`) },
      { title: "" },
      { timeZone: "Mars/Phobos", start: "2026-05-12T12:00:00+02:00" },
    ];
    for (const b of bad) {
      const h = host();
      const ui = uiCtx(true);
      expect((await err(h.run("gcal_event_create", { ...base, ...b }, ui.ctx)))?.code, JSON.stringify(b).slice(0, 80)).toBe("invalid_params");
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.calls).toHaveLength(0);
    }
    for (const n of [0, 1000]) {
      const h = host();
      const ui = uiCtx(true);
      const attendees = Array.from({ length: n }, (_, i) => `u${i}@x.com`);
      await h.run("gcal_event_create", { ...base, attendees }, ui.ctx);
      const body = h.google.writes()[0]?.body as { attendees?: unknown[] };
      expect(body.attendees?.length ?? 0).toBe(n);
      const text = confirmText(ui);
      if (n) {
        expect(text).toContain("+980 more (1000 total)");
        expect(text).not.toContain("u20@x.com");
        expect(text.length).toBeLessThan(1200);
      } else expect(text).toContain("Attendees: none");
    }
  });

  it("#C10 a 1 024-char title is cut in the dialog with its length, but created whole", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcal_event_create", { account: "work", ...ARGS.gcal_event_create, title: `${"t".repeat(1024)}` }, ui.ctx);
    expect(confirmText(ui)).toContain("(1024 chars)");
    expect((h.google.writes()[0]?.body as { summary: string } | undefined)?.summary).toHaveLength(1024);
  });

  it("#C39 a write tool on a Calendar level `read` account is refused (level_insufficient) — no dialog, no HTTP", async () => {
    for (const tool of WRITES) {
      const h = host({ account: { products: { calendar: "read" } } });
      const ui = uiCtx(true);
      const e = await err(h.run(tool, { account: "work", ...ARGS[tool] }, ui.ctx));
      expect(e?.code, tool).toBe("level_insufficient");
      expect(e?.message).toContain("Settings \u2192 Google accounts");
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.calls).toHaveLength(0);
    }
  });

  it("update/delete/respond dialogs show the CURRENT event (title, times, attendees) before anything is written", async () => {
    for (const tool of ["gcal_event_update", "gcal_event_delete", "gcal_event_respond"] as const) {
      const h = host();
      const ui = uiCtx(true);
      await h.run(tool, { account: "work", ...ARGS[tool] }, ui.ctx);
      const text = confirmText(ui);
      for (const part of ["Account: a@x.com", "Calendar: primary", "Event: Standup [e1]", "Start: 2026-05-10T09:00:00+02:00", "Attendees (3): boss@x.com, a@x.com, pat@x.com"]) expect(text, tool).toContain(part);
    }
  });

  it("update patches only the passed fields and keeps existing attendee rows; replacing the list is shown", async () => {
    const h = host();
    const ui = uiCtx(true);
    await h.run("gcal_event_update", { account: "work", eventId: "e1", location: "Room 9", attendees: ["pat@x.com", "new@x.com"] }, ui.ctx);
    const body = h.google.writes()[0]?.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["attendees", "location"]);
    expect(body.attendees).toEqual([{ email: "pat@x.com", displayName: "Pat", responseStatus: "declined" }, { email: "new@x.com" }]);
    expect(confirmText(ui)).toContain("Change location: Room 9");
    expect(confirmText(ui)).toContain("Change attendees (2): pat@x.com, new@x.com");
  });

  it("update with nothing to change → unchanged, no dialog, no write (scenario-gate C21)", async () => {
    for (const args of [{}, { title: "Standup" }, { start: "2026-05-10T07:00:00Z" }, { attendees: ["PAT@x.com", ME, "boss@x.com"] }]) {
      const h = host();
      const ui = uiCtx(true);
      const r = jsonOf<{ unchanged: boolean }>(await h.run("gcal_event_update", { account: "work", eventId: "e1", ...args }, ui.ctx));
      expect(r.unchanged).toBe(true);
      expect(ui.confirm).not.toHaveBeenCalled();
      expect(h.google.writes()).toHaveLength(0);
    }
  });

  it("delete removes the event; a 404 on the lookup stops before the dialog", async () => {
    const h = host();
    const r = jsonOf<{ deleted: boolean }>(await h.run("gcal_event_delete", { account: "work", eventId: "e1" }, uiCtx(true).ctx));
    expect(r.deleted).toBe(true);
    expect(h.store.has("e1")).toBe(false);
    const ui = uiCtx(true);
    expect((await err(h.run("gcal_event_delete", { account: "work", eventId: "e1" }, ui.ctx)))?.status).toBe(404);
    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it("#C22 a confirmed create that gets a 503 is NOT replayed — at most one event per confirmation", async () => {
    const h = host();
    h.google.on("POST", "/calendars/primary/events", [{ status: 503, json: { error: { message: "backend" } } }, { json: { id: "dup" } }]);
    const e = await err(h.run("gcal_event_create", { account: "work", ...ARGS.gcal_event_create }, uiCtx(true).ctx));
    expect(e?.status).toBe(503);
    expect(e?.code).toBe("calendar_error");
    expect(h.google.to("POST")).toHaveLength(1);
    expect(h.store.has("dup")).toBe(false);
  });

  it("a 429 on a confirmed create is retried once and creates exactly one event", async () => {
    const h = host();
    h.google.on("POST", "/calendars/primary/events", [{ status: 429, headers: { "retry-after": "1" } }, { json: { id: "created1" } }]);
    const r = jsonOf<{ created: boolean; id: string }>(await h.run("gcal_event_create", { account: "work", ...ARGS.gcal_event_create }, uiCtx(true).ctx));
    expect(r).toMatchObject({ created: true, id: "created1" });
    expect(h.google.to("POST")).toHaveLength(2);
  });

  it("#C13 a disabled Calendar API surfaces as api_disabled with the calendar service and the project", async () => {
    const h = host();
    h.google.on("GET", "/calendars/primary/events", googleError(403, "SERVICE_DISABLED", { service: "calendar-json.googleapis.com", consumer: "projects/123456789012" }));
    const e = await err(h.run("gcal_events", { account: "work", ...RANGE }));
    expect(e?.code).toBe("api_disabled");
    expect(e?.message).toContain("gcloud services enable calendar-json.googleapis.com --project 123456789012");
  });
});

describe("tool surface", () => {
  it("registers exactly the eight spec'd tools, account first and required", () => {
    const h = host();
    // the host registers every product's tools; this test pins the Calendar slice
    const gcalTools = h.tools.filter((t) => t.name.startsWith("gcal_"));
    const names = gcalTools.map((t) => t.name).sort();
    expect(names).toEqual([...WRITES, "gcal_calendars", "gcal_event_get", "gcal_events", "gcal_freebusy"].sort());
    expect(h.writes.filter((w) => w.startsWith("gcal_")).sort()).toEqual([...WRITES].sort());
    for (const t of gcalTools) {
      const p = t.parameters as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
      expect(Object.keys(p.properties)[0]).toBe("account");
      expect(p.required).toContain("account");
      expect(p.additionalProperties).toBe(false);
    }
  });
});
