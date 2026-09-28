/**
 * Minimal RFC 2822 / MIME builder (design D6): UTF-8 headers (RFC 2047
 * encoded-word), base64 bodies, optional multipart/mixed attachments, and the
 * base64url `raw` Gmail expects. Header values are CR/LF-stripped (no header
 * injection). See change: add-gmail-plugin.
 */
import { randomBytes } from "node:crypto";

export interface MimeAttachment {
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface MimeMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
  attachments?: MimeAttachment[];
}

const clean = (v: string): string => v.replace(/[\r\n]+/g, " ").trim();

/** RFC 2047 `=?UTF-8?B?…?=` when the value is not plain ASCII. */
function encodeHeaderWord(v: string): string {
  const c = clean(v);
  if (/^[\x20-\x7e]*$/.test(c)) return c;
  return `=?UTF-8?B?${Buffer.from(c, "utf8").toString("base64")}?=`;
}

const wrap76 = (b64: string): string => b64.replace(/.{1,76}/g, "$&\r\n").trimEnd();

function textPart(body: string): string {
  return [
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(body, "utf8").toString("base64")),
  ].join("\r\n");
}

function attachmentPart(a: MimeAttachment): string {
  // `"` and `\` are quoted-string specials: a trailing `\` would escape the closing quote.
  const name = encodeHeaderWord(a.filename).replace(/["\\]/g, "_");
  const type = /^[\w.+-]+\/[\w.+-]+$/.test(a.mimeType) ? a.mimeType : "application/octet-stream";
  return [
    `Content-Type: ${type}; name="${name}"`,
    `Content-Disposition: attachment; filename="${name}"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(a.data.toString("base64")),
  ].join("\r\n");
}

/** Build the RFC 2822 message text. */
export function buildMime(m: MimeMessage): string {
  const headers = [`To: ${m.to.map(clean).join(", ")}`];
  if (m.cc?.length) headers.push(`Cc: ${m.cc.map(clean).join(", ")}`);
  if (m.bcc?.length) headers.push(`Bcc: ${m.bcc.map(clean).join(", ")}`);
  headers.push(`Subject: ${encodeHeaderWord(m.subject)}`);
  if (m.inReplyTo) headers.push(`In-Reply-To: ${clean(m.inReplyTo)}`);
  if (m.references) headers.push(`References: ${clean(m.references)}`);
  headers.push("MIME-Version: 1.0");
  if (!m.attachments?.length) return `${headers.join("\r\n")}\r\n${textPart(m.body)}\r\n`;
  const boundary = `pi-gmail-${randomBytes(12).toString("hex")}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  const parts = [textPart(m.body), ...m.attachments.map(attachmentPart)];
  return `${headers.join("\r\n")}\r\n\r\n${parts.map((p) => `--${boundary}\r\n${p}\r\n`).join("")}--${boundary}--\r\n`;
}

/** Gmail `raw`: base64url of the RFC 2822 text. */
export function toRaw(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url");
}
