/**
 * Validate an uploaded `client_secret_*.json`. Accepts a Desktop (`installed`) OR a Web
 * (`web`) client — never both (scenario-gate A4). Error codes are the gmail validator's
 * (`not_json`, `not_installed` = neither block, `bad_client_id`, `missing_secret`) plus
 * `ambiguous_client` for a JSON carrying both blocks. Pure. See change: add-google-connect.
 */
import { PROJECT_ID_RE } from "./setup.js";

export type ClientType = "installed" | "web";

interface ParsedClient {
  type: ClientType;
  clientId: string;
  clientSecret: string;
  projectId?: string;
}

type ClientJsonError = "not_json" | "not_installed" | "ambiguous_client" | "bad_client_id" | "missing_secret";

export type ClientJsonResult = { ok: true; client: ParsedClient } | { ok: false; error: ClientJsonError };

const CLIENT_ID_RE = /^[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function parseInput(input: string | unknown): Record<string, unknown> | null {
  let data: unknown = input;
  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch {
      return null;
    }
  }
  return isObj(data) ? data : null;
}

export function validateClientJson(input: string | unknown): ClientJsonResult {
  const data = parseInput(input);
  if (!data) return { ok: false, error: "not_json" };
  const hasInstalled = isObj(data.installed);
  const hasWeb = isObj(data.web);
  if (hasInstalled && hasWeb) return { ok: false, error: "ambiguous_client" };
  if (!hasInstalled && !hasWeb) return { ok: false, error: "not_installed" };
  const block = (hasInstalled ? data.installed : data.web) as Record<string, unknown>;
  const { client_id: id, client_secret: secret, project_id: project } = block;
  if (typeof id !== "string" || !CLIENT_ID_RE.test(id)) return { ok: false, error: "bad_client_id" };
  if (typeof secret !== "string" || !secret.trim() || secret.length > 500) return { ok: false, error: "missing_secret" };
  const client: ParsedClient = { type: hasInstalled ? "installed" : "web", clientId: id, clientSecret: secret };
  if (typeof project === "string" && PROJECT_ID_RE.test(project)) client.projectId = project;
  return { ok: true, client };
}

/** Domain input (scenario-gate A5): trim, lowercase, strip a leading `@`; no dot → `invalid_domain`. */
export function normalizeDomain(raw: string): string | null {
  const d = raw.trim().toLowerCase().replace(/^@/, "");
  if (!d || /\s/.test(d) || d.includes("@") || !d.includes(".") || d.startsWith(".") || d.endsWith(".")) return null;
  return d;
}

/** Own-client slug from a label (stable `id`; caller de-duplicates). */
export function slugify(label: string): string {
  const s = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "client";
}
