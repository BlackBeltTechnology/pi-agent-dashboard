/**
 * Message protocol between the host and `craft-shim.js` running inside the sandboxed
 * frame (design D4). The host accepts a message only when `event.source` is its own
 * iframe window, the nonce matches the mount and the `type` is known (the caller checks
 * source + nonce; {@link parseShimMessage} checks shape + type). The nonce binds messages
 * to the mount; it does not authenticate the framed app.
 * See change: edit-office-in-pane-with-craft-web.
 */

export type ShimMessage =
  /** Shim v3 adds `shimVersion` and `control` (the profile has a control entry); a v1/v2 shim sends neither. */
  | { type: "ready"; nonce: string; shimVersion?: number; control?: boolean }
  /** `confirmed:false` = opened by the no-title fallback (shim v2); absent (v1 shim) counts as confirmed. */
  | { type: "opened"; nonce: string; title?: string; confirmed?: boolean }
  /** `msSinceInput` (shim v3): ms since the last trusted user input in the frame. */
  | { type: "save"; nonce: string; suggestedName: string; mime?: string; bytes: ArrayBuffer; msSinceInput?: number }
  | { type: "dirty"; nonce: string; value: boolean }
  | { type: "blocked"; nonce: string; what?: string }
  | { type: "csp"; nonce: string; directive: string }
  | { type: "navigate-blocked"; nonce: string; url: string }
  /** Wasm trap / Rust panic before opened (shim v2). */
  | { type: "start-failed"; nonce: string; detail?: string }
  /** Shim v4: the synthetic drop of one `open-media` medium has settled (media projects). */
  | { type: "open-media-ack"; nonce: string; name: string }
  /**
   * Answer to a host `control` (shim v3). Fields stay `unknown` on purpose: the HOST validates them (a malformed
   * reply becomes a tool error, not a silent drop). `code`: "not-ready" | "unsupported" from the shim itself.
   */
  | { type: "control-result"; nonce: string; id: number; ok: unknown; result?: unknown; error?: unknown; code?: unknown };

export type HostMessage =
  | { type: "control"; nonce: string; id: number; method: string; params?: unknown }
  | { type: "open"; nonce: string; name: string; bytes: ArrayBuffer }
  /** Media projects (shim v4): one referenced medium, dropped before the project; answered by `open-media-ack`. */
  | { type: "open-media"; nonce: string; name: string; bytes: ArrayBuffer }
  /** `own`: an acknowledged overwrite of the tab's own file (shim v2 `cleanOnAckedSave`). */
  | { type: "save-result"; nonce: string; ok: boolean; error?: string; own?: boolean };

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
  ready: (d) => ({
    ...(typeof d.shimVersion === "number" && Number.isInteger(d.shimVersion) ? { shimVersion: d.shimVersion } : {}),
    ...(typeof d.control === "boolean" ? { control: d.control } : {}),
  }),
  opened: (d) => ({ title: str(d.title) ?? undefined, confirmed: typeof d.confirmed === "boolean" ? d.confirmed : undefined }),
  save: (d) => {
    const suggestedName = str(d.suggestedName);
    const bytes = toBuffer(d.bytes);
    const ms = typeof d.msSinceInput === "number" && Number.isFinite(d.msSinceInput) ? d.msSinceInput : undefined;
    return suggestedName === null || !bytes ? null : { suggestedName, mime: str(d.mime) ?? undefined, bytes, ...(ms !== undefined ? { msSinceInput: ms } : {}) };
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
  "start-failed": (d) => ({ detail: str(d.detail) ?? undefined }),
  "open-media-ack": (d) => {
    const name = str(d.name);
    return name === null ? null : { name };
  },
  "control-result": (d) =>
    typeof d.id === "number" && Number.isFinite(d.id) ? { id: d.id, ok: d.ok, result: d.result, error: d.error, code: d.code } : null,
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
