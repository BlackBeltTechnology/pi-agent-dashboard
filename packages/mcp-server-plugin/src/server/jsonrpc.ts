/**
 * JSON-RPC 2.0 framing for the MCP endpoint.
 *
 * Kept separate from dispatch so the error *shapes* are asserted directly. The
 * pairing of HTTP status with JSON-RPC code is a conformance requirement, not
 * an implementation detail: revision 2026-07-28 requires an unknown method to
 * be `404` + `-32601`, and a version mismatch to be `400 HeaderMismatch`. A
 * malformed body must never become a `500` (E17).
 */

export const JSONRPC_VERSION = "2.0";

/** Standard JSON-RPC 2.0 error codes. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export type RpcId = string | number | null;

export interface RpcRequest {
  jsonrpc: string;
  id?: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcErrorBody {
  jsonrpc: string;
  id: RpcId;
  error: { code: number; message: string; data?: { type?: string; [k: string]: unknown } };
}

export interface RpcResultBody {
  jsonrpc: string;
  id: RpcId;
  result: unknown;
}

/** An HTTP status paired with the JSON-RPC body to send. */
export interface RpcHttpResponse {
  status: number;
  body: RpcErrorBody | RpcResultBody;
}

export function rpcResult(id: RpcId, result: unknown): RpcHttpResponse {
  return { status: 200, body: { jsonrpc: JSONRPC_VERSION, id, result } };
}

export function rpcError(
  status: number,
  id: RpcId,
  code: number,
  message: string,
  type?: string,
): RpcHttpResponse {
  return {
    status,
    body: {
      jsonrpc: JSONRPC_VERSION,
      id,
      error: { code, message, ...(type ? { data: { type } } : {}) },
    },
  };
}

/**
 * Best-effort id extraction from an unvalidated body.
 *
 * JSON-RPC requires the response to echo the request id even when the request
 * is otherwise invalid. A body that is not an object, or whose id is not a
 * string/number, yields `null` — which is the spec's own "unknown id" value,
 * not an error of its own.
 */
export function extractId(body: unknown): RpcId {
  if (typeof body !== "object" || body === null) return null;
  const id = (body as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/**
 * Validate the JSON-RPC envelope of an already-parsed body.
 *
 * Returns the typed request, or the error response to send. Note that a valid
 * JSON document which is not a valid JSON-RPC request is `-32600`, distinct
 * from unparseable bytes (`-32700`) — E17 asserts both, separately.
 */
export function parseRpcRequest(body: unknown): { ok: true; request: RpcRequest } | RpcHttpResponse {
  const id = extractId(body);

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return rpcError(400, id, RPC_INVALID_REQUEST, "Request body must be a JSON-RPC object");
  }

  const candidate = body as Partial<RpcRequest>;

  if (candidate.jsonrpc !== JSONRPC_VERSION) {
    return rpcError(400, id, RPC_INVALID_REQUEST, `jsonrpc must be "${JSONRPC_VERSION}"`);
  }

  if (typeof candidate.method !== "string" || candidate.method.length === 0) {
    return rpcError(400, id, RPC_INVALID_REQUEST, "method must be a non-empty string");
  }

  return { ok: true, request: { jsonrpc: candidate.jsonrpc, id, method: candidate.method, params: candidate.params } };
}
