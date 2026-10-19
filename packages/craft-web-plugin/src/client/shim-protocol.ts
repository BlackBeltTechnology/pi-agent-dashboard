/**
 * Message protocol between the host and `craft-shim.js` running inside the sandboxed
 * frame (design D4). The host accepts a message only when `event.source` is its own
 * iframe window, the nonce matches the mount and the `type` is known (the caller checks
 * source + nonce; {@link parseShimMessage} checks shape + type). The nonce binds messages
 * to the mount; it does not authenticate the framed app.
 * See change: edit-office-in-pane-with-craft-web.
 */

export type ShimMessage =
  | { type: "ready"; nonce: string }
  | { type: "opened"; nonce: string; title?: string }
  | { type: "save"; nonce: string; suggestedName: string; mime?: string; bytes: ArrayBuffer }
  | { type: "dirty"; nonce: string; value: boolean }
  | { type: "blocked"; nonce: string; what?: string }
  | { type: "csp"; nonce: string; directive: string }
  | { type: "navigate-blocked"; nonce: string; url: string };

export type HostMessage =
  | { type: "open"; nonce: string; name: string; bytes: ArrayBuffer }
  | { type: "save-result"; nonce: string; ok: boolean; error?: string };

const tag = (v: unknown): string => Object.prototype.toString.call(v);

/** ArrayBuffer (cross-realm safe) or a view over one, normalised to a standalone ArrayBuffer. */
function toBuffer(v: unknown): ArrayBuffer | null {
  if (tag(v) === "[object ArrayBuffer]") return v as ArrayBuffer;
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
  }
  return null;
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

type Fields = Record<string, unknown>;

/** Per-type field validators; each returns the payload (without `nonce`) or `null` when malformed. */
const PARSERS: Record<string, (d: Fields) => Record<string, unknown> | null> = {
  ready: () => ({}),
  opened: (d) => ({ title: str(d.title) ?? undefined }),
  save: (d) => {
    const suggestedName = str(d.suggestedName);
    const bytes = toBuffer(d.bytes);
    return suggestedName === null || !bytes ? null : { suggestedName, mime: str(d.mime) ?? undefined, bytes };
  },
  dirty: (d) => (typeof d.value === "boolean" ? { value: d.value } : null),
  blocked: (d) => ({ what: str(d.what) ?? undefined }),
  csp: (d) => {
    const directive = str(d.directive);
    return directive === null ? null : { directive };
  },
  "navigate-blocked": (d) => {
    const url = str(d.url);
    return url === null ? null : { url };
  },
};

/** Shape + type check. Returns `null` for anything that is not a well-formed known message. */
export function parseShimMessage(data: unknown): ShimMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Fields;
  const nonce = str(d.nonce);
  const type = str(d.type);
  const parse = type !== null && Object.hasOwn(PARSERS, type) ? PARSERS[type] : undefined;
  const payload = nonce !== null && parse ? parse(d) : null;
  return payload ? ({ type, nonce, ...payload } as ShimMessage) : null;
}

/** 128-bit random per-mount nonce (hex). */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `http(s)` only — anything else (javascript:, data:, blob:, file:) is never offered. */
export function safeNavigateUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}
