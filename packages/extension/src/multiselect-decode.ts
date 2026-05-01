/**
 * decodeMultiselectAnswer — pure helper that turns a `PromptResponse`
 * (from PromptBus) into the `string[] | undefined` shape expected by
 * `polyfillMultiselect` and other multiselect callers.
 *
 * Contract:
 *   • cancelled: true                                  → undefined
 *   • cancelled: false, answer: undefined / null / ""  → []  (empty selection
 *                                                            is a real answer,
 *                                                            distinct from
 *                                                            cancellation)
 *   • cancelled: false, answer: '["a","b"]'            → ["a","b"]
 *   • cancelled: false, answer: <unparseable>          → []  (graceful
 *                                                            degradation,
 *                                                            never throw)
 *
 * Kept separate from `bridge.ts` so unit tests can exercise it without
 * instantiating a live PromptBus or session context.
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */

export interface DecodableResponse {
  cancelled?: boolean;
  answer?: string | undefined;
}

export function decodeMultiselectAnswer(
  response: DecodableResponse,
): string[] | undefined {
  if (response.cancelled) return undefined;
  const answer = response.answer;
  if (answer == null || answer === "") return [];
  try {
    const parsed = JSON.parse(answer);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
