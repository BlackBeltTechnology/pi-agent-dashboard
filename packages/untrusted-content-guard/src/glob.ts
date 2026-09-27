/** Minimal anchored glob for tool names: `*` = any run, `?` = one char, everything else literal. */

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  let re = cache.get(pattern);
  if (!re) {
    const body = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
    re = new RegExp(`^${body}$`);
    cache.set(pattern, re);
  }
  return re;
}

export function matchesAny(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => (p.includes("*") || p.includes("?") ? toRegExp(p).test(name) : p === name));
}
