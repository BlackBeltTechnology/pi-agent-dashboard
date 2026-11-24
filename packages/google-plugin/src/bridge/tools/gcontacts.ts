/**
 * Google Contacts tools (`gcontacts_*`, People API; design D11; spec google-contacts-tools). `gcontacts_search`
 * (query passed verbatim — name, email or phone, no warm-up call; scenario-gate C22) and `gcontacts_get` (level read).
 * `gcontacts_create` / `gcontacts_update` (level write) are confirmed first; an update shows only the changed fields as
 * old → new, sends only those in `updatePersonFields`, and carries the contact's `etag` — the caller's (from
 * `gcontacts_get`) or else the one read for the dialog — so Google's 400 `FAILED_PRECONDITION` becomes
 * `revision_changed` (C15). There is deliberately no delete tool. See change: add-google-connect.
 */
import { optStr, type Params, reqStr } from "../params.js";
import { clip } from "../preview.js";
import { type Call, type ProductTools, Skip, type ToolOutput } from "../runtime.js";
import { GoogleToolError, invalidParams } from "../tool-error.js";

const CONTACT = /^(?:people\/)?(c[0-9]{1,40})$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const READ_MASK = "names,emailAddresses,phoneNumbers,organizations";
const SEARCH_PAGE = 30; // People API searchContacts maximum
const MAX_ETAG = 256;
const MAX_VALUES = 20;
const MAX_FIELD = 1024;
const NONE = "(none)";
const REMOVED = "(removed)";

interface Person {
  resourceName?: string;
  etag?: string;
  names?: Array<{ displayName?: string; givenName?: string; familyName?: string }>;
  emailAddresses?: Array<{ value?: string; type?: string }>;
  phoneNumbers?: Array<{ value?: string; type?: string }>;
  organizations?: Array<{ name?: string; title?: string }>;
}

/** The fields a caller may set; `undefined` = leave alone, `""` / `[]` = clear. */
interface Fields {
  givenName?: string;
  familyName?: string;
  emails?: string[];
  phones?: string[];
  organization?: string;
  jobTitle?: string;
}

// ───────────── argument parsing ─────────────

/** `people/c123` or `c123` → `people/c123` (own profile, other-contact names and anything else are rejected). */
function resourceName(p: Params): string {
  const id = CONTACT.exec(reqStr(p, "resourceName", 128).trim())?.[1];
  if (!id) throw invalidParams("`resourceName` must be a contact resource name like people/c123 (from gcontacts_search)");
  return `people/${id}`;
}

/** A text field that can be cleared: absent → untouched, `""` / null → cleared. */
function clearable(p: Params, name: string): string | undefined {
  const v = p[name];
  if (v === undefined) return undefined;
  if (v === null || v === "") return "";
  if (typeof v !== "string") throw invalidParams(`\`${name}\` must be a string`);
  if (v.length > MAX_FIELD) throw invalidParams(`\`${name}\` is longer than ${MAX_FIELD} characters`);
  return v.trim();
}

/** A list that replaces the stored one: absent → untouched, `[]` → cleared; entries are non-empty strings. */
function valueList(p: Params, name: string, valid?: (v: string) => boolean, what = "values"): string[] | undefined {
  const v = p[name];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > MAX_VALUES || v.some((x) => typeof x !== "string" || !x.trim() || x.length > MAX_FIELD)) {
    throw invalidParams(`\`${name}\` must be a list of up to ${MAX_VALUES} non-empty strings (an empty list clears it)`);
  }
  const out = (v as string[]).map((x) => x.trim());
  const bad = out.find((x) => valid && !valid(x));
  if (bad !== undefined) throw invalidParams(`\`${name}\`: "${clip(bad, 80)}" is not a valid ${what}`);
  return out;
}

function fields(p: Params): Fields {
  return {
    givenName: clearable(p, "givenName"),
    familyName: clearable(p, "familyName"),
    emails: valueList(p, "emails", (x) => EMAIL.test(x), "email address"),
    phones: valueList(p, "phones", (x) => /\d/.test(x), "phone number"),
    organization: clearable(p, "organization"),
    jobTitle: clearable(p, "jobTitle"),
  };
}

// ───────────── Person ↔ fields ─────────────

const current = (c: Person): Required<Fields> => ({
  givenName: c.names?.[0]?.givenName ?? "",
  familyName: c.names?.[0]?.familyName ?? "",
  emails: (c.emailAddresses ?? []).flatMap((e) => (e.value ? [e.value] : [])),
  phones: (c.phoneNumbers ?? []).flatMap((e) => (e.value ? [e.value] : [])),
  organization: c.organizations?.[0]?.name ?? "",
  jobTitle: c.organizations?.[0]?.title ?? "",
});

const LABEL: Record<keyof Fields, string> = {
  givenName: "given name",
  familyName: "family name",
  emails: "emails",
  phones: "phones",
  organization: "organization",
  jobTitle: "job title",
};
const FIELD_KEYS = Object.keys(LABEL) as Array<keyof Fields>;
const show = (v: string | string[]) => (Array.isArray(v) ? v.join(", ") : v);
const same = (a: string | string[], b: string | string[]) => show(a) === show(b);

/** `[key, old, new]` for every field that would really change. */
function diff(a: Fields, cur: Person): Array<[keyof Fields, string | string[], string | string[]]> {
  const now = current(cur);
  return FIELD_KEYS.flatMap((k) => (a[k] === undefined || same(a[k] as string, now[k]) ? [] : [[k, now[k], a[k] as string | string[]] as [keyof Fields, string | string[], string | string[]]]));
}

const changeLine = ([k, o, n]: [keyof Fields, string | string[], string | string[]]) =>
  `Change ${LABEL[k]}: ${clip(show(o) || NONE, 200)} \u2192 ${clip(show(n) || REMOVED, 200)}`;

/** Entries of `old` kept when their value stays (so types survive), new values appended as plain `{ value }`. */
const merge = (old: Array<{ value?: string }> | undefined, next: string[]) => next.map((value) => old?.find((o) => o.value === value) ?? { value });

/** The Person body + `updatePersonFields` mask for the changed fields only. */
function patchOf(a: Fields, cur: Person): { person: Person; mask: string[] } {
  const person: Person = {};
  const mask: string[] = [];
  if (a.givenName !== undefined || a.familyName !== undefined) {
    const now = current(cur);
    person.names = [{ givenName: a.givenName ?? now.givenName, familyName: a.familyName ?? now.familyName }];
    mask.push("names");
  }
  if (a.emails !== undefined) {
    person.emailAddresses = merge(cur.emailAddresses, a.emails);
    mask.push("emailAddresses");
  }
  if (a.phones !== undefined) {
    person.phoneNumbers = merge(cur.phoneNumbers, a.phones);
    mask.push("phoneNumbers");
  }
  if (a.organization !== undefined || a.jobTitle !== undefined) {
    const now = current(cur);
    const name = a.organization ?? now.organization;
    const title = a.jobTitle ?? now.jobTitle;
    person.organizations = name || title ? [{ ...(name ? { name } : {}), ...(title ? { title } : {}) }, ...(cur.organizations ?? []).slice(1)] : (cur.organizations ?? []).slice(1);
    mask.push("organizations");
  }
  return { person, mask };
}

const shape = (c: Person) => ({
  resourceName: c.resourceName,
  etag: c.etag,
  names: (c.names ?? []).flatMap((n) => (n.displayName ? [n.displayName] : [])),
  emails: (c.emailAddresses ?? []).flatMap((e) => (e.value ? [e.value] : [])),
  phones: (c.phoneNumbers ?? []).flatMap((e) => (e.value ? [e.value] : [])),
  organizations: (c.organizations ?? []).map((o) => ({ name: o.name ?? "", title: o.title ?? "" })),
});

const getContact = (call: Call, name: string) => call.api.request<Person>("GET", `/${name}`, { query: { personFields: READ_MASK } });
const nameOf = (c: Person) => c.names?.[0]?.displayName ?? c.emailAddresses?.[0]?.value ?? "(unnamed)";

const FIELD_PROPS = {
  givenName: { type: "string", description: "First name." },
  familyName: { type: "string", description: "Last name." },
  emails: { type: "array", items: { type: "string" }, maxItems: MAX_VALUES, description: "Email addresses." },
  phones: { type: "array", items: { type: "string" }, maxItems: MAX_VALUES, description: "Phone numbers." },
  organization: { type: "string", description: "Company / organization name." },
  jobTitle: { type: "string", description: "Job title." },
};

export const gcontacts: ProductTools = {
  product: "contacts",
  create(rt) {
    return [
      rt.define({
        name: "gcontacts_search",
        label: "search contacts",
        description:
          "Search the account's Google Contacts by name, email address or phone number (the query is passed to Google as typed). Returns resourceName, names, emails, phones and organizations. Requires Contacts level read.",
        properties: { query: { type: "string", minLength: 1, maxLength: 256, description: "Name, email address or phone number." } },
        required: ["query"],
        level: "read",
        parse: (p) => ({ query: reqStr(p, "query", 256) }),
        async run(a, call): Promise<ToolOutput> {
          const r = await call.api.request<{ results?: Array<{ person?: Person }> }>("GET", "/people:searchContacts", {
            query: { query: a.query, readMask: READ_MASK, pageSize: SEARCH_PAGE },
          });
          return { json: { contacts: (r.results ?? []).flatMap((x) => (x.person ? [shape(x.person)] : [])) } };
        },
      }),

      rt.define({
        name: "gcontacts_get",
        label: "read contact",
        description: "Read one Google Contact by resource name (people/c123): names, emails, phones, organizations and the etag to pass to gcontacts_update. Requires Contacts level read.",
        properties: { resourceName: { type: "string", minLength: 1, description: "Contact resource name, e.g. people/c123 (from gcontacts_search)." } },
        required: ["resourceName"],
        level: "read",
        parse: (p) => ({ name: resourceName(p) }),
        async run(a, call): Promise<ToolOutput> {
          return { json: shape(await getContact(call, a.name)) };
        },
      }),

      rt.define<Fields>({
        name: "gcontacts_create",
        label: "create contact",
        description: "Create a Google Contact (requires Contacts level write; the user confirms first). Give at least one of the fields.",
        properties: FIELD_PROPS,
        level: "write",
        write: true,
        parse(p) {
          const f = fields(p);
          if (FIELD_KEYS.every((k) => show(f[k] ?? "") === "")) throw invalidParams("give at least one of: givenName, familyName, emails, phones, organization, jobTitle");
          return f;
        },
        summary: (a) => FIELD_KEYS.flatMap((k) => (a[k] === undefined || show(a[k] as string) === "" ? [] : [`${LABEL[k][0]?.toUpperCase()}${LABEL[k].slice(1)}: ${clip(show(a[k] as string), 200)}`])),
        async run(a, call): Promise<ToolOutput> {
          const { person } = patchOf(a, {});
          const c = await call.api.request<Person>("POST", "/people:createContact", { query: { personFields: READ_MASK }, body: person });
          return { json: { created: true, ...shape(c) } };
        },
      }),

      rt.define<{ name: string; etag?: string; f: Fields }, Person>({
        name: "gcontacts_update",
        label: "update contact",
        description:
          "Change fields of a Google Contact (requires Contacts level write; the user confirms first). Only the fields you pass change; emails and phones replace the list; an empty string or list clears a field. Pass the etag from gcontacts_get: the update fails with revision_changed if the contact changed since. Omitted: guarded with the etag read when the confirmation is shown.",
        properties: {
          resourceName: { type: "string", minLength: 1, description: "Contact resource name, e.g. people/c123." },
          etag: { type: "string", minLength: 1, description: "etag from gcontacts_get." },
          ...FIELD_PROPS,
        },
        required: ["resourceName"],
        level: "write",
        write: true,
        parse(p) {
          const etag = optStr(p, "etag", MAX_ETAG);
          return { name: resourceName(p), ...(etag ? { etag } : {}), f: fields(p) };
        },
        async prepare(a, call) {
          const cur = await getContact(call, a.name);
          if (diff(a.f, cur).length === 0) return new Skip({ json: { unchanged: true, resourceName: a.name } });
          return cur;
        },
        summary: (a, cur) => [`Contact: ${clip(nameOf(cur), 200)} [${a.name}]`, ...diff(a.f, cur).map(changeLine), a.etag ? `Guarded by etag ${clip(a.etag, 80)}` : "Guarded by the etag read for this confirmation"],
        async run(a, call, cur): Promise<ToolOutput> {
          const changed = diff(a.f, cur).reduce<Fields>((acc, [k]) => ({ ...acc, [k]: a.f[k] }), {});
          const { person, mask } = patchOf(changed, cur);
          const etag = a.etag ?? cur.etag;
          try {
            const c = await call.api.request<Person>("PATCH", `/${a.name}:updateContact`, {
              query: { updatePersonFields: mask.join(","), personFields: READ_MASK },
              body: { ...person, ...(etag ? { etag } : {}) },
            });
            return { json: { updated: true, ...shape(c) } };
          } catch (e) {
            if (e instanceof GoogleToolError && e.status === 400 && e.reason === "FAILED_PRECONDITION") {
              throw new GoogleToolError("revision_changed", `the contact changed since etag ${clip(etag, 80)}; nothing was changed. Read it again with gcontacts_get and retry`, { status: 400, reason: e.reason });
            }
            throw e;
          }
        },
      }),
    ];
  },
};
