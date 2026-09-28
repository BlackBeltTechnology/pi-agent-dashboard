/**
 * Gmail pi tools (design D6). `gmail_accounts` takes no account; every other
 * tool REQUIRES `account` (alias or email — never an implicit default).
 *
 * - Reads (`gmail_search`/`gmail_get`/`gmail_labels`/`gmail_attachments`)
 *   return `details.untrusted = true`; HTML bodies carry
 *   `details.contentType: "text/html"` so the untrusted-content guard scans them.
 * - Writes (`gmail_draft`/`gmail_send`/`gmail_reply`/`gmail_modify`/
 *   `gmail_trash`) are confirmed via `ctx.ui.confirm` (account, recipients,
 *   subject, ≤500-char preview). No UI → blocked; dismissed / timed out /
 *   throwing confirm → denied.
 * - One lease per call (`LeaseClient`); the lease's tier is re-checked.
 * See change: add-gmail-plugin.
 */
import type { GoogleEndpoints } from "../shared/endpoints.js";
import type { LeaseReply } from "../shared/protocol.js";
import type { Op } from "../shared/scopes.js";
import { MAX_ATTACH_BYTES, readInsideCwd, saveInsideCwd } from "./attachments.js";
import { extractBody, GmailApi, type GmailMessage, header, listAttachments } from "./gmail-api.js";
import { GmailToolError, type LeaseClient } from "./lease-client.js";
import { buildMime, type MimeAttachment, toRaw } from "./mime.js";

export const READ_TOOLS = ["gmail_search", "gmail_get", "gmail_labels", "gmail_attachments"] as const;
export const WRITE_TOOLS = ["gmail_draft", "gmail_send", "gmail_reply", "gmail_modify", "gmail_trash"] as const;

const MAX_SEARCH_RESULTS = 50;
const PREVIEW_CHARS = 500;

export interface ToolContext {
  cwd?: string;
  hasUI?: boolean;
  ui?: { confirm(title: string, message: string, opts?: unknown): Promise<boolean> };
}

interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
}

export interface GmailToolDef {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
    ctx?: ToolContext,
  ): Promise<ToolResult>;
}

export interface GmailToolDeps {
  leases: LeaseClient;
  endpoints: GoogleEndpoints;
  fetchImpl?: typeof fetch;
}

const ACCOUNT_PROP = {
  type: "string",
  minLength: 1,
  description: "Account alias or email address. Required — list them with gmail_accounts.",
};
const RECIPIENTS = {
  type: "array",
  items: { type: "string", minLength: 3 },
  maxItems: 100,
};
const ATTACH_PROP = {
  type: "array",
  items: { type: "string", minLength: 1 },
  maxItems: 10,
  description: "Paths of files to attach, relative to the session working directory.",
};

const text = (t: string, details: Record<string, unknown>): ToolResult => ({ content: [{ type: "text", text: t }], details });

function str(v: unknown, name: string, required = true): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new GmailToolError("invalid_params", `invalid_params: \`${name}\` is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new GmailToolError("invalid_params", `invalid_params: \`${name}\` must be a string`);
  return v;
}

function strList(v: unknown, name: string, { min = 0, max = 100 } = {}): string[] {
  if (v === undefined || v === null) {
    if (min > 0) throw new GmailToolError("invalid_params", `invalid_params: \`${name}\` is required`);
    return [];
  }
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim()) || v.length < min || v.length > max) {
    throw new GmailToolError("invalid_params", `invalid_params: \`${name}\` must be a list of ${min}–${max} strings`);
  }
  return v as string[];
}

const ADDRESS_RE = /^(?:[^<>\r\n,]*<[^\s@<>,]+@[^\s@<>,]+>|[^\s@<>,]+@[^\s@<>,]+)$/;
function recipients(v: unknown, name: string, min: number): string[] {
  const list = strList(v, name, { min, max: 100 }).map((s) => s.trim());
  for (const r of list) {
    if (!ADDRESS_RE.test(r)) throw new GmailToolError("invalid_params", `invalid_params: \`${name}\` has an invalid address`);
  }
  return list;
}

/** Split an address-list header on commas OUTSIDE quotes / angle brackets (`"Doe, John" <j@x>`). */
export function splitAddresses(v: string | undefined): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  let angle = 0;
  for (const ch of v ?? "") {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === "<") angle++;
    else if (!quoted && ch === ">") angle = Math.max(0, angle - 1);
    if (ch === "," && !quoted && angle === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Bare lower-cased address of a header entry (`Name <a@b>` or `a@b`). */
function addressOf(entry: string): string {
  const m = /<([^<>]+)>\s*$/.exec(entry);
  return (m ? (m[1] as string) : entry).trim().toLowerCase();
}

function preview(body: string): string {
  return body.length > PREVIEW_CHARS ? `${body.slice(0, PREVIEW_CHARS)}…` : body;
}

/** Confirm-prompt body: account, recipients, subject, attachments, ≤500-char preview. */
function messageLines(m: { account: string; to: string[]; cc?: string[]; bcc?: string[]; subject: string; files: string[]; body: string }) {
  const opt = (label: string, list: string[] | undefined) => (list?.length ? [`${label}: ${list.join(", ")}`] : []);
  return [
    `Account: ${m.account}`,
    `To: ${m.to.join(", ")}`,
    ...opt("Cc", m.cc),
    ...opt("Bcc", m.bcc),
    `Subject: ${m.subject}`,
    ...opt("Attachments", m.files),
    "",
    preview(m.body),
  ];
}

async function confirmWrite(ctx: ToolContext | undefined, title: string, lines: string[]): Promise<void> {
  if (!ctx?.hasUI || !ctx.ui) {
    throw new GmailToolError("blocked", "blocked: this Gmail write needs user confirmation, but no UI is available");
  }
  let ok = false;
  try {
    ok = (await ctx.ui.confirm(title, lines.join("\n"))) === true;
  } catch {
    ok = false; // dismissed / timed out / transport error → deny
  }
  if (!ok) throw new GmailToolError("denied", "denied: the user did not approve this Gmail action");
}

export function createGmailTools(deps: GmailToolDeps): GmailToolDef[] {
  const api = (l: LeaseReply) => new GmailApi(deps.endpoints.gmail, l.accessToken, deps.fetchImpl);

  /** `account` present, or an error listing the connected accounts (no lease). */
  async function requireAccount(params: Record<string, unknown>): Promise<string> {
    const a = params.account;
    if (typeof a === "string" && a.trim()) return a.trim();
    let known = "none connected";
    try {
      const list = await deps.leases.accounts();
      if (list.length) known = list.map((x) => (x.alias ? `${x.alias} (${x.email})` : x.email)).join(", ");
    } catch {
      known = "unavailable";
    }
    throw new GmailToolError("account_required", `account_required: pass \`account\` (alias or email). Connected accounts: ${known}`);
  }

  const withAccount =
    (run: (account: string, p: Record<string, unknown>, ctx?: ToolContext) => Promise<ToolResult>) =>
    async (_id: string, params: Record<string, unknown>, _s?: AbortSignal, _u?: unknown, ctx?: ToolContext) => {
      const p = params ?? {};
      return run(await requireAccount(p), p, ctx);
    };

  async function loadAttachments(ctx: ToolContext | undefined, paths: string[]): Promise<MimeAttachment[]> {
    if (!paths.length) return [];
    if (!ctx?.cwd) throw new GmailToolError("path_refused", "path_refused: no session working directory");
    const cwd = ctx.cwd;
    return Promise.all(
      paths.map(async (p) => ({
        filename: p.split(/[\\/]/).pop() || "attachment",
        mimeType: "application/octet-stream",
        data: await readInsideCwd(cwd, p),
      })),
    );
  }

  function messageSummary(m: GmailMessage) {
    return {
      id: m.id,
      threadId: m.threadId,
      from: header(m.payload, "From") ?? "",
      subject: header(m.payload, "Subject") ?? "",
      date: header(m.payload, "Date") ?? "",
      snippet: m.snippet ?? "",
    };
  }

  function compose(kind: "draft" | "send"): GmailToolDef {
    const op: Op = kind;
    return {
      name: kind === "draft" ? "gmail_draft" : "gmail_send",
      label: kind === "draft" ? "Gmail draft" : "Gmail send",
      description:
        kind === "draft"
          ? "Create a Gmail draft in the given account (requires level draft). The user confirms first."
          : "Send an email from the given account (requires level send). The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          to: { ...RECIPIENTS, minItems: 1, description: "Recipients" },
          cc: { ...RECIPIENTS, description: "Cc recipients" },
          bcc: { ...RECIPIENTS, description: "Bcc recipients" },
          subject: { type: "string", maxLength: 998 },
          body: { type: "string", description: "Plain-text body" },
          attachments: ATTACH_PROP,
        },
        required: ["account", "to", "subject", "body"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p, ctx) => {
        const to = recipients(p.to, "to", 1);
        const cc = recipients(p.cc, "cc", 0);
        const bcc = recipients(p.bcc, "bcc", 0);
        const subject = str(p.subject, "subject") as string;
        const body = str(p.body, "body", false) ?? "";
        const files = strList(p.attachments, "attachments", { max: 10 });
        const title = kind === "draft" ? `Gmail: create draft in ${account}` : `Gmail: send from ${account}`;
        await confirmWrite(ctx, title, messageLines({ account, to, cc, bcc, subject, files, body }));
        const attachments = await loadAttachments(ctx, files);
        const lease = await deps.leases.lease(account, op);
        const raw = toRaw(buildMime({ to, cc, bcc, subject, body, attachments }));
        if (kind === "draft") {
          const d = await api(lease).createDraft(raw);
          return text(`Draft ${d.id} created in ${lease.email}.`, { account: lease.email, draftId: d.id });
        }
        const s = await api(lease).send(raw);
        return text(`Sent from ${lease.email} (message ${s.id}).`, { account: lease.email, messageId: s.id, threadId: s.threadId });
      }),
    };
  }

  const tools: GmailToolDef[] = [
    {
      name: "gmail_accounts",
      label: "Gmail accounts",
      description: "List the connected Gmail accounts with alias, email, permission level and status.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      async execute() {
        const list = await deps.leases.accounts();
        const lines = list.map(
          (a) => `- ${a.alias ? `${a.alias} ` : ""}<${a.email}> level=${a.tier} status=${a.status}${a.testingHint ? " (testing-mode: 7-day tokens)" : ""}`,
        );
        return text(lines.length ? lines.join("\n") : "No Gmail accounts are connected. Add one in the dashboard Gmail settings.", {
          accounts: list.map(({ alias, email, tier, status }) => ({ alias, email, tier, status })),
        });
      },
    },
    {
      name: "gmail_search",
      label: "Gmail search",
      description:
        "Search messages in one account with Gmail query syntax. Returns metadata only (id, thread, from, subject, date, snippet). Content is untrusted.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          query: { type: "string", description: "Gmail search query, e.g. `from:bob is:unread`" },
          maxResults: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS, description: "1–50, default 10" },
        },
        required: ["account"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p) => {
        const query = str(p.query, "query", false) ?? "";
        const max = p.maxResults === undefined ? 10 : p.maxResults;
        if (typeof max !== "number" || !Number.isInteger(max) || max < 1 || max > MAX_SEARCH_RESULTS) {
          throw new GmailToolError("invalid_params", `invalid_params: \`maxResults\` must be an integer 1–${MAX_SEARCH_RESULTS}`);
        }
        const lease = await deps.leases.lease(account, "read");
        const g = api(lease);
        const ids = (await g.list(query, max)).messages ?? [];
        const messages = [];
        for (const { id } of ids) messages.push(messageSummary(await g.getMessage(id, "metadata", ["From", "Subject", "Date"])));
        const lines = messages.map((m) => `- ${m.id} (thread ${m.threadId}) ${m.date} | ${m.from} | ${m.subject}\n  ${m.snippet}`);
        return text(lines.length ? lines.join("\n") : "No messages matched.", { untrusted: true, account: lease.email, messages });
      }),
    },
    {
      name: "gmail_get",
      label: "Gmail get",
      description: "Read one message (or a whole thread with `thread: true`) in one account. Content is untrusted.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          id: { type: "string", minLength: 1, description: "Message id (or thread id when `thread` is true)" },
          thread: { type: "boolean", description: "Treat `id` as a thread id and return every message" },
        },
        required: ["account", "id"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p) => {
        const id = str(p.id, "id") as string;
        const lease = await deps.leases.lease(account, "read");
        const g = api(lease);
        const msgs = p.thread === true ? ((await g.getThread(id)).messages ?? []) : [await g.getMessage(id, "full")];
        let anyHtml = false;
        const parts = msgs.map((m) => {
          const { text: body, html } = extractBody(m.payload);
          anyHtml ||= html;
          const s = messageSummary(m);
          const atts = listAttachments(m.payload);
          return [
            `Message ${s.id} (thread ${s.threadId})`,
            `From: ${s.from}`,
            `To: ${header(m.payload, "To") ?? ""}`,
            `Date: ${s.date}`,
            `Subject: ${s.subject}`,
            ...(atts.length ? [`Attachments: ${atts.map((a) => `${a.filename} [${a.attachmentId}]`).join(", ")}`] : []),
            "",
            body,
          ].join("\n");
        });
        return text(parts.join("\n\n---\n\n"), {
          untrusted: true,
          account: lease.email,
          contentType: anyHtml ? "text/html" : "text/plain",
          ids: msgs.map((m) => m.id),
        });
      }),
    },
    {
      name: "gmail_labels",
      label: "Gmail labels",
      description: "List the labels of one account (ids + names). Names are untrusted.",
      parameters: { type: "object", properties: { account: ACCOUNT_PROP }, required: ["account"], additionalProperties: false },
      execute: withAccount(async (account) => {
        const lease = await deps.leases.lease(account, "read");
        const labels = (await api(lease).labels()).labels ?? [];
        return text(labels.map((l) => `- ${l.id}: ${l.name}`).join("\n") || "No labels.", {
          untrusted: true,
          account: lease.email,
          labels,
        });
      }),
    },
    {
      name: "gmail_attachments",
      label: "Gmail attachments",
      description:
        "List a message's attachments, or save one (`attachmentId` + `saveAs`) inside the session working directory. Never overwrites. Content is untrusted.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          messageId: { type: "string", minLength: 1 },
          attachmentId: { type: "string", minLength: 1 },
          saveAs: { type: "string", minLength: 1, description: "Relative path inside the session cwd" },
        },
        required: ["account", "messageId"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p, ctx) => {
        const messageId = str(p.messageId, "messageId") as string;
        const attachmentId = str(p.attachmentId, "attachmentId", false);
        const saveAs = str(p.saveAs, "saveAs", false);
        if ((attachmentId === undefined) !== (saveAs === undefined)) {
          throw new GmailToolError("invalid_params", "invalid_params: pass both `attachmentId` and `saveAs` to save, or neither to list");
        }
        if (saveAs !== undefined && !ctx?.cwd) throw new GmailToolError("path_refused", "path_refused: no session working directory");
        const lease = await deps.leases.lease(account, "read");
        const g = api(lease);
        if (attachmentId === undefined || saveAs === undefined) {
          const atts = listAttachments((await g.getMessage(messageId, "full")).payload);
          return text(atts.map((a) => `- ${a.attachmentId}: ${a.filename} (${a.mimeType}, ${a.size} B)`).join("\n") || "No attachments.", {
            untrusted: true,
            account: lease.email,
            attachments: atts,
          });
        }
        const att = await g.attachment(messageId, attachmentId);
        const data = att.data ?? "";
        if ((att.size ?? 0) > MAX_ATTACH_BYTES || data.length > Math.ceil((MAX_ATTACH_BYTES * 4) / 3) + 4) {
          throw new GmailToolError("too_large", "too_large: attachment exceeds the 20 MiB save limit");
        }
        const written = await saveInsideCwd(ctx?.cwd as string, saveAs, Buffer.from(data, "base64url"));
        return text(`Saved attachment to ${written}.`, { untrusted: true, account: lease.email, path: written });
      }),
    },
    compose("draft"),
    compose("send"),
    {
      name: "gmail_reply",
      label: "Gmail reply",
      description: "Reply in-thread to a message (requires level send). The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          messageId: { type: "string", minLength: 1 },
          body: { type: "string" },
          replyAll: { type: "boolean" },
          attachments: ATTACH_PROP,
        },
        required: ["account", "messageId", "body"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p, ctx) => {
        const messageId = str(p.messageId, "messageId") as string;
        const body = str(p.body, "body", false) ?? "";
        const files = strList(p.attachments, "attachments", { max: 10 });
        const readLease = await deps.leases.lease(account, "read");
        const orig = await api(readLease).getMessage(messageId, "metadata", [
          "Message-ID",
          "References",
          "Subject",
          "From",
          "Reply-To",
          "To",
          "Cc",
        ]);
        const self = readLease.email.toLowerCase();
        const origId = header(orig.payload, "Message-ID");
        const replyTo = header(orig.payload, "Reply-To") ?? header(orig.payload, "From") ?? "";
        const to = [replyTo];
        const cc =
          p.replyAll === true
            ? [...splitAddresses(header(orig.payload, "To")), ...splitAddresses(header(orig.payload, "Cc"))].filter(
                // Exact address match — a substring test would drop `lisa@x.com` for `a@x.com`.
                (a) => addressOf(a) !== self && addressOf(a) !== addressOf(replyTo),
              )
            : [];
        const subj = header(orig.payload, "Subject") ?? "";
        const subject = /^re:/i.test(subj) ? subj : `Re: ${subj}`;
        const references = [header(orig.payload, "References"), origId].filter(Boolean).join(" ") || undefined;
        await confirmWrite(ctx, `Gmail: reply from ${account}`, messageLines({ account, to, cc, subject, files, body }));
        const attachments = await loadAttachments(ctx, files);
        // Fresh send lease AFTER the confirm: a level lowered while the prompt
        // was open must refuse, and the token must not have aged out.
        const lease = await deps.leases.lease(account, "send");
        const raw = toRaw(buildMime({ to, cc, subject, body, inReplyTo: origId, references, attachments }));
        const s = await api(lease).send(raw, orig.threadId);
        return text(`Replied from ${lease.email} (message ${s.id}, thread ${s.threadId}).`, {
          account: lease.email,
          messageId: s.id,
          threadId: s.threadId,
        });
      }),
    },
    {
      name: "gmail_modify",
      label: "Gmail modify labels",
      description:
        "Add/remove label ids on messages (e.g. remove INBOX to archive, add STARRED) — requires level send. The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          ids: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 100 },
          addLabels: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 20 },
          removeLabels: { type: "array", items: { type: "string", minLength: 1 }, maxItems: 20 },
        },
        required: ["account", "ids"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p, ctx) => {
        const ids = strList(p.ids, "ids", { min: 1, max: 100 });
        const add = strList(p.addLabels, "addLabels", { max: 20 });
        const remove = strList(p.removeLabels, "removeLabels", { max: 20 });
        if (!add.length && !remove.length) {
          throw new GmailToolError("invalid_params", "invalid_params: pass `addLabels` and/or `removeLabels`");
        }
        await confirmWrite(ctx, `Gmail: change labels in ${account}`, [
          `Account: ${account}`,
          `Messages: ${ids.length}`,
          ...(add.length ? [`Add: ${add.join(", ")}`] : []),
          ...(remove.length ? [`Remove: ${remove.join(", ")}`] : []),
        ]);
        const lease = await deps.leases.lease(account, "modify");
        await api(lease).modify(ids, add, remove);
        return text(`Updated labels on ${ids.length} message(s) in ${lease.email}.`, { account: lease.email, ids });
      }),
    },
    {
      name: "gmail_trash",
      label: "Gmail trash",
      description: "Move messages to Trash (requires level send). The user confirms first.",
      parameters: {
        type: "object",
        properties: {
          account: ACCOUNT_PROP,
          ids: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 100 },
        },
        required: ["account", "ids"],
        additionalProperties: false,
      },
      execute: withAccount(async (account, p, ctx) => {
        const ids = strList(p.ids, "ids", { min: 1, max: 100 });
        await confirmWrite(ctx, `Gmail: move to Trash in ${account}`, [`Account: ${account}`, `Messages: ${ids.length}`]);
        const lease = await deps.leases.lease(account, "trash");
        const g = api(lease);
        for (const id of ids) await g.trash(id);
        return text(`Moved ${ids.length} message(s) to Trash in ${lease.email}.`, { account: lease.email, ids });
      }),
    },
  ];
  return tools;
}
