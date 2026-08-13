/**
 * Protocol-version negotiation for MCP revision `2026-07-28`.
 *
 * Revision `2026-07-28` makes the version a per-request MUST: it travels both
 * in the `MCP-Protocol-Version` header and in `params._meta`, and the two must
 * agree. There is no handshake to negotiate it once, so every request is
 * validated independently — which is also what keeps the endpoint stateless.
 *
 * Design decisions this encodes:
 * - Decision 10 — exactly one supported revision. Serving 2025-06-18 /
 *   2025-11-25 would reintroduce `initialize` + `Mcp-Session-Id`, the two
 *   mechanisms this endpoint exists to refuse.
 * - Task 2.4 — an absent header, an absent `params._meta`, and a header/body
 *   mismatch are each a distinct, documented refusal. None of them may
 *   silently default to the latest supported version.
 */

/** Every protocol revision this server speaks. Deliberately a single entry. */
export const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28"] as const;

export type SupportedProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** The revision advertised first by `server/discover`. */
export const CURRENT_PROTOCOL_VERSION: SupportedProtocolVersion = "2026-07-28";

/** Lower-cased, because Node normalises incoming header names. */
export const PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

/** The `params._meta` key carrying the same version. */
export const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

export type ProtocolVersionFailure =
  /** No `MCP-Protocol-Version` header at all (E15). */
  | "MissingHeader"
  /** No `params._meta`, or no version key inside it (E13). */
  | "MissingMeta"
  /** Header and body disagree (E14) — always `400 HeaderMismatch`. */
  | "HeaderMismatch"
  /** Well-formed request naming a revision we do not serve (E11, E12). */
  | "UnsupportedProtocolVersion";

export type ProtocolVersionResult =
  | { ok: true; version: SupportedProtocolVersion }
  | { ok: false; code: ProtocolVersionFailure };

function isSupported(value: unknown): value is SupportedProtocolVersion {
  return (
    typeof value === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  );
}

/**
 * Resolve the protocol version for one request.
 *
 * Checked in a fixed order, because the order is itself observable:
 *
 *   1. header present  — a missing header outranks a bad body version, so a
 *      client that forgot the header is told *that*, not something downstream.
 *   2. `_meta` present — an absent `_meta` is a refusal, never a default.
 *   3. body version is a string — a `null`, numeric, or object version is
 *      malformed *in itself*. It is judged here rather than at step 4 because
 *      a non-string can never compare equal to a header string, so leaving it
 *      to step 4 would misreport every malformed version as `HeaderMismatch`
 *      and hide the real defect (E12).
 *   4. header vs body  — a disagreement is `HeaderMismatch` even when one side
 *      is individually valid, so neither side can be quietly preferred.
 *   5. supported       — only now is a well-formed, agreed value judged.
 *
 * This function never throws on arbitrary input (E12).
 *
 * @param headerValue raw `MCP-Protocol-Version` header. Fastify yields
 *   `string | string[] | undefined`; a repeated header (array) is treated as
 *   absent rather than guessing which copy the client meant.
 * @param params the JSON-RPC `params` object, unvalidated.
 */
export function resolveProtocolVersion(
  headerValue: string | string[] | undefined,
  params: unknown,
): ProtocolVersionResult {
  if (typeof headerValue !== "string" || headerValue.length === 0) {
    return { ok: false, code: "MissingHeader" };
  }

  const meta =
    typeof params === "object" && params !== null
      ? (params as { _meta?: unknown })._meta
      : undefined;
  if (typeof meta !== "object" || meta === null) {
    return { ok: false, code: "MissingMeta" };
  }

  const bodyVersion = (meta as Record<string, unknown>)[META_VERSION_KEY];
  if (bodyVersion === undefined) {
    return { ok: false, code: "MissingMeta" };
  }

  // A non-string version is malformed on its own terms. Judged before the
  // comparison, because a non-string can never equal the header string and
  // would otherwise be reported as a mismatch — blaming the header for a
  // defect that is entirely in the body.
  if (typeof bodyVersion !== "string") {
    return { ok: false, code: "UnsupportedProtocolVersion" };
  }

  // Compared before either side is judged supported: a client whose header and
  // body disagree has a bug we must name precisely, whichever side is wrong.
  if (bodyVersion !== headerValue) {
    return { ok: false, code: "HeaderMismatch" };
  }

  if (!isSupported(bodyVersion)) {
    return { ok: false, code: "UnsupportedProtocolVersion" };
  }

  return { ok: true, version: bodyVersion };
}
