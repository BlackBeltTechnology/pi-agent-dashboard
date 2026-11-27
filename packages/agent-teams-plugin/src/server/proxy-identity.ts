/**
 * Lead-proxied member identity (design D4, decisions B99): in-process members share the lead's
 * socket, so core's "identity = socket session" cannot identify a child. A request-lane payload MAY
 * carry `as {member, token}`; this module decides it. The `as` is honoured only when (1) the socket
 * session is the LEAD of a team whose mode is `in-process`, (2) the token matches the member's persisted
 * `proxyToken` (constant-time) and (3) the member is not `gone`/`failed`. Verification order: socket,
 * then token, then member state, so a wrong token never reveals whether a member exists; a present-but-
 * invalid `as` is `forbidden` and NEVER falls back to the socket identity. A valid token of a gone member is
 * `member_gone`. Pure (store reads only); the caller counts and logs rejections with ids only.
 * See change: add-agent-teams-in-process.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { LEAD_ADDRESS } from "../shared/constants.js";
import { IN_PROCESS_MODE } from "../shared/inproc-protocol.js";
import type { Member, Team } from "../shared/types.js";
import { isLive } from "./op-util.js";
import type { TeamStore } from "./store.js";

/** 32 random bytes as 64 lowercase hex chars. */
export const PROXY_TOKEN_HEX_LENGTH = 64;

/** Same length as a real token; never matches because a real token is hex and this is not. */
const PLACEHOLDER = "x".repeat(PROXY_TOKEN_HEX_LENGTH);

export function mintProxyToken(random: (n: number) => Buffer = randomBytes): string {
  return random(32).toString("hex");
}

type Compare = (a: Buffer, b: Buffer) => boolean;

/**
 * Constant-time equality of two tokens. `compare` (default `crypto.timingSafeEqual`) is only ever called with
 * equal-length buffers; unequal lengths are `false` without calling it (it would throw), and non-strings are `false`.
 */
export function tokensEqual(expected: unknown, candidate: unknown, compare: Compare = timingSafeEqual): boolean {
  if (typeof expected !== "string" || typeof candidate !== "string") return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return compare(a, b);
}

/** The `as` of a lane payload: `undefined` = absent (core identity applies), `null` = present but malformed. */
export type AsClaim = { member: string; token: string } | null | undefined;

const MAX_AS_MEMBER_CHARS = 64;
const MAX_AS_TOKEN_CHARS = 256;

export function asClaimOf(payload: unknown): AsClaim {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  if (!Object.hasOwn(payload, "as")) return undefined;
  const as = (payload as Record<string, unknown>).as;
  if (as === null || typeof as !== "object" || Array.isArray(as)) return null;
  const member = Object.hasOwn(as, "member") ? (as as Record<string, unknown>).member : undefined;
  const token = Object.hasOwn(as, "token") ? (as as Record<string, unknown>).token : undefined;
  if (typeof member !== "string" || typeof token !== "string") return null;
  if (member.length === 0 || member.length > MAX_AS_MEMBER_CHARS || token.length === 0 || token.length > MAX_AS_TOKEN_CHARS) return null;
  return { member, token };
}

export type ProxyDecision = { ok: true; team: Team; member: Member } | { ok: false; error: "forbidden" | "member_gone" };

const FORBIDDEN: ProxyDecision = { ok: false, error: "forbidden" };

/** Decide a (non-absent) `as` claim made on `socketSessionId`. */
export function resolveProxied(store: Pick<TeamStore, "findBySession" | "get" | "member">, socketSessionId: string, claim: Exclude<AsClaim, undefined>, compare?: Compare): ProxyDecision {
  const binding = store.findBySession(socketSessionId);
  const team = binding?.who === LEAD_ADDRESS ? store.get(binding.teamId) : undefined;
  if (!team || team.mode !== IN_PROCESS_MODE || team.status === "closed") {
    if (claim) tokensEqual(PLACEHOLDER, claim.token, compare); // keep the cost shape of a real compare
    return FORBIDDEN;
  }
  if (claim === null) return FORBIDDEN;
  const member = store.member(team, claim.member);
  // Always run one compare, also for an unknown member / a member without a token: no existence oracle.
  const matches = tokensEqual(member?.proxyToken ?? PLACEHOLDER, claim.token, compare) && member?.proxyToken !== undefined;
  if (!member || !matches) return FORBIDDEN;
  if (!isLive(member)) return { ok: false, error: "member_gone" };
  return { ok: true, team, member };
}

/**
 * A closed team keeps no member secrets: `proxyToken`s are deleted from every member when the team closes (a gone member's
 * token stays valid, answering `member_gone`, until then). Returns the unsubscribe function.
 */
export function scrubProxyTokensOnClose(store: Pick<TeamStore, "on" | "patchMember">): () => void {
  return store.on("team_closed", ({ team }) => {
    for (const m of team.members) if (m.proxyToken !== undefined) store.patchMember(team.id, m.name, { proxyToken: undefined }, { writeThrough: true });
  });
}
