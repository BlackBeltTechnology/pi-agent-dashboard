/**
 * `[system-one]` warnings, deduplicated per process by message.
 * See change: add-system-one-registry.
 */
const seen = new Set<string>();

export function warnOnce(message: string): void {
  const line = `[system-one] ${message}`;
  if (seen.has(line)) return;
  seen.add(line);
  console.warn(line);
}

export function _resetWarnings(): void {
  seen.clear();
}
