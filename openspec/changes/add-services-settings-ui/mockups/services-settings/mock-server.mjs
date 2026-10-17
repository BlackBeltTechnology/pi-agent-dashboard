#!/usr/bin/env node
// Mock server for the add-services-settings-ui UX mockup.
// Zero deps. Serves the static mockup + fixture `/api/services*` routes whose
// shapes mirror packages/server/src/services/{routes,service-manager}.ts and the
// NEW routes proposed in this change (logs, reset-data, prune, leaseHolders).
// Mock-only transport: the `services_changed` ping is delivered over SSE at
// `/mock/events` (the real server uses the browser WebSocket, design D3).
// Usage: node mock-server.mjs [port]   (default 4610)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 4610);
const now = () => Date.now();
const iso = (ms) => new Date(ms).toISOString();

// ── Fixtures: one service per interesting state ────────────────────────────
const S = (o) => ({ pinned: false, leases: 0, leaseHolders: [], secrets: {}, ...o });
let services = [
  S({ id: "docling", mode: "managed", state: "healthy", driver: "oci:podman", endpoints: { http: "http://127.0.0.1:41231" }, exposure: "loopback", startedBy: "dashboard", leases: 2,
      leaseHolders: [{ holder: "session 01a13cad · document-converter", expiresAt: iso(now() + 240e3) }, { holder: "pi-dashboard service exec", expiresAt: iso(now() + 95e3) }],
      origin: { package: "@blackbelt-technology/pi-docling-skill", version: "1.0.0", templateHash: "9f2c1e" }, secrets: { apikey: { configured: true } },
      _def: { volumes: ["docling-cache"], secretSources: { apikey: "store:docling/apikey (generated, 32 bytes)" }, image: "ghcr.io/docling-project/docling-serve@sha256:4b1d…9e0a" } }),
  S({ id: "neo4j-graph", mode: "managed", state: "unavailable", reason: "runtime-unreachable", hint: "Docker is installed but its engine is not running. Start Docker Desktop, then retry.",
      tried: [{ driver: "oci:docker", reason: "runtime-unreachable" }, { driver: "oci:podman", reason: "host-vm-stopped" }],
      origin: { package: "@blackbelt-technology/pi-docling-graph", version: "0.4.2", templateHash: "a17e03" }, secrets: { password: { configured: true } },
      _def: { volumes: ["neo4j-graph-data", "neo4j-graph-logs"], secretSources: { password: "store:neo4j-graph/password (user-entered)" }, image: "docker.io/library/neo4j@sha256:77aa…c210" } }),
  S({ id: "pi-doc-engine", mode: "managed", state: "idle", driver: "native", endpoints: { http: "http://127.0.0.1:43807" }, exposure: "loopback", startedBy: "dashboard", pinned: true,
      origin: { package: "@blackbelt-technology/pi-doc-engine", version: "2.3.1", templateHash: "c0ffee" },
      _def: { volumes: [], recipe: "uvx pi-doc-engine@2.3.1 serve --port ${port.http}" } }),
  S({ id: "markitdown-mcp", mode: "managed", state: "unavailable", reason: "package-absent", hint: "markitdown-mcp@0.0.1a4 is not in the local npx cache. Prefetch it once; starts never download.",
      tried: [{ driver: "native", reason: "package-absent" }], origin: { package: "@blackbelt-technology/pi-dashboard-document-converter", version: "1.8.0", templateHash: "51d2aa" },
      _def: { volumes: [], recipe: "npx --no markitdown-mcp@0.0.1a4 --http --port ${port.http}" } }),
  S({ id: "obs-studio", mode: "attached", state: "healthy", driver: "attached", endpoints: { ws: "ws://127.0.0.1:4455" }, exposure: "loopback", startedBy: "external", leases: 1,
      leaseHolders: [{ holder: "obs-studio-plugin", expiresAt: iso(now() + 180e3) }], origin: "user", secrets: { password: { configured: false } },
      _def: { volumes: [], secretSources: { password: "keychain:obs-websocket/robson" } } }),
  S({ id: "ollama", mode: "external", state: "healthy", driver: "external", endpoints: { http: "http://127.0.0.1:11434" }, exposure: "all-interfaces", origin: "user", _def: { volumes: [] } }),
  S({ id: "gotenberg", mode: "managed", state: "failed", driver: "oci:docker", retryAt: iso(now() + 75e3), hint: "Container exited during start (exit 1). See logs.",
      origin: { package: "@blackbelt-technology/pi-doc-engine", version: "2.3.1", templateHash: "77b0e4" }, _def: { volumes: [], image: "docker.io/gotenberg/gotenberg@sha256:e91f…0b37" } }),
  S({ id: "comfyui", mode: "managed", state: "blocked", driver: "oci:podman", hint: "Process is alive but /health has failed for 3 min. The dashboard will not kill it; stop it explicitly if it is stuck.",
      origin: "user", _def: { volumes: ["comfyui-models"], image: "ghcr.io/ai-dock/comfyui@sha256:0c5e…11fd" } }),
  S({ id: "whisper-asr", mode: "managed", state: "stop-failed", driver: "native", hint: "No exit observed within 15 s of SIGTERM/SIGKILL to the process group.",
      origin: { package: "@blackbelt-technology/pi-video-transcription", version: "0.9.0", templateHash: "be11e5" }, _def: { volumes: [], recipe: "uvx whisper-asr-webservice@1.6.0" } }),
  S({ id: "qdrant", mode: "managed", state: "unavailable", reason: "adoption-uncertain", hint: "pid 48213 is alive but its command line no longer names qdrant. Force stop to override the PID-reuse check, or remove.",
      origin: "user", _def: { volumes: ["qdrant-storage"], recipe: "uvx qdrant-client-server@1.12.0" } }),
  S({ id: "mermaid-renderer", mode: "managed", state: "stopped", driver: "oci:podman", updateAvailable: true,
      diff: [{ path: "oci.image", from: "ghcr.io/mermaid-js/mermaid-cli@sha256:1a2b…", to: "ghcr.io/mermaid-js/mermaid-cli@sha256:9f8e…" }, { path: "startTimeoutSec", from: 120, to: 60 }],
      origin: { package: "@blackbelt-technology/pi-doc-engine", version: "2.3.1", templateHash: "0d0d0d" }, _def: { volumes: ["mermaid-renderer-cache"], image: "ghcr.io/mermaid-js/mermaid-cli@sha256:1a2b…77c1" } }),
  S({ id: "searxng", mode: "managed", state: "starting", driver: "oci:docker", restartRequired: true, origin: "user", _def: { volumes: [], image: "docker.io/searxng/searxng@sha256:3c4d…aa01" } }),
];
const offers = [
  { ref: "@blackbelt-technology/pi-docling-skill#docling", package: "@blackbelt-technology/pi-docling-skill", version: "1.0.0", id: "docling", mode: "managed", templateHash: "9f2c1e", added: true },
  { ref: "@blackbelt-technology/pi-kb-plugin#kb-embedder", package: "@blackbelt-technology/pi-kb-plugin", version: "3.2.0", id: "kb-embedder", mode: "managed", templateHash: "e4e4e4", added: false },
  { ref: "@blackbelt-technology/pi-voiceid#pi-voiceid", package: "@blackbelt-technology/pi-voiceid", version: "0.3.0", id: "pi-voiceid", mode: "managed", templateHash: "7a7a7a", added: false },
];
const runtimes = [
  { id: "podman", kind: "container", installed: true, version: "5.6.1", reachable: true, hostVm: "running", capabilities: { create: "ok", start: "ok", stop: "ok", remove: "ok-destructive", hostVmControl: "unsupported" } },
  { id: "docker", kind: "container", installed: true, version: "29.1.3", reachable: false, hostVm: "stopped", capabilities: { create: "unavailable", start: "unavailable", stop: "unavailable", remove: "unavailable", hostVmControl: "unsupported" } },
  { id: "qemu", kind: "hypervisor", installed: true, version: "10.1.0", capabilities: { snapshot: "cli-present", suspend: "cli-present", logs: "unsupported" } },
  { id: "virtualbox", kind: "hypervisor", installed: false, capabilities: { snapshot: "unavailable", suspend: "unavailable" } },
  { id: "vmware", kind: "hypervisor", installed: true, version: "13.6.2", capabilities: { snapshot: "needs-secret", suspend: "ok", logs: "unsupported" } },
];
const orphans = [
  { kind: "container", runtime: "podman", id: "3f9a1c2b7d10", service: "kb-embedder-old" },
  { kind: "run-dir", path: "~/.pi/dashboard/services-run/tika/" },
];
const LOGS = {
  docling: ["INFO:     Started server process [1]", "INFO:     Waiting for application startup.", "INFO:     Application startup complete.", "INFO:     Uvicorn running on http://0.0.0.0:5001", "INFO:     auth key «secret:apikey» accepted", "INFO:     127.0.0.1:52144 - \"POST /v1/convert/file HTTP/1.1\" 200 OK", "INFO:     127.0.0.1:52151 - \"GET /health HTTP/1.1\" 200 OK"],
  gotenberg: ["[SYSTEM] modules: api chromium libreoffice", "{\"level\":\"error\",\"msg\":\"chromium: start: exec: \\\"chromium\\\": executable file not found\"}", "<script>alert('logs render as text')</script>", "exit status 1"],
  "whisper-asr": ["Loading model large-v3 …", "Model loaded in 41.2 s", "SIGTERM received, draining 2 jobs"],
  comfyui: ["Starting server", "To see the GUI go to: http://0.0.0.0:8188", "torch.cuda.OutOfMemoryError: CUDA out of memory"],
};

// ── Mock controls ──────────────────────────────────────────────────────────
let role = "operate"; // "operate" | "observe"
const clients = new Set();
let pingTimer = null, pending = false;
function changed() { // leading + trailing coalescer, 500 ms (design D3)
  if (pingTimer) { pending = true; return; }
  for (const c of clients) c.write("data: {\"type\":\"services_changed\"}\n\n");
  pingTimer = setTimeout(() => { pingTimer = null; if (pending) { pending = false; changed(); } }, 500);
}
const later = (ms, fn) => setTimeout(() => { fn(); changed(); }, ms);
const pub = ({ _def, ...s }) => s;
const find = (id) => services.find((s) => s.id === id);
const err = (code, error, message) => ({ __status: code, success: false, error, message });
const operateRequired = () => ({ __status: 403, success: false, error: "operate_required", message: "Changing services needs operate authority.", reason: "tier-too-low", remedies: ["use-host", "re-pair", "sign-in"] });

function act(id, verb, body) {
  const s = find(id);
  if (!s) return err(404, "unknown-service", `no service ${id}`);
  switch (verb) {
    case "start":
      if (s.state === "unavailable" && s.reason === "runtime-unreachable") { s.hint = "Still not reachable (checked just now). " + "Start Docker Desktop, then try again."; return { state: "unavailable", reason: s.reason }; }
      if (!["stopped", "unavailable"].includes(s.state)) return err(409, "illegal-transition", `cannot start from ${s.state}`);
      delete s.reason; delete s.tried;
      Object.assign(s, { state: "starting" }); later(2500, () => Object.assign(s, { state: "healthy", startedBy: "dashboard", endpoints: s.endpoints ?? { http: "http://127.0.0.1:45" + Math.floor(100 + Math.random() * 899) } }));
      return { state: "starting" };
    case "stop":
      if (body?.force !== true && !["starting", "healthy", "idle", "blocked", "stop-failed"].includes(s.state)) return err(409, "illegal-transition", `cannot stop from ${s.state}`);
      Object.assign(s, { state: "stopping" }); later(1800, () => { Object.assign(s, { state: "stopped", leases: 0, leaseHolders: [] }); delete s.reason; delete s.hint; delete s.tried; delete s.endpoints; });
      return { state: "stopping" };
    case "retry":
      if (s.state !== "failed") return err(409, "illegal-transition", "retry only from failed");
      delete s.retryAt; Object.assign(s, { state: "starting" });
      later(2200, () => Object.assign(s, { state: "failed", retryAt: iso(now() + 10e3), hint: "Container exited during start (exit 1). See logs." }));
      return { state: "starting" };
    case "pin": s.pinned = true; return { pinned: true };
    case "unpin": s.pinned = false; return { pinned: false };
    case "prefetch":
      if (s.reason !== "package-absent" && s.state !== "stopped") return err(409, "nothing-to-fetch", "already present");
      later(2000, () => { s.state = "stopped"; delete s.reason; delete s.tried; s.hint = undefined; });
      return { fetched: true };
    case "reset-data":
      if (!["stopped", "unavailable"].includes(s.state)) return err(409, "not-stopped", "stop the service before resetting its data");
      if (!s._def.volumes.length) return err(409, "no-data", "this service declares no data volumes");
      return { removed: s._def.volumes };
    default: return err(404, "not-found", verb);
  }
}

async function route(req, url, body) {
  const p = url.pathname, m = req.method;
  const isWrite = m !== "GET" || /\/logs$/.test(p); // logs need operate (design D5)
  if (p.startsWith("/api/services") && isWrite && role !== "operate") return operateRequired();
  if (m === "GET" && p === "/api/services") return { services: services.map(pub), instanceId: "b7e1c0de-5a11-4c0f-9d2e-1f00d5e1ce55" };
  if (m === "GET" && p === "/api/services/offers") return { offers, errors: [] };
  if (m === "GET" && p === "/api/services/runtimes") return runtimes;
  if (p === "/api/services/prune" && m === "POST") return body?.dryRun ? { candidates: orphans } : { removed: orphans.splice(0) };
  if (m === "POST" && p === "/api/services") {
    const id = body.offer ? body.offer.split("#")[1] : body.definition?.id;
    if (!id) return err(400, "invalid-definition", "errors:\n- id: required\n- health: required");
    if (body.definition && Object.keys(body.definition).some((k) => !["id", "mode", "drivers", "oci", "native", "endpoints", "health", "secrets", "description", "lifecycle", "process", "idleStopMinutes"].includes(k)))
      return err(400, "invalid-definition", "errors:\n- unknown key: " + Object.keys(body.definition).filter((k) => !["id", "mode", "drivers", "oci", "native", "endpoints", "health", "secrets", "description", "lifecycle", "process", "idleStopMinutes"].includes(k)).join(", "));
    const review = { id, mode: body.definition?.mode ?? "managed", drivers: ["oci:podman", "native"], image: "ghcr.io/blackbelt-technology/" + id + "@sha256:5e5e…a0a0", ports: ["http → 127.0.0.1:<auto>"], volumes: [id + "-data"], binds: [], secrets: ["apikey"], secretSources: { apikey: `store:${id}/apikey (generated, 32 bytes)` }, needsPrefetch: true };
    if (body.dryRun) return { dryRun: true, review };
    if (find(id) && !body.update) return err(409, "exists", `${id} already defined`);
    if (body.update) { const s = find(id); delete s.updateAvailable; delete s.diff; changed(); return { dryRun: false, review }; }
    services.push(S({ id, mode: review.mode, state: "stopped", origin: body.offer ? { package: body.offer.split("#")[0], version: "x", templateHash: "new" } : "user", secrets: { apikey: { configured: true } }, _def: { volumes: review.volumes, secretSources: review.secretSources, image: review.image } }));
    const o = offers.find((x) => x.id === id); if (o) o.added = true;
    changed(); return { dryRun: false, review };
  }
  let mm;
  if ((mm = p.match(/^\/api\/services\/([^/]+)$/))) {
    const s = find(mm[1]);
    if (m === "GET") return s ? { ...pub(s), _def: s._def } : err(404, "unknown-service", "not defined");
    if (m === "DELETE") { services = services.filter((x) => x.id !== mm[1]); changed(); return { ok: true, purgedVolumes: url.searchParams.get("purgeData") === "true" ? s?._def.volumes ?? [] : [] }; }
  }
  if ((mm = p.match(/^\/api\/services\/([^/]+)\/logs$/)) && m === "GET") {
    const s = find(mm[1]); if (!s) return err(404, "unknown-service", "");
    if (s.mode === "external" || s.startedBy === "external") return { available: false, reason: "external" };
    if (s.id === "neo4j-graph") return { available: false, reason: "secret-unavailable" };
    if (!LOGS[s.id]) return { available: false, reason: s.state === "stopped" ? "not-started" : "no-output" };
    const tail = Math.min(Number(url.searchParams.get("tail") ?? 200), 2000);
    return { available: true, driver: s.driver, lines: LOGS[s.id].slice(-tail) };
  }
  if ((mm = p.match(/^\/api\/services\/([^/]+)\/secrets\/([^/]+)$/)) && m === "PUT") {
    const s = find(mm[1]); if (!s) return err(404, "unknown-service", "");
    if (typeof body?.value !== "string" || !body.value) return err(400, "bad-request", "value required");
    s.secrets[mm[2]] = { configured: true }; changed(); return { configured: true };
  }
  if ((mm = p.match(/^\/api\/services\/([^/]+)\/([a-z-]+)$/)) && m === "POST") {
    const r = act(mm[1], mm[2], body); if (!r.__status) changed(); return r;
  }
  return null;
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // Canvas embeds this in a sandboxed (opaque-origin) iframe under /live/<id>/:
  // module scripts, fetches and SSE are CORS requests with `Origin: null`.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "600" });
    res.end(); return;
  }
  if (url.pathname === "/mock/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
    res.write(": hi\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (url.pathname === "/mock/role") { if (req.method === "POST") { role = role === "operate" ? "observe" : "operate"; changed(); } res.end(JSON.stringify({ role })); return; }
  if (url.pathname.startsWith("/api/")) {
    let raw = ""; for await (const c of req) raw += c;
    let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    await new Promise((r) => setTimeout(r, 120)); // visible latency
    const out = await route(req, url, body);
    if (out === null) { res.writeHead(404); res.end(); return; }
    const status = out.__status ?? 200; delete out.__status;
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(status === 200 ? { success: true, data: out } : out));
    return;
  }
  const file = join(DIR, url.pathname === "/" ? "index.html" : url.pathname.replace(/\.\.+/g, ""));
  try { const b = await readFile(file); res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end("not found"); }
}).listen(PORT, "0.0.0.0", () => console.log(`services mockup: http://localhost:${PORT}/`));
