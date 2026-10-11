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
import { existsSync, type FSWatcher, mkdtempSync, readFileSync, rmSync, statSync, watch, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import type { CliIO, CliRun } from "../cli-io.js";
import { realInside } from "../util/confine.js";
import { LockError, withStyleLockAsync } from "../variants/style.js";

/** Media extensions the asset route will serve. */
const ASSET_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

/**
 * Serve a media file sitting beside the deck, same-origin.
 *
 * A `file://` clip taints the canvas and then cannot be uploaded as a WebGL
 * texture, so a video layer needs its clip to come from the page's own
 * origin. Returns true once the response is handled.
 *
 * Confinement is not optional: `new URL()` collapses plain dot-segments but
 * leaves `%2f` encoded, so a path like `/a%2f..%2f..%2fsecret.png` still
 * decodes into a real traversal. The resolved path is checked against the
 * deck directory for exactly that case.
 */
function serveAsset(pathname: string, deckDir: string, res: ServerResponse): boolean {
  const ext = extname(pathname).toLowerCase();
  const type = ASSET_TYPES[ext];
  if (!type) return false;
  const target = resolve(deckDir, decodeURIComponent(pathname.replace(/^\/+/, "")));
  if (!target.startsWith(deckDir + sep) || !existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return true;
  }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(readFileSync(target));
  return true;
}

export interface ServeOptions {
  /** 0 (the default) asks the OS for a free port. */
  port?: number;
  /** Run the fit check out of band after each rebuild. */
  check?: boolean;
  /** Debounce window for a burst of writes. */
  debounceMs?: number;
  io?: CliIO;
  /**
   * The CLI entry point, injected. `serve` drives `parse` and `render` through
   * it but must NOT import `cli.ts`, which imports this module — see
   * `cli-io.ts` for the cycle (and the exit-13 bug) that direction caused.
   */
  run: CliRun;
}

export interface ServeHandle {
  url: string;
  host: string;
  port: number;
  /** Path of the built artifact (no reload client). */
  htmlPath: string;
  /** Resolves once any in-flight rebuild has settled. */
  settled: () => Promise<void>;
  /** Number of rebuilds run so far (the initial build counts as 1). */
  rebuilds: () => number;
  /** Last rebuild error, or null when the last rebuild succeeded. */
  lastError: () => string | null;
  /** Findings from the last `--check` pass, by slide id. */
  findings: () => Record<string, string[]>;
  close: () => Promise<void>;
}

const HOST = "127.0.0.1";

/** How often `deck.json` is re-digested to catch an out-of-band override write. */
const JSON_POLL_MS = 150;

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
  // \`?variant=<step>:<name>\` previews a candidate in memory. \`V\` steps to the
  // next variant of that step; it does nothing without the param, and never
  // while a text field has focus.
  const variant = window.__DECK3D_VARIANT;
  if (variant) {
    window.addEventListener("keydown", (e) => {
      if ((e.key !== "v" && e.key !== "V") || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = document.activeElement;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      const next = variant.names[(variant.names.indexOf(variant.name) + 1) % variant.names.length];
      const u = new URL(location.href);
      u.searchParams.set("variant", variant.step + ":" + next);
      location.href = u.toString();
    });
  }
  if (window.__DECK3D_VARIANT_NOTICE) {
    const n = document.createElement("div");
    n.id = "deck3d-variant-notice";
    n.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9998;padding:8px 14px;border-radius:8px;background:#3b2d0d;color:#fde68a;font:12px/1.4 system-ui,sans-serif";
    n.textContent = window.__DECK3D_VARIANT_NOTICE;
    document.body.appendChild(n);
  }
  es.addEventListener("findings", (e) => {
    window.__deck3dFindings = JSON.parse(e.data);
    window.dispatchEvent(new CustomEvent("deck3d-findings"));
  });
})();
</script>`;

const quietIO: CliIO = { stdout: () => {}, stderr: () => {} };

export async function startServe(mdPath: string, opts: ServeOptions): Promise<ServeHandle> {
  const run = opts.run;
  const md = resolve(mdPath);
  const deckDir = dirname(md);
  const jsonPath = join(deckDir, `${basename(md, ".md")}.json`);
  const htmlPath = join(deckDir, `${basename(md, ".md")}.html`);
  const io = opts.io ?? quietIO;
  const debounceMs = opts.debounceMs ?? 120;

  let html: string | null = null;
  let rebuildCount = 0;
  /** A change arrived while a pick (or another writer) held the deck lock; rebuild once it is free. */
  let deferred = false;
  /** Last seen signature of style.json + asset files (see `sideSignature`). */
  let sideSig = "";
  const stylePath = join(deckDir, "style.json");
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

  /**
   * Same for deck assets: serving is an authoring context, so replacing an
   * asset file re-pins its `sha256` instead of failing the render on a stale one.
   */
  function repinAssets(): void {
    if (!existsSync(jsonPath)) return;
    let ir: { overrides?: { assets?: Array<{ path: string; sha256: string }> } };
    try {
      ir = JSON.parse(readFileSync(jsonPath, "utf8")) as typeof ir;
    } catch {
      return;
    }
    let touched = false;
    for (const a of ir.overrides?.assets ?? []) {
      const file = resolve(deckDir, a.path);
      if (!realInside(deckDir, file)) continue;
      const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
      if (a.sha256 !== sha) {
        a.sha256 = sha;
        touched = true;
      }
    }
    if (touched) writeFileSync(jsonPath, `${JSON.stringify(ir, null, 2)}\n`);
  }

  /** True while `style.json` records a half-written pick. */
  function stylePending(): boolean {
    try {
      const st = JSON.parse(readFileSync(stylePath, "utf8")) as { steps?: Array<{ pending?: boolean }> };
      return (st.steps ?? []).some((x) => x.pending === true);
    } catch {
      return false;
    }
  }

  /** Signature of everything outside deck.md/deck.json whose change must rebuild: style.json + asset files. */
  function sideSignature(): string {
    const parts: string[] = [existsSync(stylePath) ? createHash("sha256").update(readFileSync(stylePath)).digest("hex") : "-"];
    try {
      const ir = JSON.parse(readFileSync(jsonPath, "utf8")) as { overrides?: { assets?: Array<{ path: string }> } };
      for (const a of ir.overrides?.assets ?? []) {
        const file = resolve(deckDir, a.path);
        parts.push(existsSync(file) ? `${a.path}:${statSync(file).size}:${statSync(file).mtimeMs}` : `${a.path}:-`);
      }
    } catch {
      // A broken deck.json is the parse step's problem.
    }
    return parts.join("|");
  }

  /**
   * Digest of `deck.json` as the last rebuild left it. Every rebuild rewrites
   * that file (`parse -o`), so a bare watcher on it would re-trigger itself
   * forever; comparing the digest tells a foreign write from our own.
   */
  let jsonDigest = "";
  const digestJson = (): string => (existsSync(jsonPath) ? createHash("sha256").update(readFileSync(jsonPath)).digest("hex") : "");

  /**
   * True while a rebuild is running. Its own `parse` rewrites deck.json before
   * `jsonDigest` is refreshed, so the poll must not read that mid-flight write
   * as a foreign edit (it queued a spurious second rebuild).
   */
  let rebuilding = false;

  /**
   * A rebuild rewrites deck.json (parse, re-pins), so it runs under the same
   * lock as `variants pick|note|replay`. While another process holds it the
   * rebuild is deferred (not failed): the poll retries once the lock is free.
   */
  async function rebuild(): Promise<void> {
    try {
      await withStyleLockAsync(deckDir, runRebuild, { waitMs: 0 });
    } catch (err) {
      if (!(err instanceof LockError)) throw err;
      deferred = true;
    }
  }

  async function runRebuild(): Promise<void> {
    rebuilding = true;
    rebuildCount++;
    const errors: string[] = [];
    const collect: CliIO = { stdout: () => {}, stderr: (m) => errors.push(m) };
    try {
      if ((await run(["parse", md, "-o", jsonPath], collect)) !== 0) throw new Error(errors.join("\n") || "parse failed");
      repinLocalFx();
      repinAssets();
      // Render to a scratch file: the served copy carries the reload client,
      // and the deck-dir artifact must not.
      const scratchDir = mkdtempSync(join(tmpdir(), "deck3d-serve-out-"));
      let built: string;
      try {
        const scratch = join(scratchDir, "deck.html");
        if ((await run(["render", jsonPath, "-o", scratch], collect)) !== 0) throw new Error(errors.join("\n") || "render failed");
        built = readFileSync(scratch, "utf8");
      } finally {
        // One scratch dir per rebuild: remove it on success AND on a failed render.
        rmSync(scratchDir, { recursive: true, force: true });
      }
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
    } finally {
      jsonDigest = digestJson();
      rebuilding = false;
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
    // A rebuild reads the files as they are NOW, so the change it is about to
    // absorb must not be reported again by the poll.
    sideSig = sideSignature();
    building = building.then(rebuild);
  }

  sideSig = sideSignature();
  await (building = rebuild());

  let timer: NodeJS.Timeout | null = null;
  const watchers: FSWatcher[] = [];
  const fire = (): void => {
    if (stylePending()) {
      deferred = true;
      return;
    }
    deferred = false;
    queue();
  };
  const onChange = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, debounceMs);
  };

  const watchPath = (p: string, recursive = false, handler: () => void = onChange): void => {
    if (!existsSync(p)) return;
    try {
      watchers.push(watch(p, { recursive }, handler));
    } catch {
      // A platform without recursive watch still gets the deck.md watcher.
    }
  };
  watchPath(md);
  watchPath(join(deckDir, "fx"), true);
  // `deck3d overrides apply` and a hand edit are writers too, not just the
  // HTTP endpoints. Polled rather than watched: macOS delivers `fs.watch`
  // events for this file seconds late, and the rebuild rewrites it anyway, so
  // a digest compare is both the change detector and the self-write filter.
  const jsonPoll = setInterval(() => {
    if (rebuilding) return;
    // A rebuild deferred by a pending pick runs as soon as the marker clears.
    if (deferred && !stylePending()) {
      sideSig = sideSignature();
      fire();
      return;
    }
    const side = sideSignature();
    if (side !== sideSig) {
      sideSig = side;
      onChange();
      return;
    }
    if (digestJson() === jsonDigest) return;
    onChange();
  }, JSON_POLL_MS);
  jsonPoll.unref();

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
      if (serveAsset(url.pathname, deckDir, res)) return;
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
          try {
            // Read-merge-write under the deck lock, so a concurrent pick cannot be overwritten.
            await withStyleLockAsync(
              deckDir,
              async () => {
                const ir = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
                ir.overrides = deepMerge((ir.overrides ?? {}) as Record<string, unknown>, patch as Record<string, unknown>);
                writeFileSync(target, `${JSON.stringify(ir, null, 2)}\n`);
              },
              { waitMs: 3000 },
            );
          } catch (e) {
            if (!(e instanceof LockError)) throw e;
            res.writeHead(409, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: e.message }));
            return;
          }
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
      // `?variant=<step>:<name>`: the candidate rendered in memory — nothing is written.
      const wanted = url.searchParams.get("variant");
      let body = html;
      if (wanted) {
        const [stepId, name] = wanted.split(":");
        const { readStyle } = await import("../variants/style.js");
        const step = readStyle(stylePath)?.steps.find((x) => x.id === stepId);
        const variant = step?.variants.find((v) => v.name === name);
        if (step && variant) {
          const { renderWithFragment } = await import("../variants/render.js");
          const info = JSON.stringify({ step: step.id, name: variant.name, names: step.variants.map((v) => v.name) }).replace(/</g, "\\u003c");
          const rendered = await renderWithFragment(jsonPath, variant.overrides);
          body = rendered.replace("<body>", `<body><script>window.__DECK3D_VARIANT=${info};</script>`).replace("</body>", `${CLIENT}</body>`);
        } else {
          const notice = JSON.stringify(`Unknown variant '${wanted}': showing the deck without variants.`).replace(/</g, "\\u003c");
          body = html.replace("<body>", `<body><script>window.__DECK3D_VARIANT_NOTICE=${notice};</script>`);
        }
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(body);
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
    rebuilds: () => rebuildCount,
    lastError: () => lastError,
    findings: () => findings,
    close: async () => {
      for (const w of watchers) w.close();
      clearInterval(jsonPoll);
      if (timer) clearTimeout(timer);
      for (const c of clients) c.end();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
