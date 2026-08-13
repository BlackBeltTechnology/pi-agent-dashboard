/**
 * Client-side fetch helpers for custom-LLM-provider management.
 */
import { getApiBase } from "./api-context.js";
import { fetchJsonResponse } from "./fetch-json.js";

export interface TestProviderInput {
  name?: string;
  baseUrl: string;
  apiKey: string;
  api: string;
}

export type TestProviderResult =
  | { ok: true; status: number; modelCount: number; sample: string[] }
  | { ok: false; status?: number; error: string };

/**
 * Per-provider cached health from `GET /api/providers` (`health[name]`). Sourced
 * from a server-side probe on save / Test; credential-free.
 * See change: surface-provider-health-in-settings.
 */
export interface ProviderHealth {
  ok: boolean;
  status?: number;
  error?: string;
  modelCount?: number;
  testedAt: number;
}

/**
 * POST /api/providers/test — verify a provider's baseUrl + apiKey + api
 * combination against the upstream `/models`-style endpoint without saving.
 *
 * `apiKey` may be:
 *   - a literal string
 *   - a `$ENV_VAR` reference (resolved server-side)
 *   - `"***"` for an already-saved provider (the server resolves the real
 *     value from `~/.pi/agent/providers.json` using `name`).
 */
export async function testProvider(
  input: TestProviderInput,
): Promise<TestProviderResult> {
  try {
    const { res, json: body } = await fetchJsonResponse<TestProviderResult | { error?: string }>(`${getApiBase()}/api/providers/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    // Server always returns JSON; 400s (bad body) include { ok:false, error }.
    if (typeof (body as any).ok === "boolean") {
      return body as TestProviderResult;
    }
    return { ok: false, error: (body as any).error ?? `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
