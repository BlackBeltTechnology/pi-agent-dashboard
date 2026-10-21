/**
 * `sendIndexWithImportMap`: the ONE function every HTML response built from the production
 * `index.html` passes (`/`, `/index.html`, the SPA not-found fallbacks, the `--dev` fallback).
 * It reads the plain `index.html` (never its `.gz`, mtime-cached), inserts the static host import map
 * before the first module script / modulepreload, and answers `no-cache`.
 *
 * `nonce` is optional: set it once the baseline CSP adopts per-response script nonces, so the
 * inline map keeps working under a tightened `script-src` (BCSP). Today's baseline allows inline.
 *
 * See change: decouple-plugins-from-core (task 6.4, design D21).
 */
import fs from "node:fs";
import path from "node:path";
import { hostImportMapJson } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/host-import-map.js";
import type { FastifyReply } from "fastify";

const INDEX_HTML_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

const FIRST_MODULE_ENTRY = /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*>|<link\b[^>]*\brel\s*=\s*["']?modulepreload["']?[^>]*>/i;

/** Pure: `html` with one import-map `<script>` inserted before the first module script / modulepreload (else before `</head>`, else first). */
export function injectImportMap(html: string, opts: { nonce?: string } = {}): string {
  const nonceAttr = opts.nonce ? ` nonce="${opts.nonce.replace(/[^A-Za-z0-9+/=_-]/g, "")}"` : "";
  const tag = `<script type="importmap"${nonceAttr}>${hostImportMapJson()}</script>`;
  const at = html.search(FIRST_MODULE_ENTRY);
  if (at >= 0) return `${html.slice(0, at)}${tag}\n    ${html.slice(at)}`;
  const head = html.search(/<\/head>/i);
  if (head >= 0) return `${html.slice(0, head)}${tag}\n${html.slice(head)}`;
  return `${tag}\n${html}`;
}

export interface IndexHtmlSender {
  /** Send `index.html` + import map; resolves the reply. */
  sendIndexWithImportMap(reply: FastifyReply, opts?: { nonce?: string }): Promise<FastifyReply>;
}

/** Sender over `<clientDir>/index.html`. The mtime-cached read holds the raw file; the map is inserted per call (nonce varies). */
export function createIndexHtmlSender(clientDir: string): IndexHtmlSender {
  const file = path.join(clientDir, "index.html");
  let cached: { mtimeMs: number; size: number; html: string } | undefined;

  function read(): string {
    const st = fs.statSync(file);
    if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
      cached = { mtimeMs: st.mtimeMs, size: st.size, html: fs.readFileSync(file, "utf-8") };
    }
    return cached.html;
  }

  return {
    async sendIndexWithImportMap(reply, opts) {
      let html: string;
      try {
        html = injectImportMap(read(), opts);
      } catch {
        return reply.code(404).send({ error: "index.html not found" });
      }
      return reply.code(200).header("Cache-Control", INDEX_HTML_CACHE_CONTROL).type("text/html; charset=utf-8").send(html);
    },
  };
}
