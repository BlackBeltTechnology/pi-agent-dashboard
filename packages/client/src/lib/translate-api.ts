/**
 * Client-side fetch helper for `POST /api/translate`.
 * Translates user text to English using a configured custom LLM provider.
 */
import { getApiBase } from "./api-context.js";

export interface TranslateInput {
  provider: string;
  model: string;
  text: string;
}

export type TranslateResult =
  | { ok: true; translated: string }
  | { ok: false; error: string };

export async function translateText(input: TranslateInput): Promise<TranslateResult> {
  try {
    const res = await fetch(`${getApiBase()}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (body && typeof body.ok === "boolean") {
      if (body.ok && typeof body.translated === "string") {
        return { ok: true, translated: body.translated };
      }
      if (!body.ok) {
        return { ok: false, error: typeof body.error === "string" ? body.error : `HTTP ${res.status}` };
      }
    }
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
