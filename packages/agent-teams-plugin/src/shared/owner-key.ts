/**
 * `Team.owner` is the opaque string key of the host's `{iss, sub}` principal
 * owner: `JSON.stringify([iss, sub])` (injective, so near-miss principals never
 * collide). Core records it from the lead session's `principalOwner` object,
 * the owner rule (`server/access.ts`) compares against it, and a spawn converts
 * it back to the object the host expects. A string that is not such a key
 * (legacy/opaque) converts to nothing.
 * See change: add-agent-teams-ui (core amendment).
 */
export interface PrincipalOwner {
  iss: string;
  sub: string;
}

export function ownerKeyOf(principal: PrincipalOwner): string {
  return JSON.stringify([principal.iss, principal.sub]);
}

/** The `{iss, sub}` object a key stands for, or `undefined` when `key` is not a key. */
export function ownerFromKey(key: string): PrincipalOwner | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
  const [iss, sub] = parsed as unknown[];
  return typeof iss === "string" && typeof sub === "string" && ownerKeyOf({ iss, sub }) === key ? { iss, sub } : undefined;
}

/** A host `principalOwner` value (object, or an already-recorded string) as an owner key. */
export function ownerKeyFrom(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (value !== null && typeof value === "object") {
    const { iss, sub } = value as Record<string, unknown>;
    if (typeof iss === "string" && typeof sub === "string") return ownerKeyOf({ iss, sub });
  }
  return undefined;
}
