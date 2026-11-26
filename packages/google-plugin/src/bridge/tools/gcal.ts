/**
 * Google Calendar tools (`gcal_*`, design D11; spec google-calendar-tools). Reads need Calendar at level
 * `read`; every write needs `write`, is confirmed first (account, calendar, title, start, end, attendees,
 * whether attendees are emailed) and sends NO invitation emails unless the call passes `notify: true`
 * (`sendUpdates=none` / `all`). 5xx on PATCH/POST is never replayed (scenario-gate C2).
 * See change: add-google-connect.
 */

import { pageSize } from "../paging.js";
import { oneOf, optBool, optInt, optStr, type Params, reqStr, strList } from "../params.js";
import { clip, listed } from "../preview.js";
import { type Call, type ProductTools, Skip, type ToolOutput } from "../runtime.js";
import { GoogleToolError, invalidParams } from "../tool-error.js";

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const MAX_ATTENDEES = 1000;
const RESPONSES = ["accepted", "declined", "tentative"] as const;
const enc = encodeURIComponent;

interface GEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  recurringEventId?: string;
  start?: When;
  end?: When;
  organizer?: { email?: string; self?: boolean };
  attendees?: GAttendee[];
}
interface GAttendee {
  email?: string;
  displayName?: string;
  responseStatus?: string;
  self?: boolean;
  organizer?: boolean;
  optional?: boolean;
  resource?: boolean;
}
type When = { date: string; dateTime?: undefined; timeZone?: string } | { dateTime: string; date?: undefined; timeZone?: string };

// ───────────── argument parsing ─────────────

const calendarId = (p: Params) => optStr(p, "calendarId", 1024) ?? "primary";

/** A range bound: RFC 3339 WITH an offset (`2026-03-29T00:00:00+01:00` / `…Z`). */
function instant(p: Params, name: string): string {
  const v = reqStr(p, name, 64);
  if (!RFC3339.test(v) || Number.isNaN(Date.parse(v))) throw invalidParams(`\`${name}\` must be an RFC 3339 timestamp with a UTC offset, e.g. 2026-03-29T00:00:00+01:00`);
  return v;
}

function range(p: Params): { timeMin: string; timeMax: string } {
  const timeMin = instant(p, "timeMin");
  const timeMax = instant(p, "timeMax");
  if (Date.parse(timeMax) <= Date.parse(timeMin)) throw invalidParams("`timeMax` must be after `timeMin`");
  return { timeMin, timeMax };
}

function validZone(tz: string | undefined): string | undefined {
  if (tz === undefined) return undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    throw invalidParams("`timeZone` must be an IANA time zone name, e.g. Europe/Budapest");
  }
}

/** A whole day (`YYYY-MM-DD` → `{date}`) or an RFC 3339 instant with offset (→ `{dateTime}`). */
function when(p: Params, name: string, timeZone: string | undefined): When {
  const v = reqStr(p, name, 64);
  if (DATE.test(v)) {
    if (new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) !== v) throw invalidParams(`\`${name}\` is not a valid date`);
    return { date: v };
  }
  if (!RFC3339.test(v) || Number.isNaN(Date.parse(v))) {
    throw invalidParams(`\`${name}\` must be a date (YYYY-MM-DD) or an RFC 3339 timestamp with a UTC offset`);
  }
  return { dateTime: v, ...(timeZone ? { timeZone } : {}) };
}

const whenMs = (w: When): number => Date.parse(w.date !== undefined ? `${w.date}T00:00:00Z` : (w.dateTime as string));

function orderedPair(start: When, end: When): void {
  if ((start.date === undefined) !== (end.date === undefined)) throw invalidParams("`start` and `end` must both be dates or both be timestamps");
  if (whenMs(end) <= whenMs(start)) throw invalidParams("`end` must be after `start`");
}

function emails(p: Params): string[] | undefined {
  if (p.attendees === undefined || p.attendees === null) return undefined;
  const list = strList(p, "attendees", { max: MAX_ATTENDEES }).map((s) => s.trim());
  for (const e of list) if (e.length > 254 || !EMAIL.test(e)) throw invalidParams("`attendees` has an invalid email address");
  return list;
}

const sendUpdates = (notify: boolean | undefined) => (notify ? "all" : "none");
const notifyLine = (notify: boolean | undefined) =>
  notify ? "Invitations: attendees WILL be emailed" : "Invitations: attendees will NOT be emailed";

// ───────────── result shaping ─────────────

function shape(e: GEvent, detail = false) {
  return {
    id: e.id,
    title: e.summary,
    status: e.status,
    start: e.start,
    end: e.end,
    location: e.location,
    organizer: e.organizer?.email,
    attendees: e.attendees?.map((a) => ({
      email: a.email,
      name: a.displayName,
      responseStatus: a.responseStatus,
      ...(a.self ? { self: true } : {}),
      ...(a.organizer ? { organizer: true } : {}),
      ...(a.optional ? { optional: true } : {}),
      ...(a.resource ? { resource: true } : {}),
    })),
    recurringEventId: e.recurringEventId,
    link: e.htmlLink,
    ...(detail && e.description ? { description: e.description.length > 5000 ? `${e.description.slice(0, 5000)}\u2026` : e.description } : {}),
  };
}

const whenText = (w: When | undefined): string => (w ? (w.date ?? `${w.dateTime}${w.timeZone ? ` (${w.timeZone})` : ""}`) : "?");

/** Current event as shown in update/delete/respond dialogs. */
function eventLines(cal: string, e: GEvent): string[] {
  const att = (e.attendees ?? []).map((a) => a.email ?? "?");
  return [
    `Calendar: ${clip(cal, 120)}`,
    `Event: ${clip(e.summary ?? "(no title)")} [${clip(e.id ?? "", 120)}]`,
    `Start: ${whenText(e.start)}`,
    `End: ${whenText(e.end)}`,
    att.length ? `Attendees (${att.length}): ${listed(att)}` : "Attendees: none",
  ];
}

const getEvent = (call: Call, cal: string, id: string) => call.api.request<GEvent>("GET", `/calendars/${enc(cal)}/events/${enc(id)}`);

const ID_PROP = { type: "string", minLength: 1, description: "Event id (from gcal_events)." };
const CAL_PROP = { type: "string", description: 'Calendar id; default "primary" (list them with gcal_calendars).' };
const NOTIFY_PROP = { type: "boolean", description: "Email the attendees about this change. Default false: nobody is emailed." };
const TZ_PROP = { type: "string", description: "IANA time zone for timestamps without a zone (e.g. Europe/Budapest)." };
const TIME_PROPS = {
  timeMin: { type: "string", description: "Range start, RFC 3339 with UTC offset (inclusive)." },
  timeMax: { type: "string", description: "Range end, RFC 3339 with UTC offset (exclusive)." },
};

export const gcal: ProductTools = {
  product: "calendar",
  create(rt) {
    return [
      rt.define({
        name: "gcal_calendars",
        label: "Calendar list",
        description: "List the calendars of a Google account (id, name, access role, time zone). Requires Calendar level read.",
        properties: { pageToken: { type: "string" } },
        level: "read",
        parse: (p) => ({ pageToken: optStr(p, "pageToken", 2048) }),
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ items?: Array<{ id?: string; summary?: string; summaryOverride?: string; accessRole?: string; timeZone?: string; primary?: boolean }>; nextPageToken?: string }>(
            "GET",
            "/users/me/calendarList",
            { query: { maxResults: pageSize(undefined), pageToken: a.pageToken } },
          );
          const calendars = (r.items ?? []).map((c) => ({ id: c.id, name: c.summaryOverride ?? c.summary, accessRole: c.accessRole, tz: c.timeZone, ...(c.primary ? { primary: true } : {}) }));
          return { json: { calendars, ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) } };
        },
      }),

      rt.define({
        name: "gcal_events",
        label: "Calendar events",
        description:
          "List the events of a calendar in a time range (recurring events expanded, ordered by start), optionally filtered by text. Times are RFC 3339 with a UTC offset. Requires Calendar level read.",
        properties: { calendarId: CAL_PROP, ...TIME_PROPS, q: { type: "string", description: "Free-text filter." }, maxResults: { type: "integer", minimum: 1, maximum: 50 }, pageToken: { type: "string" } },
        required: ["timeMin", "timeMax"],
        level: "read",
        parse: (p) => ({ cal: calendarId(p), ...range(p), q: optStr(p, "q", 1000), max: optInt(p, "maxResults", { min: 1, max: 50 }), pageToken: optStr(p, "pageToken", 2048) }),
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ items?: GEvent[]; timeZone?: string; nextPageToken?: string }>("GET", `/calendars/${enc(a.cal)}/events`, {
            query: { singleEvents: true, orderBy: "startTime", timeMin: a.timeMin, timeMax: a.timeMax, q: a.q, maxResults: pageSize(a.max), pageToken: a.pageToken },
          });
          return { json: { calendar: a.cal, timeZone: r.timeZone, events: (r.items ?? []).map((e) => shape(e)), ...(r.nextPageToken ? { nextPageToken: r.nextPageToken } : {}) } };
        },
      }),

      rt.define({
        name: "gcal_event_get",
        label: "Calendar event",
        description: "Get one calendar event with description and attendees. Requires Calendar level read.",
        properties: { calendarId: CAL_PROP, eventId: ID_PROP },
        required: ["eventId"],
        level: "read",
        parse: (p) => ({ cal: calendarId(p), id: reqStr(p, "eventId", 1024) }),
        async run(a, call): Promise<ToolOutput> {
          return { json: shape(await getEvent(call, a.cal, a.id), true) };
        },
      }),

      rt.define({
        name: "gcal_freebusy",
        label: "Calendar free/busy",
        description: "Busy intervals of one or more calendars in a time range. A calendar Google could not read is reported with its error, not as empty. Requires Calendar level read.",
        properties: { calendarIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 50, description: 'Default ["primary"].' }, ...TIME_PROPS },
        required: ["timeMin", "timeMax"],
        level: "read",
        parse(p) {
          const ids = p.calendarIds === undefined ? ["primary"] : strList(p, "calendarIds", { min: 1, max: 50 });
          return { ids, ...range(p) };
        },
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: Array<{ reason?: string }> }> }>("POST", "/freeBusy", {
            body: { timeMin: a.timeMin, timeMax: a.timeMax, items: a.ids.map((id) => ({ id })) },
          });
          const calendars = a.ids.map((id) => {
            const c = r.calendars?.[id];
            const errors = (c?.errors ?? []).map((e) => e.reason ?? "error");
            return { id, busy: c?.busy ?? [], ...(errors.length ? { errors } : {}), ...(c ? {} : { errors: ["no_data"] }) };
          });
          return { json: { timeMin: a.timeMin, timeMax: a.timeMax, calendars } };
        },
      }),

      rt.define({
        name: "gcal_event_create",
        label: "create event",
        description:
          "Create a calendar event (requires Calendar level write; the user confirms first). start/end are a date (all-day) or an RFC 3339 timestamp with UTC offset. Attendees are NOT emailed unless notify is true.",
        properties: {
          calendarId: CAL_PROP,
          title: { type: "string", minLength: 1, maxLength: 1024 },
          start: { type: "string", description: "YYYY-MM-DD or RFC 3339 with UTC offset" },
          end: { type: "string", description: "YYYY-MM-DD (exclusive) or RFC 3339 with UTC offset" },
          timeZone: TZ_PROP,
          location: { type: "string" },
          description: { type: "string" },
          attendees: { type: "array", items: { type: "string", minLength: 3 }, maxItems: MAX_ATTENDEES, description: "Attendee email addresses" },
          notify: NOTIFY_PROP,
        },
        required: ["title", "start", "end"],
        level: "write",
        write: true,
        parse(p) {
          const tz = validZone(optStr(p, "timeZone", 100));
          const start = when(p, "start", tz);
          const end = when(p, "end", tz);
          orderedPair(start, end);
          return { cal: calendarId(p), title: reqStr(p, "title", 1024), start, end, location: optStr(p, "location", 1024), description: optStr(p, "description", 8192), attendees: emails(p) ?? [], notify: optBool(p, "notify") };
        },
        summary: (a) => [
          `Calendar: ${clip(a.cal, 120)}`,
          `Title: ${clip(a.title)}`,
          `Start: ${whenText(a.start)}`,
          `End: ${whenText(a.end)}`,
          ...(a.location ? [`Location: ${clip(a.location, 200)}`] : []),
          a.attendees.length ? `Attendees (${a.attendees.length}): ${listed(a.attendees)}` : "Attendees: none",
          notifyLine(a.notify),
        ],
        async run(a, call): Promise<ToolOutput> {
          const e = await call.api.request<GEvent>("POST", `/calendars/${enc(a.cal)}/events`, {
            query: { sendUpdates: sendUpdates(a.notify) },
            body: {
              summary: a.title,
              start: a.start,
              end: a.end,
              ...(a.location ? { location: a.location } : {}),
              ...(a.description ? { description: a.description } : {}),
              ...(a.attendees.length ? { attendees: a.attendees.map((email) => ({ email })) } : {}),
            },
          });
          return { json: { created: true, ...shape(e) } };
        },
      }),

      rt.define<{ cal: string; id: string; title?: string; start?: When; end?: When; location?: string; description?: string; attendees?: string[]; notify?: boolean }, GEvent>({
        name: "gcal_event_update",
        label: "update event",
        description:
          "Change fields of a calendar event (requires Calendar level write; the user confirms first). Only the fields you pass change; `attendees` replaces the list. Attendees are NOT emailed unless notify is true. Nothing to change → unchanged.",
        properties: {
          calendarId: CAL_PROP,
          eventId: ID_PROP,
          title: { type: "string", minLength: 1, maxLength: 1024 },
          start: { type: "string" },
          end: { type: "string" },
          timeZone: TZ_PROP,
          location: { type: "string" },
          description: { type: "string" },
          attendees: { type: "array", items: { type: "string", minLength: 3 }, maxItems: MAX_ATTENDEES },
          notify: NOTIFY_PROP,
        },
        required: ["eventId"],
        level: "write",
        write: true,
        parse(p) {
          const tz = validZone(optStr(p, "timeZone", 100));
          const start = p.start === undefined ? undefined : when(p, "start", tz);
          const end = p.end === undefined ? undefined : when(p, "end", tz);
          if (start && end) orderedPair(start, end);
          return {
            cal: calendarId(p),
            id: reqStr(p, "eventId", 1024),
            title: optStr(p, "title", 1024),
            start,
            end,
            location: optStr(p, "location", 1024),
            description: optStr(p, "description", 8192),
            attendees: emails(p),
            notify: optBool(p, "notify"),
          };
        },
        async prepare(a, call) {
          const cur = await getEvent(call, a.cal, a.id);
          if (changes(a, cur).length === 0) return new Skip({ json: { unchanged: true, eventId: a.id } });
          return cur;
        },
        summary: (a, cur) => [...eventLines(a.cal, cur), ...changes(a, cur).map((c) => `Change ${c}`), notifyLine(a.notify)],
        async run(a, call, cur): Promise<ToolOutput> {
          const attendees = a.attendees?.map((email) => cur.attendees?.find((x) => x.email?.toLowerCase() === email.toLowerCase()) ?? { email });
          const e = await call.api.request<GEvent>("PATCH", `/calendars/${enc(a.cal)}/events/${enc(a.id)}`, {
            query: { sendUpdates: sendUpdates(a.notify) },
            body: {
              ...(a.title !== undefined ? { summary: a.title } : {}),
              ...(a.start ? { start: a.start } : {}),
              ...(a.end ? { end: a.end } : {}),
              ...(a.location !== undefined ? { location: a.location } : {}),
              ...(a.description !== undefined ? { description: a.description } : {}),
              ...(attendees ? { attendees } : {}),
            },
          });
          return { json: { updated: true, ...shape(e) } };
        },
      }),

      rt.define<{ cal: string; id: string; notify?: boolean }, GEvent>({
        name: "gcal_event_delete",
        label: "delete event",
        description: "Delete a calendar event (requires Calendar level write; the user confirms first, seeing the event). Attendees are NOT emailed unless notify is true.",
        properties: { calendarId: CAL_PROP, eventId: ID_PROP, notify: NOTIFY_PROP },
        required: ["eventId"],
        level: "write",
        write: true,
        parse: (p) => ({ cal: calendarId(p), id: reqStr(p, "eventId", 1024), notify: optBool(p, "notify") }),
        prepare: (a, call) => getEvent(call, a.cal, a.id),
        summary: (a, cur) => [...eventLines(a.cal, cur), "Action: DELETE this event", notifyLine(a.notify)],
        async run(a, call): Promise<ToolOutput> {
          await call.api.request("DELETE", `/calendars/${enc(a.cal)}/events/${enc(a.id)}`, { query: { sendUpdates: sendUpdates(a.notify) } });
          return { json: { deleted: true, eventId: a.id } };
        },
      }),

      rt.define<{ cal: string; id: string; response: (typeof RESPONSES)[number]; notify?: boolean }, GEvent>({
        name: "gcal_event_respond",
        label: "respond to event",
        description: "Answer an invitation: accepted, declined or tentative (requires Calendar level write; the user confirms first). The organiser is emailed only when notify is true.",
        properties: { calendarId: CAL_PROP, eventId: ID_PROP, response: { type: "string", enum: [...RESPONSES] }, notify: NOTIFY_PROP },
        required: ["eventId", "response"],
        level: "write",
        write: true,
        parse: (p) => ({ cal: calendarId(p), id: reqStr(p, "eventId", 1024), response: oneOf(p, "response", RESPONSES), notify: optBool(p, "notify") }),
        async prepare(a, call) {
          const cur = await getEvent(call, a.cal, a.id);
          if (!cur.attendees?.some((x) => x.self)) {
            throw new GoogleToolError("calendar_error", "calendar_error: you are not an invited attendee of this event (an organiser without an attendee entry has no response to give)");
          }
          return cur;
        },
        summary: (a, cur) => [...eventLines(a.cal, cur), `Response: ${a.response}`, notifyLine(a.notify)],
        async run(a, call, cur): Promise<ToolOutput> {
          const e = await call.api.request<GEvent>("PATCH", `/calendars/${enc(a.cal)}/events/${enc(a.id)}`, {
            query: { sendUpdates: sendUpdates(a.notify) },
            body: { attendees: (cur.attendees ?? []).map((x) => (x.self ? { ...x, responseStatus: a.response } : x)) },
          });
          return { json: { responded: a.response, ...shape(e) } };
        },
      }),
    ];
  },
};

/** The fields of an update that differ from the current event, as dialog text. */
function changes(
  a: { title?: string; start?: When; end?: When; location?: string; description?: string; attendees?: string[] },
  cur: GEvent,
): string[] {
  const out: string[] = [];
  if (a.title !== undefined && a.title !== cur.summary) out.push(`title: ${clip(a.title)}`);
  if (a.start && !sameWhen(a.start, cur.start)) out.push(`start: ${whenText(a.start)}`);
  if (a.end && !sameWhen(a.end, cur.end)) out.push(`end: ${whenText(a.end)}`);
  if (a.location !== undefined && a.location !== (cur.location ?? "")) out.push(`location: ${clip(a.location, 200)}`);
  if (a.description !== undefined && a.description !== (cur.description ?? "")) out.push(`description: ${clip(a.description)}`);
  if (a.attendees) {
    const have = new Set((cur.attendees ?? []).filter((x) => !x.self || x.email).map((x) => (x.email ?? "").toLowerCase()));
    const want = new Set(a.attendees.map((x) => x.toLowerCase()));
    if (have.size !== want.size || [...want].some((x) => !have.has(x))) out.push(`attendees (${a.attendees.length}): ${listed(a.attendees)}`);
  }
  return out;
}

function sameWhen(a: When, b: When | undefined): boolean {
  if (!b) return false;
  if (a.date !== undefined || b.date !== undefined) return a.date === b.date;
  return Date.parse(a.dateTime as string) === Date.parse(b.dateTime as string);
}
