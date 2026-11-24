/**
 * `gdrive_pick` wire contract between the bridge tool and the dashboard tab (design D9). The tool raises an
 * `input` prompt in the calling session carrying `pluginMeta` (`pickerPluginMeta`); the tab that owns the
 * session shows Google's file picker and answers the prompt with ONE JSON string (`PickerAnswer`). Anything
 * else (empty answer, dismissed prompt, garbage) means "nothing picked". The answer comes from a browser, so
 * `parsePickerAnswer` bounds and validates every field. See change: add-google-connect.
 */

/** `pluginMeta.kind` of the picker prompt. */
export const PICKER_KIND = "drive-picker";
/** How long the tool waits for the user (scenario-gate C9). */
export const PICKER_TIMEOUT_MS = 300_000;
const MAX_PICKED = 50;

export interface PickedFile {
  id: string;
  name: string;
  mimeType: string;
}

export type PickerAnswer = { files: PickedFile[] } | { error: "picker_unavailable"; reason?: string };

const ID = /^[A-Za-z0-9_-]{1,200}$/;
const MIME = /^[\w.+-]{1,100}\/[\w.+-]{1,200}$/;

/** The `pluginMeta` the tab matches on: which session prompt is a picker and for which account. */
export function pickerPluginMeta(account: { sub: string; email: string }): Record<string, unknown> {
  return { pluginId: "google", kind: PICKER_KIND, account: account.sub, email: account.email };
}

/** The tab's answer text for a result. */
export const encodePickerAnswer = (a: PickerAnswer): string => JSON.stringify(a);

function pickedFile(f: unknown): PickedFile | undefined {
  const r = (f ?? {}) as Record<string, unknown>;
  if (typeof r.id !== "string" || !ID.test(r.id)) return undefined;
  const mimeType = typeof r.mimeType === "string" && MIME.test(r.mimeType) ? r.mimeType : "application/octet-stream";
  return { id: r.id, name: typeof r.name === "string" ? r.name.slice(0, 300) : r.id, mimeType };
}

/** Parse the prompt answer; never throws. Unusable → `{ files: [] }`. */
export function parsePickerAnswer(raw: unknown): PickerAnswer {
  if (typeof raw !== "string" || raw.length > 100_000) return { files: [] };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { files: [] };
  }
  if (typeof v !== "object" || v === null) return { files: [] };
  const o = v as { error?: unknown; reason?: unknown; files?: unknown };
  if (o.error === "picker_unavailable") {
    return { error: "picker_unavailable", ...(typeof o.reason === "string" && o.reason ? { reason: o.reason.slice(0, 300) } : {}) };
  }
  if (!Array.isArray(o.files)) return { files: [] };
  const files: PickedFile[] = [];
  for (const f of o.files.slice(0, 10 * MAX_PICKED)) {
    if (files.length >= MAX_PICKED) break;
    const picked = pickedFile(f);
    if (picked) files.push(picked);
  }
  return { files };
}
