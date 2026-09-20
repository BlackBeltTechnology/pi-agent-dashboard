/**
 * `deck3d serve` — the authoring server (Section 15).
 *
 * Closes the tune round trip: watch the deck's sources, rebuild on change,
 * live-reload the open browser onto the slide it was already on, and let the
 * configurator write its overrides straight to disk.
 *
 * SECURITY POSTURE. This server accepts browser-driven filesystem WRITES, so:
 * it binds `127.0.0.1` only (never `0.0.0.0`), every write target is resolved
 * and confined to the served deck's own directory, and every payload is
 * IR-validated BEFORE anything is written — a rejected payload leaves the
 * target byte-identical.
 *
 * The reload client is injected into the SERVED copy only. The on-disk build
 * artifact stays self-contained and offline, so `serve` never changes what
 * `build` produces.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { mkdtempSync } from "node:fs";
import { run } from "../cli.js";
import type { CliIO } from "../cli.js";

export interface ServeOptions {
  /** 0 (the default) asks the OS for a free port. */
  port?: number;
  /** Run the fit check out of band after each rebuild. */
  check?: boolean;
  /** Debounce window for a burst of writes. */
  debounceMs?: number;
  io?: CliIO;
}

export interface ServeHandle {
  url: string;
  host: string;
  port: number;
  /** Path of the built artifact (no reload client). */
  htmlPath: string;
  /** Resolves once any in-flight rebuild has settled. */
  settled: () => Promise<void>;
  /** Last rebuild error, or null when the last rebuild succeeded. */
  lastError: () => string | null;
  /** Findings from the last `--check` pass, by slide id. */
  findings: () => Record<string, string[]>;
  close: () => Promise<void>;
}

const HOST = "127.0.0.1";

/** Injected only into the served HTML. Reloads in place, keeping the slide. */
const CLIENT = `<script>
(() => {
  // Position survives the reload: the runtime keeps the slide in location.hash,
  // so a plain reload lands where the author was. Staged configurator values
  // live in localStorage and are replayed by the panel itself.
  window.__deck3dServe = true;
  const es = new EventSource("/__events");
  es.addEventListener("rebuild", () => location.reload());
  es.addEventListener("error-report", (e) => {
    let box = document.getElementById("deck3d-serve-error");
    if (!box) {
      box = document.createElement("pre");
      box.id = "deck3d-serve-error";
      box.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;margin:0;padding:10px;max-height:40vh;overflow:auto;background:#3b0d0d;color:#fecaca;font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap";
      document.body.appendChild(box);
    }
    box.textContent = JSON.parse(e.data).message;
  });
  es.addEventListener("ok", () => document.getElementById("deck3d-serve-error")?.remove());
  es.addEventListener("findings", (e) => {
    window.__deck3dFindings = JSON.parse(e.data);
    window.dispatchEvent(new CustomEvent("deck3d-findings"));
  });
})();
</script>`;

const quietIO: CliIO = { stdout: () => {}, stderr: () => {} };

export async function startServe(mdPath: string, opts: ServeOptions = {}): Promise<ServeHandle> {
  const md = resolve(mdPath);
  const deckDir = dirname(md);
  const jsonPath = join(deckDir, `${basename(md, ".md")}.json`);
  const htmlPath = join(deckDir, `${basename(md, ".md")}.html`);
  const io = opts.io ?? quietIO;
  const debounceMs = opts.debounceMs ?? 120;

  let html: string | null = null;
  let lastError: string | null = null;
  let findings: Record<string, string[]> = {};
  let building: Promise<void> = Promise.resolve();
  const clients = new Set<import("node:http").ServerResponse>();

  function emit(event: string, data: unknown): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) c.write(payload);
  }

  /**
   * Re-pin every local module's hash before rendering: the author is editing
   * `fx/*.js` live, and the render refuses on a stale `sha256`. Serving is an
   * authoring context, so the pin follows the file rather than gating it.
   */
  function repinLocalFx(): void {
    if (!existsSync(jsonPath)) return;
    let ir: { overrides?: { slides?: Record<string, { effects?: Array<{ id: string; sha256?: string }> }>; effects?: Array<{ id: string; sha256?: string }> } };
    try {
      ir = JSON.parse(readFileSync(jsonPath, "utf8")) as typeof ir;
    } catch {
      return;
    }
    let touched = false;
    const lists = [ir.overrides?.effects, ...Object.values(ir.overrides?.slides ?? {}).map((s) => s.effects)];
    for (const list of lists) {
      for (const ref of list ?? []) {
        if (!ref.id?.startsWith("local:")) continue;
        const file = join(deckDir, "fx", `${ref.id.slice("local:".length)}.js`);
        if (!existsSync(file)) continue;
        const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
        if (ref.sha256 !== sha) {
          ref.sha256 = sha;
          touched = true;
        }
      }
    }
    if (touched) writeFileSync(jsonPath, `${JSON.stringify(ir, null, 2)}\n`);
  }

  async function rebuild(): Promise<void> {
    const errors: string[] = [];
    const collect: CliIO = { stdout: () => {}, stderr: (m) => errors.push(m) };
    try {
      if ((await run(["parse", md, "-o", jsonPath], collect)) !== 0) throw new Error(errors.join("\n") || "parse failed");
      repinLocalFx();
      // Render to a scratch file: the served copy carries the reload client,
      // and the deck-dir artifact must not.
      const scratch = join(mkdtempSync(join(tmpdir(), "deck3d-serve-out-")), "deck.html");
      if ((await run(["render", jsonPath, "-o", scratch], collect)) !== 0) throw new Error(errors.join("\n") || "render failed");
      const built = readFileSync(scratch, "utf8");
      writeFileSync(htmlPath, built);
      html = built.replace("</body>", `${CLIENT}</body>`);
      lastError = null;
      emit("ok", {});
      emit("rebuild", {});
      if (opts.check) void runCheck();
    } catch (err) {
      // Last good deck stays served — an unparseable buffer mid-edit must not
      // blank the author's screen.
      lastError = (err as Error).message;
      io.stderr(`deck3d serve: ${lastError}`);
      emit("error-report", { message: lastError });
    }
  }

  /** Out of band by contract: the reload already happened. */
  async function runCheck(): Promise<void> {
    try {
      const { runCheck: check, parseViewports } = await import("../check/index.js");
      const report = await check(htmlPath, { viewports: parseViewports(undefined) });
      const next: Record<string, string[]> = {};
      for (const v of report.viewports) {
        for (const f of v.findings) (next[f.slide] ??= []).push(`${v.viewport} ${f.rule}: ${f.detail ?? ""}`.trim());
      }
      findings = next;
      emit("findings", findings);
    } catch {
      // Check is advisory here; a missing browser must not break serving.
    }
  }

  function queue(): void {
    building = building.then(rebuild);
  }

  await (building = rebuild());

  let timer: NodeJS.Timeout | null = null;
  const watchers: FSWatcher[] = [];
  const onChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(queue, debounceMs);
  };
  const watchPath = (p: string, recursive = false): void => {
    if (!existsSync(p)) return;
    try {
      watchers.push(watch(p, { recursive }, onChange));
    } catch {
      // A platform without recursive watch still gets the deck.md watcher.
    }
  };
  watchPath(md);
  watchPath(join(deckDir, "fx"), true);

  function jsonBody(req: import("node:http").IncomingMessage): Promise<unknown> {
    return new Promise((res, rej) => {
      let raw = "";
      req.on("data", (c) => {
        raw += c;
        // A write endpoint takes an overrides document, not a stream.
        if (raw.length > 1_000_000) rej(new Error("payload too large"));
      });
      req.on("end", () => {
        try {
          res(JSON.parse(raw));
        } catch (e) {
          rej(e as Error);
        }
      });
    });
  }

  /** Confines a caller-supplied name to the deck directory. */
  function safeTarget(name: string): string | null {
    const target = resolve(deckDir, name);
    return target === deckDir || target.startsWith(deckDir + sep) ? target : null;
  }

  async function validPayload(patch: unknown): Promise<string | null> {
    const { validate } = await import("../ir/validate.js");
    const { deepMerge } = await import("../ir/merge.js");
    const base = JSON.parse(readFileSync(jsonPath, "utf8")) as { overrides?: unknown };
    const merged = { ...base, overrides: deepMerge((base.overrides ?? {}) as Record<string, unknown>, patch as Record<string, unknown>) };
    const result = validate(merged, { deckDir });
    return result.errors.length ? result.errors.map((e) => `${e.path}: ${e.message}`).join("; ") : null;
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${HOST}`);
    void (async () => {
      if (url.pathname === "/__events") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (req.method === "POST" && (url.pathname === "/__overrides" || url.pathname === "/__apply")) {
        const target = safeTarget(url.searchParams.get("path") ?? (url.pathname === "/__apply" ? basename(jsonPath) : "overrides.json"));
        if (!target) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "path escapes the deck directory" }));
          return;
        }
        let patch: unknown;
        try {
          patch = await jsonBody(req);
        } catch (e) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: (e as Error).message }));
          return;
        }
        // Validate BEFORE touching either file.
        const invalid = await validPayload(patch);
        if (invalid) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: invalid }));
          return;
        }
        if (url.pathname === "/__apply") {
          const { deepMerge } = await import("../ir/merge.js");
          const ir = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
          ir.overrides = deepMerge((ir.overrides ?? {}) as Record<string, unknown>, patch as Record<string, unknown>);
          writeFileSync(target, `${JSON.stringify(ir, null, 2)}\n`);
          await (building = building.then(rebuild));
        } else {
          writeFileSync(target, `${JSON.stringify(patch, null, 2)}\n`);
        }
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, wrote: basename(target) }));
        return;
      }
      if (html == null) {
        res.writeHead(503, { "content-type": "text/plain" });
        res.end(lastError ?? "building");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    })().catch((err: Error) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(err.message);
    });
  });

  await new Promise<void>((done) => server.listen(opts.port ?? 0, HOST, done));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://${HOST}:${port}`,
    host: HOST,
    port,
    htmlPath,
    settled: async () => {
      // One debounce window plus the queued rebuild.
      await new Promise((r) => setTimeout(r, debounceMs + 60));
      await building;
    },
    lastError: () => lastError,
    findings: () => findings,
    close: async () => {
      for (const w of watchers) w.close();
      if (timer) clearTimeout(timer);
      for (const c of clients) c.end();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
