#!/usr/bin/env node
// @ts-check
// mock-capture — record a running app's HTTP traffic for a URL (Playwright HAR),
// redact credential-bearing headers / cookies / query params / JSON body keys,
// REFUSE to write when a secret pattern survives, and write `fixtures.har.json`
// into the mock dir. HTTP only: WebSocket fixtures are written by hand.
//   mock-capture <url> <mockDir> [--redact <key>]... [--out <file>]
// See change: add-mock-site-exact-env (design D3, "Secret patterns").
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

export const REDACTED = "[REDACTED]";
/** Built-in redaction list: authorization, cookies, password, secret, token, api-key-like, session keys. */
const DEFAULT_KEY_RE = /authorization|cookie|passw(or)?d|secret|token|api[-_]?key|session/i;
/** @type {[string, RegExp][]} */
export const SECRET_PATTERNS = [
  ["bearer token", /\bBearer\s+[A-Za-z0-9._~+/-]{6,}=*/],
  ["JWT", /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/],
  ["sk- key", /\bsk-[A-Za-z0-9_-]{12,}/],
  ["GitHub token", /\bgh[po]_[A-Za-z0-9]{20,}/],
  ["GitHub PAT", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
  ["Slack token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
];

/** @param {string[]} extra */
const keyMatcher = (extra) => {
  const set = new Set(extra.map((k) => k.toLowerCase()));
  return (/** @type {string} */ k) => DEFAULT_KEY_RE.test(k) || set.has(k.toLowerCase());
};

/** Deep-redact JSON values under matching keys. @param {unknown} v @param {(k: string) => boolean} hit @returns {unknown} */
function redactJson(v, hit) {
  if (Array.isArray(v)) return v.map((x) => redactJson(x, hit));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hit(k) ? REDACTED : redactJson(x, hit)]));
  return v;
}

/** @param {string|undefined} text @param {(k: string) => boolean} hit */
function redactBody(text, hit) {
  if (typeof text !== "string" || !text) return text;
  try { return JSON.stringify(redactJson(JSON.parse(text), hit)); } catch { return text; }
}

/** @param {{ name: string, value: string }[]|undefined} list @param {(k: string) => boolean} hit */
const redactPairs = (list, hit) => (list ?? []).map((p) => (hit(p.name) ? { ...p, value: REDACTED } : p));

/**
 * Redact a HAR in place-safe copy: headers, cookies, query (and the URL), JSON bodies.
 * @param {any} har @param {string[]} [extra] additional key names
 */
export function redactHar(har, extra = []) {
  const hit = keyMatcher(extra);
  const out = structuredClone(har);
  for (const e of out.log?.entries ?? []) {
    const rq = e.request ?? {}, rs = e.response ?? {};
    rq.headers = redactPairs(rq.headers, hit);
    rs.headers = redactPairs(rs.headers, hit);
    rq.cookies = redactPairs(rq.cookies, hit);
    rs.cookies = redactPairs(rs.cookies, hit);
    rq.queryString = redactPairs(rq.queryString, hit);
    if (typeof rq.url === "string") {
      try {
        const u = new URL(rq.url);
        for (const k of [...u.searchParams.keys()]) if (hit(k)) u.searchParams.set(k, REDACTED);
        rq.url = u.toString();
      } catch { /* keep */ }
    }
    if (rq.postData?.text) rq.postData.text = redactBody(rq.postData.text, hit);
    if (rs.content?.text) rs.content.text = redactBody(rs.content.text, hit);
  }
  return out;
}

/** @param {string} s */
const matchSecret = (s) => SECRET_PATTERNS.find(([, re]) => re.test(s))?.[0];

/** @param {unknown} v @param {string} at @returns {{ at: string, kind: string } | null} */
function scanJson(v, at) {
  if (typeof v === "string") { const k = matchSecret(v); return k ? { at, kind: k } : null; }
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = scanJson(v[i], `${at}[${i}]`); if (r) return r; } return null; }
  if (v && typeof v === "object") { for (const [k, x] of Object.entries(v)) { const r = scanJson(x, `${at}.${k}`); if (r) return r; } }
  return null;
}

/** @param {string|undefined} text @param {string} where */
function scanBody(text, where) {
  if (typeof text !== "string" || !text) return null;
  try {
    const r = scanJson(JSON.parse(text), "$");
    return r ? { location: `${where} ${r.at}`, kind: r.kind } : null;
  } catch {
    const k = matchSecret(text);
    return k ? { location: where, kind: k } : null;
  }
}

/**
 * First secret left in a (redacted) HAR, naming the entry and JSON path; null when clean.
 * @param {any} har
 * @returns {{ location: string, kind: string } | null}
 */
export function scanSecrets(har) {
  const entries = har.log?.entries ?? [];
  for (let i = 0; i < entries.length; i++) {
    const { request: rq = {}, response: rs = {} } = entries[i];
    const label = `entry ${i} (${rq.method ?? "?"} ${rq.url ?? "?"})`;
    for (const [side, list] of /** @type {const} */ ([["request header", rq.headers], ["response header", rs.headers], ["query", rq.queryString]])) {
      for (const p of list ?? []) { const k = matchSecret(String(p.value)); if (k) return { location: `${label} ${side} ${p.name}`, kind: k }; }
    }
    const r = scanBody(rq.postData?.text, `${label} request body`) ?? scanBody(rs.content?.text, `${label} response body`);
    if (r) return r;
  }
  return null;
}

/**
 * Keep the app's data requests (fetch / XHR, or JSON responses) as replayable entries.
 * @param {any} har @param {string} source
 */
export function harToFixtures(har, source) {
  const entries = (har.log?.entries ?? []).filter((/** @type {any} */ e) => {
    const t = e._resourceType;
    const mime = String(e.response?.content?.mimeType ?? "");
    return t === "fetch" || t === "xhr" || (!t && mime.includes("json"));
  }).map((/** @type {any} */ e) => {
    const u = new URL(e.request.url);
    return {
      method: String(e.request.method).toUpperCase(),
      path: u.pathname,
      query: u.search,
      status: e.response.status,
      contentType: String(e.response.content?.mimeType ?? "application/json"),
      body: e.response.content?.encoding === "base64" ? "" : (e.response.content?.text ?? ""),
    };
  });
  return { version: 1, source, entries };
}

/**
 * Redact, refuse on secrets, convert, write. Writes nothing on refusal.
 * @param {any} har @param {{ out: string, source: string, redact?: string[] }} o
 * @returns {{ ok: true, file: string, count: number } | { ok: false, error: string }}
 */
export function writeFixtures(har, o) {
  const clean = redactHar(har, o.redact ?? []);
  const hit = scanSecrets(clean);
  if (hit) return { ok: false, error: `refusing to write ${o.out}: ${hit.kind} at ${hit.location}. Add its key with --redact <key> (or "redact" in the mock options), or strip it from the app's data` };
  const fx = harToFixtures(clean, o.source);
  fs.mkdirSync(path.dirname(o.out), { recursive: true });
  fs.writeFileSync(o.out, JSON.stringify(fx, null, 2) + "\n");
  return { ok: true, file: o.out, count: fx.entries.length };
}

/** Record a HAR of one page load with Playwright. @param {string} url @returns {Promise<any>} */
async function recordHar(url) {
  const spec = "playwright";
  const pw = await import(spec).catch(() => null);
  if (!pw?.chromium) throw new Error("playwright not installed: npm i -D playwright");
  const { launchChromium } = await import("./browser.mjs");
  const { browser } = await launchChromium(pw.chromium);
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mock-capture-")), "capture.har");
  try {
    const ctx = await browser.newContext({ recordHar: { path: tmp, content: "embed" } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "networkidle" });
    await ctx.close();
    return JSON.parse(fs.readFileSync(tmp, "utf8"));
  } finally {
    await browser.close();
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

/**
 * @param {string[]} argv @param {{ cwd?: string, record?: (url: string) => Promise<any>, redact?: string[] }} [deps]
 * @returns {Promise<{ code: number, out: string }>}
 */
export async function run(argv, deps = {}) {
  const usage = "usage: mock-capture <url> <mockDir> [--redact <key>]... [--out <file>]";
  /** @type {string[]} */
  const pos = [], redact = [...(deps.redact ?? [])];
  let out;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--redact" && argv[i + 1]) redact.push(argv[++i]);
    else if (argv[i] === "--out" && argv[i + 1]) out = argv[++i];
    else pos.push(argv[i]);
  }
  const [url, mockDir] = pos;
  if (!url || !mockDir || !/^https?:\/\//.test(url)) return { code: 2, out: usage };
  const cwd = deps.cwd ?? process.cwd();
  const file = path.resolve(cwd, out ?? path.join(mockDir, "fixtures.har.json"));
  let har;
  try { har = await (deps.record ?? recordHar)(url); } catch (e) { return { code: 1, out: `capture failed: ${String(/** @type {Error} */ (e).message).split("\n")[0]}` }; }
  const r = writeFixtures(har, { out: file, source: url, redact });
  if (!r.ok) return { code: 1, out: r.error };
  return { code: 0, out: `wrote ${r.count} HTTP fixtures to ${r.file} (WebSocket traffic is not captured; write WS fixtures by hand)` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const { findProjectRoot } = await import("./cli.mjs");
  const { importProjectVite, loadOptions, optionsFile } = await import("./env.mjs");
  const root = findProjectRoot(process.cwd());
  /** @type {string[]} */
  let redact = [];
  if (optionsFile(root)) {
    const o = await loadOptions(root, await importProjectVite(root));
    if (!o.ok) { process.stderr.write(o.error + "\n"); process.exit(1); }
    redact = o.options.redact ?? [];
  }
  const { code, out } = await run(process.argv.slice(2), { redact });
  (code ? process.stderr : process.stdout).write(out + "\n");
  process.exit(code);
}
