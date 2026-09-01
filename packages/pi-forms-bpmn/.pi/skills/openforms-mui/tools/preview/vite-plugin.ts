/**
 * Dev-only Vite plugin backing the preview harness. Serves the target schema at
 * `/__schema.json`, injects the reference-mode flag, and — for a local file —
 * watches it and pushes a custom HMR event so the client re-renders on save
 * while preserving entered answers (live schema reload).
 */
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export function harnessPlugin(schemaSource: string, reference: boolean): Plugin {
  const isUrl = /^https?:\/\//.test(schemaSource);
  return {
    name: "openforms-harness",
    configureServer(server) {
      server.middlewares.use("/__schema.json", async (_req, res) => {
        try {
          const body = isUrl ? await (await fetch(schemaSource)).text() : readFileSync(schemaSource, "utf8");
          res.setHeader("Content-Type", "application/json");
          res.end(body);
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });
      if (!isUrl) {
        server.watcher.add(schemaSource);
        server.watcher.on("change", (file) => {
          if (file === schemaSource) {
            server.ws.send({ type: "custom", event: "ofm:schema-changed" });
          }
        });
      }
    },
    transformIndexHtml(html) {
      return html.replace(
        "<!--OFM_CONFIG-->",
        `<script>window.__OFM_REFERENCE__=${reference ? "true" : "false"};</script>`,
      );
    },
  };
}
