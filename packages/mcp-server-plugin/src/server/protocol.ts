/**
 * Protocol-version negotiation for the dual-era MCP endpoint.
 *
 * Two eras share one route (Decision D1 of mcp-legacy-clients-and-token-issuance):
 *
 * - Modern — revision `2026-07-28` (SEP-2575, stateless). The version is a
 *   per-request MUST travelling in both the `MCP-Protocol-Version` header and
 *   `params._meta`, which must agree. There is no handshake; every request is
 *   validated independently.
 * - Legacy — revisions `2025-03-26`, `2025-06-18`, `2025-11-25`
 *   (Streamable-HTTP). These negotiate via `initialize` and carry the version
 *   in `params.protocolVersion` on the handshake and in the header afterwards;
 *   many clients omit the header entirely on some requests.
 *
 * The failure codes stay distinct and documented: an ambiguous header, a
 * missing header, a missing `_meta` version, a header/body mismatch and an
 * unsupported version are each refused explicitly — none may silently default
 * to the latest supported revision. The ONE deliberate loosening is rule 4
 * below: a request with no version marker at all defaults to the legacy era,
 * because a conformant modern client never omits both markers and the
 * version-key-present branch still refuses.
 */

/** Legacy Streamable-HTTP revisions, in negotiation order. */
export const LEGACY_PROTOCOL_VERSIONS = ["2025-03-26", "2025-06-18", "2025-11-25"] as const;

/** The modern stateless revision. */
export const MODERN_PROTOCOL_VERSION = "2026-07-28";

/** Every protocol revision this server speaks — the union both eras draw from. */
export const SUPPORTED_PROTOCOL_VERSIONS = [
  ...LEGACY_PROTOCOL_VERSIONS,
  MODERN_PROTOCOL_VERSION,
] as const;

type SupportedProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/** Lower-cased, because Node normalises incoming header names. */
export const PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

/** The `params._meta` key carrying the same version. */
export const META_VERSION_KEY = "io.modelcontextprotocol/protocolVersion";

export type ProtocolEra = "modern" | "legacy";

export type ProtocolVersionFailure =
  /** More than one `MCP-Protocol-Version` header — refused for EVERY method,
   * including `initialize`, rather than silently taking one (X3). */
  | "AmbiguousHeader"
  /** No `MCP-Protocol-Version` header where one is required (E15/X11). */
  | "MissingHeader"
  /** `params._meta` present but lacking the version key, on a modern-headered
   * request (E13). */
  | "MissingMeta"
  /** Header and body disagree (E14) — always `400 HeaderMismatch`. */
  | "HeaderMismatch"
  /** Well-formed request naming a revision we do not serve (E11, E12). */
  | "UnsupportedProtocolVersion";

export type ProtocolVersionResult =
  | { ok: true; era: ProtocolEra; version: SupportedProtocolVersion }
  | { ok: false; code: ProtocolVersionFailure };

const LEGACY_SET: readonly string[] = LEGACY_PROTOCOL_VERSIONS;

function isSupported(value: unknown): value is SupportedProtocolVersion {
  return (
    typeof value === "string" && (SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(value)
  );
}

/**
 * Resolve the protocol version for one request.
 *
 * Resolution order (D1 rules 0–4) — the order is itself observable:
 *
 *   0. Repeated header → `AmbiguousHeader`, for every method including
 *      `initialize`. With a legacy default this could otherwise silently
 *      downgrade, so it becomes an explicit refusal first. Detected as a
 *      `string[]` value or a comma-joined string: Node's HTTP parser merges
 *      duplicate headers into one comma-separated value, so the joined form
 *      is the one that actually arrives at Fastify.
 *   1. `initialize` → the version comes from `params.protocolVersion` ONLY
 *      (the 2025 spec sends neither header nor `_meta` on the handshake).
 *      A legacy revision is echoed back; `2026-07-28` resolves modern (the
 *      dispatcher refuses the handshake); any other string negotiates DOWN
 *      to `2025-11-25` per the 2025 spec ("respond with a version it does
 *      support" — SDK clients treat an initialize error as fatal); a missing
 *      or non-string version is malformed, not negotiable.
 *   2. Header present → must be a known version. Legacy revisions resolve
 *      legacy on the header alone; the modern revision still requires the
 *      `_meta` key. If `_meta` DECLARES the version key the two must agree
 *      (a non-string body version is malformed in itself, judged before the
 *      comparison so it is not misreported as a mismatch, E12).
 *   3. Header absent, `_meta` declares the version key → the modern revision
 *      requires its header (`MissingHeader`), unchanged from the
 *      single-revision contract.
 *   4. No version marker at all (no header, `_meta` absent or carrying only
 *      other keys such as `progressToken`) → legacy `2025-03-26` (2025-spec
 *      "SHOULD assume" rule). The one loosening that keeps a client which
 *      omits the header after `initialize` working.
 *
 * This function never throws on arbitrary input (E12).
 *
 * @param method the JSON-RPC method, used only to detect `initialize`.
 * @param headerValue raw `MCP-Protocol-Version` header. Fastify yields
 *   `string | string[] | undefined`.
 * @param params the JSON-RPC `params` object, unvalidated.
 */
export function resolveProtocolVersion(
  method: string,
  headerValue: string | string[] | undefined,
  params: unknown,
): ProtocolVersionResult {
  // Rule 0 — an ambiguous header is refused before anything else is read.
  // Node's HTTP parser JOINS repeated headers into one comma-separated value
  // in `request.headers` (raw duplicates survive only in `rawHeaders`), so a
  // comma-bearing value is itself evidence of a duplicated header.
  if (
    Array.isArray(headerValue) ||
    (typeof headerValue === "string" && headerValue.includes(","))
  ) {
    return { ok: false, code: "AmbiguousHeader" };
  }
  const header = typeof headerValue === "string" && headerValue.length > 0 ? headerValue : undefined;

  const meta =
    typeof params === "object" && params !== null
      ? (params as { _meta?: unknown })._meta
      : undefined;
  const bodyVersion =
    typeof meta === "object" && meta !== null
      ? (meta as Record<string, unknown>)[META_VERSION_KEY]
      : undefined;
  const metaDeclaresVersion = bodyVersion !== undefined;

  // Rule 1 — the initialize handshake negotiates from params.protocolVersion.
  if (method === "initialize") {
    const requested = typeof params === "object" && params !== null
      ? (params as { protocolVersion?: unknown }).protocolVersion
      : undefined;
    if (typeof requested !== "string") {
      return { ok: false, code: "UnsupportedProtocolVersion" };
    }
    if (requested === MODERN_PROTOCOL_VERSION) {
      return { ok: true, era: "modern", version: MODERN_PROTOCOL_VERSION };
    }
    if ((LEGACY_SET as readonly string[]).includes(requested)) {
      return { ok: true, era: "legacy", version: requested as SupportedProtocolVersion };
    }
    // Negotiate down: the 2025 spec requires the server to answer with a
    // version it supports rather than erroring on an unknown one.
    return { ok: true, era: "legacy", version: "2025-11-25" };
  }

  // Rule 2 — a present header decides, with the body required to agree.
  if (header !== undefined) {
    if (metaDeclaresVersion) {
      // A non-string version is malformed on its own terms. Judged before the
      // comparison, because a non-string can never equal the header string and
      // would otherwise be reported as a mismatch — blaming the header for a
      // defect that is entirely in the body (E12).
      if (typeof bodyVersion !== "string") {
        return { ok: false, code: "UnsupportedProtocolVersion" };
      }
      // Compared before either side is judged supported: a client whose header
      // and body disagree has a bug we must name precisely, whichever side is
      // wrong (E14) — even when the header carries a typo'd near-version.
      if (bodyVersion !== header) {
        return { ok: false, code: "HeaderMismatch" };
      }
    }
    if (!isSupported(header)) {
      return { ok: false, code: "UnsupportedProtocolVersion" };
    }
    if (header !== MODERN_PROTOCOL_VERSION) {
      return { ok: true, era: "legacy", version: header as SupportedProtocolVersion };
    }
    // Modern header without the `_meta` version key is a refusal, never a
    // default (E13).
    if (!metaDeclaresVersion) {
      return { ok: false, code: "MissingMeta" };
    }
    return { ok: true, era: "modern", version: MODERN_PROTOCOL_VERSION };
  }

  // Rule 3 — no header, but the body declares a version: the modern revision
  // requires its header. Unchanged from the single-revision contract (E15/X11).
  if (metaDeclaresVersion) {
    return { ok: false, code: "MissingHeader" };
  }

  // Rule 4 — no version marker at all: legacy default.
  return { ok: true, era: "legacy", version: "2025-03-26" };
}
