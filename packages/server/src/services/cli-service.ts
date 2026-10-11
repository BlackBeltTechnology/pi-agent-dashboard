/**
 * `pi-dashboard service <verb>` — the CLI half of the consumer contract (D9).
 *
 *   ensure|heartbeat|release|exec|list|status|start|stop|retry|pin|unpin|
 *   add|remove|prefetch|secret
 *
 * Exit rule for every verb: with `--json` exit 0 and put the outcome in the
 * payload; without it exit non-zero on failure (`ensure`: unless `healthy`).
 * `exec` forwards the child's exit code. An unreachable server yields
 * `state: "no-server"` (produced here, never by the server).
 *
 * Secrets: `secret set` reads the value from STDIN, never argv. `exec`
 * resolves secrets LOCALLY (same OS user, same files) and injects
 * `SVC_<ID>_<NAME>` into the child env only — no REST surface ever returns a
 * value. Leases: `exec` / `heartbeat --loop` heartbeat every 30 s and, on
 * `lease-unknown` (server restarted), re-ensure and continue with the new lease.
 * See change: add-service-registry-core.
 */
import fs from "node:fs";
import readline from "node:readline";
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import type { EnsurePayload } from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import type { CommandRunner } from "./command-runner.js";
import { DefinitionsStore } from "./definitions-store.js";
import type { ServicesPaths } from "./paths.js";
import { execSecretEnv } from "./secret-delivery.js";
import { resolveServiceSecrets } from "./secrets-resolver.js";
import { SecretsStore } from "./secrets-store.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

export type ExecSecrets = { ok: true; values: Record<string, string> } | { ok: false; hint: string };

export interface ServiceCliDeps {
  port: number;
  fetch?: typeof fetch;
  out?: (s: string) => void;
  err?: (s: string) => void;
  /** Local-token header for the server call. */
  authHeaders?: () => Record<string, string>;
  readStdin?: () => Promise<string>;
  confirm?: (question: string) => Promise<boolean>;
  /** Resolve a service's secret values locally (for `exec`). */
  resolveExecSecrets?: (id: string) => Promise<ExecSecrets>;
  spawnChild?: typeof spawn;
  heartbeatMs?: number;
  env?: NodeJS.ProcessEnv;
}


interface Parsed {
  verb: string;
  positional: string[];
  json: boolean;
  yes: boolean;
  update: boolean;
  prefetch: boolean;
  purgeData: boolean;
  all: boolean;
  force: boolean;
  loop: boolean;
  holder?: string;
  file?: string;
  /** Flag given without a valid operand. */
  badOperand?: string;
  childArgv: string[];
}

function parseServiceArgs(args: string[]): Parsed {
  const dash = args.indexOf("--");
  const head = dash >= 0 ? args.slice(0, dash) : args;
  const p: Parsed = {
    verb: head[0] ?? "",
    positional: [],
    json: false, yes: false, update: false, prefetch: false, purgeData: false, all: false, force: false, loop: false,
    childArgv: dash >= 0 ? args.slice(dash + 1) : [],
  };
  for (let i = 1; i < head.length; i++) {
    const a = head[i];
    if (a === "--json") p.json = true;
    else if (a === "--yes" || a === "-y") p.yes = true;
    else if (a === "--update") p.update = true;
    else if (a === "--prefetch") p.prefetch = true;
    else if (a === "--purge-data") p.purgeData = true;
    else if (a === "--all") p.all = true;
    else if (a === "--force") p.force = true;
    else if (a === "--loop") p.loop = true;
    else if (a === "--holder" || a === "--file") {
      // A missing or flag-shaped operand is a usage error, never silently
      // swallowed (`--file` alone must not turn into an offer add).
      const v = head[i + 1];
      if (v === undefined || v.startsWith("-")) p.badOperand = a;
      else if (a === "--holder") p.holder = head[++i];
      else p.file = head[++i];
    }
    else if (a === "--port") i++; // consumed by the outer CLI
    else p.positional.push(a);
  }
  return p;
}

type CallResult = { kind: "ok"; status: number; json: Record<string, unknown> } | { kind: "no-server"; message: string };

const SERVICE_HELP = `usage: pi-dashboard service <verb> [args] [--json]
  ensure <id> [--holder <name>]      start/probe; prints the ensure payload
  heartbeat <id> <leaseId> [--loop]  extend a lease (re-ensures on lease-unknown)
  release <id> <leaseId>             end a lease
  exec <id> -- <argv…>               run argv holding a lease; secrets as SVC_<ID>_<NAME>
  list | status <id>
  start|stop|retry|pin|unpin <id>    (stop --force for adoption-uncertain / external)
  add <offer|pkg#offer> [--yes] [--update] [--prefetch] | add --file <def.json> [--yes]
  remove <id> [--purge-data] | remove --all [--purge-data]
  prefetch <id> [--yes]
  secret set <id> <name>             value read from stdin, never argv
  secret import <id> <name> <file>`;

export async function cmdService(args: string[], deps: ServiceCliDeps): Promise<number> {
  const out = deps.out ?? ((s: string) => console.log(s));
  const err = deps.err ?? ((s: string) => console.error(s));
  const f = deps.fetch ?? fetch;
  const base = `http://127.0.0.1:${deps.port}`;
  const p = parseServiceArgs(args);

  const call = async (method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<CallResult> => {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method,
        headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(deps.authHeaders?.() ?? {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      return { kind: "no-server", message: (e as Error).message };
    }
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      /* empty body */
    }
    return { kind: "ok", status: res.status, json };
  };

  const noServer = (id?: string) => ({
    ...(id ? { id } : {}),
    state: "no-server",
    hint: `the dashboard is not reachable on port ${deps.port} (start it with: pi-dashboard start)`,
  });

  /** Print a generic `{ ok, … }` verb result and map it to an exit code. */
  const finish = (ok: boolean, data: Record<string, unknown>, human: string): number => {
    if (p.json) {
      out(JSON.stringify({ ok, ...data }));
      return 0;
    }
    (ok ? out : err)(human);
    return ok ? 0 : 1;
  };

  const simple = async (method: string, path: string, body?: unknown, timeoutMs?: number): Promise<number> => {
    const r = await call(method, path, body, timeoutMs);
    if (r.kind === "no-server") return finish(false, noServer(p.positional[0]), noServer().hint);
    const ok = r.status < 300 && r.json.success === true && (r.json.data as { ok?: boolean } | undefined)?.ok !== false;
    const data = (r.json.data ?? { error: r.json.error, message: r.json.message }) as Record<string, unknown>;
    return finish(ok, { data }, ok ? JSON.stringify(data, null, 2) : `error: ${String(r.json.message ?? data.hint ?? data.message ?? r.json.error ?? r.status)}`);
  };

  const ensure = async (id: string): Promise<EnsurePayload | { id: string; state: "no-server"; hint: string }> => {
    const r = await call("POST", `/api/services/${encodeURIComponent(id)}/ensure`, p.holder ? { holder: p.holder } : {}, 15 * 60_000);
    if (r.kind === "no-server") return noServer(id) as { id: string; state: "no-server"; hint: string };
    if (r.status >= 300 || r.json.success !== true) {
      return { id, state: "failed", hint: String(r.json.message ?? r.json.error ?? `HTTP ${r.status}`) };
    }
    return r.json.data as EnsurePayload;
  };

  const confirm = deps.confirm ?? defaultConfirm;
  const id = p.positional[0];
  if (p.badOperand) {
    err(`${p.badOperand} needs a value`);
    return usage(err);
  }

  switch (p.verb) {
    case "ensure": {
      if (!id) return usage(err);
      const payload = await ensure(id);
      if (p.json) {
        out(JSON.stringify(payload));
        return 0;
      }
      if (payload.state === "healthy") {
        out(`${id}: healthy ${JSON.stringify((payload as EnsurePayload).endpoints ?? {})} lease=${(payload as EnsurePayload).leaseId ?? "-"}`);
        return 0;
      }
      err(`${id}: ${payload.state}${(payload as EnsurePayload).reason ? ` (${(payload as EnsurePayload).reason})` : ""}${payload.hint ? ` — ${payload.hint}` : ""}`);
      return 1;
    }

    case "heartbeat":
    case "release": {
      const leaseId = p.positional[1];
      if (!id || !leaseId) return usage(err);
      if (p.verb === "release") return simple("POST", `/api/services/${encodeURIComponent(id)}/release`, { leaseId });
      let current = leaseId;
      for (;;) {
        const r = await call("POST", `/api/services/${encodeURIComponent(id)}/heartbeat`, { leaseId: current });
        let result: Record<string, unknown>;
        if (r.kind === "no-server") result = { ok: false, ...noServer(id) };
        else if (r.status === 404) {
          const again = await ensure(id);
          current = (again as EnsurePayload).leaseId ?? current;
          result = { ok: again.state === "healthy", reensured: true, ...again };
        } else result = { ok: r.status < 300, leaseId: current, ...(r.json.data as object) };
        if (!p.loop) {
          if (p.json) out(JSON.stringify(result));
          else (result.ok ? out : err)(JSON.stringify(result));
          return p.json || result.ok ? 0 : 1;
        }
        await new Promise((res) => setTimeout(res, deps.heartbeatMs ?? HEARTBEAT_INTERVAL_MS));
      }
    }

    case "exec":
      return execVerb();

    case "list":
      return simple("GET", "/api/services");
    case "status":
      if (!id) return usage(err);
      return simple("GET", `/api/services/${encodeURIComponent(id)}`);
    case "start":
    case "retry": {
      if (!id) return usage(err);
      const r = await call("POST", `/api/services/${encodeURIComponent(id)}/${p.verb}`, {}, 15 * 60_000);
      if (r.kind === "no-server") return finish(false, noServer(id), noServer().hint);
      const payload = (r.json.data ?? { id, state: "failed", hint: r.json.message }) as EnsurePayload;
      return finish(payload.state === "healthy", { ...payload }, `${id}: ${payload.state}${payload.hint ? ` — ${payload.hint}` : ""}`);
    }
    case "stop":
      if (!id) return usage(err);
      return simple("POST", `/api/services/${encodeURIComponent(id)}/stop`, { force: p.force }, 5 * 60_000);
    case "pin":
    case "unpin":
      if (!id) return usage(err);
      return simple("POST", `/api/services/${encodeURIComponent(id)}/${p.verb}`, {});

    case "add":
      return addVerb();

    case "remove": {
      const q = p.purgeData ? "?purgeData=true" : "";
      if (p.all) {
        const r = await call("GET", "/api/services");
        if (r.kind === "no-server") return finish(false, noServer(), noServer().hint);
        const ids = ((r.json.data as { services?: Array<{ id: string }> } | undefined)?.services ?? []).map((s) => s.id);
        const results: Array<{ id: string; ok: boolean; message?: string }> = [];
        for (const sid of ids) {
          const d = await call("DELETE", `/api/services/${encodeURIComponent(sid)}${q}`, undefined, 5 * 60_000);
          const ok = d.kind === "ok" && d.status < 300 && (d.json.data as { ok?: boolean } | undefined)?.ok !== false;
          results.push({ id: sid, ok, ...(ok ? {} : { message: d.kind === "ok" ? String(d.json.message ?? (d.json.data as { hint?: string })?.hint ?? d.status) : "no-server" }) });
        }
        const ok = results.every((x) => x.ok);
        return finish(ok, { removed: results }, results.map((x) => `${x.id}: ${x.ok ? "removed" : `FAILED ${x.message}`}`).join("\n") || "no services");
      }
      if (!id) return usage(err);
      return simple("DELETE", `/api/services/${encodeURIComponent(id)}${q}`, undefined, 5 * 60_000);
    }

    case "prefetch": {
      if (!id) return usage(err);
      if (!p.yes && !(await confirm(`Fetch the package for "${id}" from the network now? [y/N] `))) {
        return finish(false, { id, cancelled: true }, "cancelled");
      }
      return simple("POST", `/api/services/${encodeURIComponent(id)}/prefetch`, {}, 20 * 60_000);
    }

    case "secret":
      return secretVerb();

    default:
      return usage(err);
  }

  async function addVerb(): Promise<number> {
    let body: Record<string, unknown>;
    if (p.file) {
      let definition: unknown;
      try {
        definition = JSON.parse(fs.readFileSync(p.file, "utf8"));
      } catch (e) {
        return finish(false, { error: `cannot read ${p.file}: ${(e as Error).message}` }, `cannot read ${p.file}`);
      }
      body = { definition };
    } else {
      if (!id) return usage(err);
      body = { offer: id, update: p.update };
    }
    const dry = await call("POST", "/api/services", { ...body, dryRun: true });
    if (dry.kind === "no-server") return finish(false, noServer(), noServer().hint);
    if (dry.status >= 300) return finish(false, { error: dry.json.error, message: dry.json.message }, `error: ${String(dry.json.message ?? dry.json.error)}`);
    const review = (dry.json.data as { review: Record<string, unknown> }).review;
    if (!p.json) err(`About to ${p.update ? "update" : "add"} service:\n${JSON.stringify(review, null, 2)}`);
    if (!p.yes && !(await confirm("Write this service definition? [y/N] "))) return finish(false, { cancelled: true, review }, "cancelled");
    const wrote = await call("POST", "/api/services", { ...body, dryRun: false });
    if (wrote.kind === "no-server") return finish(false, noServer(), noServer().hint);
    if (wrote.status >= 300) return finish(false, { error: wrote.json.error, message: wrote.json.message }, `error: ${String(wrote.json.message ?? wrote.json.error)}`);
    const data = wrote.json.data as Record<string, unknown>;
    // `--yes` never covers a fetch: prefetch needs `--prefetch` or its own confirmation.
    let prefetch: Record<string, unknown> | undefined;
    if (review.needsPrefetch === true) {
      const sid = String(review.id);
      const consent = p.prefetch || (!p.yes && (await confirm(`Fetch ${JSON.stringify((review.recipe as { package?: string })?.package)} now (network)? [y/N] `)));
      if (consent) {
        const r = await call("POST", `/api/services/${encodeURIComponent(sid)}/prefetch`, {}, 20 * 60_000);
        prefetch = r.kind === "ok" ? ((r.json.data as Record<string, unknown>) ?? { ok: false }) : { ok: false, state: "no-server" };
      } else if (!p.json) {
        err(`Not prefetched. Before first use run: pi-dashboard service prefetch ${sid}`);
      }
    }
    return finish(true, { ...data, ...(prefetch ? { prefetch } : {}) }, `${String(review.id)}: ${p.update ? "updated" : "added"}`);
  }

  async function secretVerb(): Promise<number> {
    const sub = p.positional[0];
    const sid = p.positional[1];
    const name = p.positional[2];
    if ((sub !== "set" && sub !== "import") || !sid || !name) return usage(err);
    let value: string;
    if (sub === "set") {
      if (p.positional.length > 3) {
        return finish(false, { error: "the secret value is read from stdin, never from argv" }, "the secret value is read from stdin, never from argv");
      }
      value = (await (deps.readStdin ?? readAllStdin)()).replace(/\r?\n$/, "");
    } else {
      const file = p.positional[3];
      if (!file) return usage(err);
      try {
        value = fs.readFileSync(file, "utf8").replace(/\r?\n$/, "");
      } catch (e) {
        return finish(false, { error: `cannot read ${file}` }, `cannot read ${file}: ${(e as Error).message}`);
      }
    }
    return simple("PUT", `/api/services/${encodeURIComponent(sid)}/secrets/${encodeURIComponent(name)}`, { value });
  }

  async function execVerb(): Promise<number> {
    if (!id || p.childArgv.length === 0) return usage(err);
    const first = await ensure(id);
    if (first.state !== "healthy" || !(first as EnsurePayload).leaseId) {
      if (p.json) out(JSON.stringify(first));
      else err(`${id}: ${first.state}${first.hint ? ` — ${first.hint}` : ""}`);
      return 1;
    }
    let leaseId = (first as EnsurePayload).leaseId as string;
    const secrets = deps.resolveExecSecrets ? await deps.resolveExecSecrets(id) : { ok: true as const, values: {} };
    if (!secrets.ok) {
      await call("POST", `/api/services/${encodeURIComponent(id)}/release`, { leaseId });
      err(`${id}: secret-unavailable — ${secrets.hint}`);
      return 1;
    }
    const env = { ...(deps.env ?? process.env), ...execSecretEnv(id, secrets.values) };
    const child = (deps.spawnChild ?? spawn)(p.childArgv[0], p.childArgv.slice(1), { stdio: "inherit", env, shell: false });
    let beating = false;
    const timer = setInterval(async () => {
      if (beating) return;
      beating = true;
      try {
        const r = await call("POST", `/api/services/${encodeURIComponent(id)}/heartbeat`, { leaseId });
        if (r.kind === "ok" && r.status === 404) {
          const again = await ensure(id);
          if ((again as EnsurePayload).leaseId) leaseId = (again as EnsurePayload).leaseId as string;
        }
      } catch {
        // A failed beat is retried on the next tick; it must never become an
        // unhandled rejection while the child runs.
      } finally {
        beating = false;
      }
    }, deps.heartbeatMs ?? HEARTBEAT_INTERVAL_MS);
    const code = await new Promise<number>((resolve) => {
      child.once("error", (e) => {
        err(`cannot run ${p.childArgv[0]}: ${e.message}`);
        resolve(127);
      });
      child.once("exit", (c, signal) => resolve(c ?? (signal ? 128 + (signalNumber(signal) ?? 1) : 1)));
    });
    clearInterval(timer);
    await call("POST", `/api/services/${encodeURIComponent(id)}/release`, { leaseId });
    return code;
  }
}

function usage(err: (s: string) => void): number {
  err(SERVICE_HELP);
  return 2;
}

function signalNumber(sig: NodeJS.Signals): number | undefined {
  return ({ SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 } as Record<string, number>)[sig];
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function defaultConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((r) => rl.question(question, r));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}


/**
 * `exec`'s local secret resolution: same OS user, same files, so no REST
 * surface ever has to return a value.
 */
export function localExecSecretsResolver(o: {
  paths: ServicesPaths;
  run: CommandRunner;
  resolveBinary: (name: string) => string | null;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
}): (id: string) => Promise<ExecSecrets> {
  return async (id) => {
    const r = new DefinitionsStore(o.paths.definitions).read();
    if (!r.ok) return { ok: false, hint: "services.json is corrupt" };
    const def = r.entries.find((e) => e.id === id)?.def;
    if (!def) return { ok: false, hint: `no valid definition for ${id}` };
    const res = await resolveServiceSecrets(def, {
      store: new SecretsStore(o.paths.secrets),
      env: o.env ?? process.env,
      platform: o.platform ?? process.platform,
      run: o.run,
      resolveBinary: o.resolveBinary,
    });
    return res.ok ? { ok: true, values: res.values } : { ok: false, hint: res.hint };
  };
}
