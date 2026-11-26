/**
 * Google API error mapping shared by every product's tools (design D11). A 403 is classified from the
 * machine-readable `reason` ONLY (`SERVICE_DISABLED` / `accessNotConfigured` → `api_disabled`,
 * `ACCESS_TOKEN_SCOPE_INSUFFICIENT` / `insufficientPermissions` → `scope_insufficient`); the human message of
 * a 403 never decides the code. The body is untrusted: every field is type-guarded, a throw degrades to the
 * generic `<product>_error`, and only a numeric `projects/<digits>` consumer, a `*.googleapis.com` service and
 * sanitized, length-bounded text reach the message. See change: add-google-connect.
 */
import type { Product } from "./products.js";

interface ServiceInfo {
  label: string;
  /** Generic error code (scenario-gate C4). */
  error: string;
  /** Google service names (`metadata.service`); the first is the one named in the enable command. */
  services: readonly string[];
}

export const SERVICES: Readonly<Record<Product, ServiceInfo>> = {
  gmail: { label: "Gmail", error: "gmail_error", services: ["gmail.googleapis.com"] },
  calendar: { label: "Google Calendar", error: "calendar_error", services: ["calendar-json.googleapis.com", "calendar.googleapis.com"] },
  drive: { label: "Google Drive", error: "drive_error", services: ["drive.googleapis.com"] },
  docs: { label: "Google Docs", error: "docs_error", services: ["docs.googleapis.com"] },
  sheets: { label: "Google Sheets", error: "sheets_error", services: ["sheets.googleapis.com"] },
  slides: { label: "Google Slides", error: "slides_error", services: ["slides.googleapis.com"] },
  tasks: { label: "Google Tasks", error: "tasks_error", services: ["tasks.googleapis.com"] },
  contacts: { label: "Google Contacts", error: "contacts_error", services: ["people.googleapis.com"] },
};

export interface MappedError {
  code: string;
  message: string;
  /** Google's machine reason / status string (sanitized), when the body had one. */
  reason?: string;
}

const DISABLED = new Set(["SERVICE_DISABLED", "accessNotConfigured"]);
const SCOPE = new Set(["ACCESS_TOKEN_SCOPE_INSUFFICIENT", "insufficientPermissions"]);
const SERVICE_NAME = /^[a-z0-9-]+\.googleapis\.com$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Control / bidi characters out, whitespace collapsed, bounded. */
export function sanitize(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : undefined;
}

function parseBody(text: string): { err?: Record<string, unknown>; infos: Record<string, unknown>[]; legacy: string[] } {
  try {
    const body: unknown = JSON.parse(text);
    const err = isObj(body) && isObj(body.error) ? body.error : undefined;
    if (!err) return { infos: [], legacy: [] };
    const infos = (Array.isArray(err.details) ? err.details : []).filter(
      (d): d is Record<string, unknown> =>
        isObj(d) && typeof d["@type"] === "string" && d["@type"].endsWith("google.rpc.ErrorInfo") && typeof d.reason === "string",
    );
    const legacy = (Array.isArray(err.errors) ? err.errors : [])
      .map((e) => (isObj(e) && typeof e.reason === "string" ? e.reason : undefined))
      .filter((r): r is string => r !== undefined);
    return { err, infos, legacy };
  } catch {
    return { infos: [], legacy: [] };
  }
}

/** Map a non-OK Google response (status + body text) of `product`'s API to a tool error code and message. */
export function mapGoogleError(product: Product, status: number, bodyText: string, needLevel?: string): MappedError {
  const svc = SERVICES[product];
  const { err, infos, legacy } = parseBody(bodyText);
  if (status === 403) {
    const meta = (i: Record<string, unknown>) => (isObj(i.metadata) ? i.metadata : {});
    const forThisProduct = (i: Record<string, unknown>) => {
      const s = meta(i).service;
      return typeof s !== "string" || svc.services.includes(s);
    };
    const disabled = infos.find((i) => DISABLED.has(i.reason as string) && forThisProduct(i));
    if (disabled || legacy.some((r) => DISABLED.has(r))) {
      const named = disabled ? meta(disabled).service : undefined;
      const service = typeof named === "string" && SERVICE_NAME.test(named) ? named : (svc.services[0] as string);
      const consumer = disabled ? meta(disabled).consumer : undefined;
      const n = typeof consumer === "string" ? /^projects\/(\d{1,20})$/.exec(consumer)?.[1] : undefined;
      const where = n ? `Google Cloud project ${n}` : "the dashboard's Google Cloud project";
      const cmd = `gcloud services enable ${service} --project ${n ?? "YOUR_PROJECT_ID"}`;
      return {
        code: "api_disabled",
        message: `api_disabled: the ${svc.label} API (${service}) is disabled in ${where}. Enable it: ${cmd} (or APIs & Services \u2192 Library \u2192 ${svc.label} API \u2192 Enable), then retry in a minute.`,
        reason: "SERVICE_DISABLED",
      };
    }
    if (infos.some((i) => SCOPE.has(i.reason as string)) || legacy.some((r) => SCOPE.has(r))) {
      const lvl = needLevel ? ` (level "${needLevel}")` : "";
      return {
        code: "scope_insufficient",
        message: `scope_insufficient: the account's Google grant lacks the permission this ${svc.label} tool needs${lvl}; set the ${svc.label} level for this account in Settings \u2192 Google accounts and sign in again.`,
        reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT",
      };
    }
  }
  const reason = sanitize(infos[0]?.reason ?? legacy[0] ?? err?.status, 80);
  const detail = sanitize(err?.message, 200);
  const parts = [`HTTP ${status}`, reason, detail].filter(Boolean).join(": ");
  const out: MappedError = { code: svc.error, message: `${svc.error}: ${svc.label} returned ${parts}` };
  if (reason) out.reason = reason;
  return out;
}
