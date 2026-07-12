/**
 * Shared model-id parser. First-slash split: provider = substring before the
 * first `/`, model id = the entire remainder (which MAY itself contain `/`).
 * A label with no leading provider (`""`, `"gpt-4"`, `"/x"`) has no provider.
 *
 * Mirrors goal-plugin's `parseModelLabel`; converges the model-proxy routes
 * off `split("/", 2)` (which truncates multi-slash ids).
 *
 * See change: fix-and-prefer-model-proxy-resolution.
 */
export function parseModelId(label: string): { provider: string; modelId: string } {
  const slash = label.indexOf("/");
  if (slash <= 0) return { provider: "", modelId: label };
  return { provider: label.slice(0, slash), modelId: label.slice(slash + 1) };
}
