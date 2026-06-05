/**
 * parseOption — split an option string into a title and an optional
 * description sub-line on the first ` — ` (em dash) or ` · ` (middot)
 * separator. Used by SelectRenderer rows and the batch wizard so long
 * options render a dimmed description under the title.
 *
 * See change: redesign-ask-user-question-cards.
 */
export function parseOption(option: string): { title: string; description?: string } {
  const sep = /\s(?:—|·)\s/.exec(option);
  if (!sep) return { title: option };
  return {
    title: option.slice(0, sep.index),
    description: option.slice(sep.index + sep[0].length),
  };
}

/** True when an option is a Cancel affordance (case-insensitive). */
export function isCancelOption(option: string): boolean {
  return /^cancel$/i.test(option.trim());
}
