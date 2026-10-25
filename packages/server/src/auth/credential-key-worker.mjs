// Keychain worker entry for the credential data key (D4, D5).
//
// Plain ESM, self-contained on purpose: it imports ONLY `@napi-rs/keyring` (lazily) and Node built-ins. No
// TypeScript, no workspace import, so it loads in a worker_threads Worker without a TS loader (the fit worker's
// `.ts` entry is the cautionary precedent). Every keychain call runs here, never on the server's main thread.
//
// One job per Worker: workerData = { job: { op: "read" | "create", service, account } }. It posts exactly one
// message and exits:
//   { ok: true, value: string | null, created: boolean }          // value = base64 key as stored
//   { ok: false, stage: "load" | "keychain", detail: string }      // detail: short, never file/key content
// `create` reads first and returns an existing value untouched (a malformed value is never overwritten); only
// when the entry is absent does it generate 32 random bytes, `setPassword`, and read back (the stored value wins).
//
// The named exports are also used in-process, with an injected entry factory, by credential-key.ts (tests only,
// D9). The self-run block below runs only inside a Worker.
import { randomBytes } from "node:crypto";
import { isMainThread, parentPort, workerData } from "node:worker_threads";

/** On Linux pin to the Secret Service: the default silently falls back to the non-persistent kernel keyring. */
export const ENTRY_OPTIONS = Object.freeze({ linux: Object.freeze({ store: "secret-service" }) });

const STRONG = /dlopen|map segment|code signature|LoadLibrary/i;
const WEAK = /Cannot find module/i;

const messageOf = (e) => (typeof e === "string" ? e : typeof e?.message === "string" ? e.message : undefined);

/** Direct children in the cause chain: `cause` (single or array) and AggregateError `errors`. */
function childrenOf(e) {
  if (e === null || typeof e !== "object") return [];
  const causes = Array.isArray(e.cause) ? e.cause : [e.cause];
  return Array.isArray(e.errors) ? [...causes, ...e.errors] : causes;
}

const deepest = (list) => list.reduce((a, b) => (b.depth > a.depth ? b : a));

/**
 * The real reason a binding failed to load sits in the nested `err.cause` chain (arrays included); the top-level
 * text ("Cannot find native binding. npm has a bug…") is misleading. Returns the deepest message matching
 * dlopen / map segment / code signature / LoadLibrary, else the deepest "Cannot find module", else the deepest.
 */
export function deepestCauseMessage(err) {
  const found = [];
  const seen = new Set();
  const stack = [{ e: err, depth: 0 }];
  while (stack.length > 0) {
    const { e, depth } = stack.pop();
    if (e === null || e === undefined || depth > 16 || seen.has(e)) continue;
    if (typeof e === "object") seen.add(e);
    const msg = messageOf(e);
    if (msg) found.push({ msg, depth });
    for (const c of childrenOf(e)) stack.push({ e: c, depth: depth + 1 });
  }
  if (found.length === 0) return "unknown error";
  const strong = found.filter((f) => STRONG.test(f.msg));
  if (strong.length > 0) return deepest(strong).msg;
  const weak = found.filter((f) => WEAK.test(f.msg));
  return deepest(weak.length > 0 ? weak : found).msg;
}

/** First line, whitespace collapsed, capped. Never a stack, never file content. */
export function shortenDetail(text) {
  const line = String(text ?? "").split(/\r?\n/)[0].replace(/\s+/g, " ").trim();
  return line.length > 240 ? `${line.slice(0, 237)}...` : line;
}

/**
 * Run one job against `entryFactory(service, account, options)`. Every Entry is constructed WITH `ENTRY_OPTIONS`.
 * Synchronous keychain calls: callers must run this off the server's main thread (the Worker below).
 */
export async function runKeychainJob(job, entryFactory) {
  const open = () => entryFactory(job.service, job.account, ENTRY_OPTIONS);
  const entry = open();
  const existing = entry.getPassword() ?? null;
  if (job.op === "read" || existing !== null) return { value: existing, created: false };
  const fresh = randomBytes(32).toString("base64");
  entry.setPassword(fresh);
  const stored = open().getPassword() ?? null; // read back: another process may have won the race
  return { value: stored, created: true };
}

/** Load the native binding. Throws the loader's own error (its `cause` chain carries the real reason). */
export async function loadEntryFactory() {
  const mod = await import("@napi-rs/keyring");
  const Entry = mod.Entry ?? mod.default?.Entry;
  if (typeof Entry !== "function") throw new Error("@napi-rs/keyring does not export Entry");
  return (service, account, options) => new Entry(service, account, options);
}

if (!isMainThread && parentPort && workerData?.job) {
  const port = parentPort;
  void (async () => {
    let factory;
    try {
      factory = await loadEntryFactory();
    } catch (err) {
      port.postMessage({ ok: false, stage: "load", detail: shortenDetail(deepestCauseMessage(err)) });
      return;
    }
    try {
      port.postMessage({ ok: true, ...(await runKeychainJob(workerData.job, factory)) });
    } catch (err) {
      port.postMessage({ ok: false, stage: "keychain", detail: shortenDetail(deepestCauseMessage(err)) });
    }
  })();
}
