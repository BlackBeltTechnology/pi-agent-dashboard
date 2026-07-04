#!/usr/bin/env -S npx tsx
/**
 * cdp-inspect.ts — dependency-free CDP scope dumper for pi-dashboard's jiti stack.
 *
 * Attaches to a Node inspector target, sets a breakpoint by `.ts` URL, resumes
 * past the `--inspect-brk` entry halt, and on the first hit prints the paused
 * frame plus every local + closure variable in it.
 *
 * Usage:
 *   npx tsx cdp-inspect.ts <port> <ts-url> <line>
 *   e.g. npx tsx cdp-inspect.ts 9229 cli.ts 42
 *
 * No `chrome-remote-interface` dependency: uses Node 24's global `WebSocket`.
 * See the node-inspect-debugger SKILL.md for the jiti launch recipe.
 *
 * Derived from NousResearch/hermes-agent (MIT); rewritten in TypeScript and
 * retargeted at this repo's jiti loader (line-preserving `.ts` URLs).
 */

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
}

interface PropertyDescriptor {
  name: string;
  value?: { type?: string; value?: unknown; description?: string };
}

interface Scope {
  type: string;
  object: { objectId?: string };
}

interface CallFrame {
  functionName?: string;
  location?: { lineNumber?: number };
  url?: string;
  scopeChain?: Scope[];
}

function usage(): never {
  console.error("usage: cdp-inspect.ts <port> <ts-url> <line>");
  process.exit(2);
}

const [portArg, tsUrl, lineArg] = process.argv.slice(2);
if (!portArg || !tsUrl || !lineArg) usage();
const port = Number(portArg);
const line = Number(lineArg);
if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(line) || line <= 0) usage();

/** Fetch the first debuggable target's WebSocket URL from /json/list. */
async function resolveWebSocketUrl(p: number): Promise<string> {
  const res = await fetch(`http://127.0.0.1:${p}/json/list`);
  const targets = (await res.json()) as Array<{ webSocketDebuggerUrl?: string }>;
  const url = targets.find((t) => t.webSocketDebuggerUrl)?.webSocketDebuggerUrl;
  if (!url) throw new Error(`no debuggable target on port ${p}`);
  return url;
}

/** A CDP command sender bound to one WebSocket. */
type Send = (method: string, params?: Record<string, unknown>) => Promise<CdpMessage>;

const fail = (e: unknown): never => {
  console.error(e);
  process.exit(1);
};

/** Render one property descriptor's value for display. */
function showValue(v: PropertyDescriptor["value"]): string {
  if (v?.value !== undefined) return JSON.stringify(v.value);
  return v?.description ?? v?.type ?? "?";
}

/** Print every own property of one scope object. */
async function dumpScope(send: Send, scope: Scope): Promise<void> {
  if (scope.type !== "local" && scope.type !== "closure") return;
  if (!scope.object.objectId) return;
  const props = await send("Runtime.getProperties", {
    objectId: scope.object.objectId,
    ownProperties: true,
  });
  for (const prop of (props.result?.result as PropertyDescriptor[]) ?? []) {
    console.log(`  ${scope.type.padEnd(8)} ${prop.name} = ${showValue(prop.value)}`);
  }
}

/** Print the paused frame plus every local + closure variable in it. */
async function dumpFrame(send: Send, frame: CallFrame): Promise<void> {
  const fn = frame.functionName || "(anonymous)";
  const at = (frame.location?.lineNumber ?? 0) + 1; // CDP lines are 0-based
  console.log(`PAUSED at ${frame.url || tsUrl}:${at} fn=${fn}`);
  for (const scope of frame.scopeChain ?? []) {
    await dumpScope(send, scope);
  }
}

/** Handle a Debugger.paused event: dump at our line, else resume toward it. */
async function onPaused(send: Send, ws: WebSocket, msg: CdpMessage): Promise<void> {
  const top = (msg.params?.callFrames as CallFrame[] | undefined)?.[0];
  // The first pause is the --inspect-brk entry halt (before our line); the
  // breakpoint hit is the pause whose top frame is at our target line.
  if (!top || (top.location?.lineNumber ?? -1) + 1 !== line) {
    await send("Debugger.resume").catch(fail); // entry halt / unrelated pause
    return;
  }
  await dumpFrame(send, top);
  await send("Debugger.resume");
  ws.close();
  process.exit(0);
}

async function main(): Promise<void> {
  const wsUrl = await resolveWebSocketUrl(port);
  const ws = new WebSocket(wsUrl);

  let nextId = 1;
  const pending = new Map<number, (m: CdpMessage) => void>();

  const send: Send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m)));
      ws.send(JSON.stringify({ id, method, params }));
    });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as CdpMessage;
    if (msg.id !== undefined) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
    } else if (msg.method === "Debugger.paused") {
      onPaused(send, ws, msg).catch(fail);
    }
  });

  ws.addEventListener("open", () => {
    // A breakpoint set before the target parses returns empty `locations` but
    // still resolves and hits — see SKILL.md pitfall. Do not treat the empty
    // array as a failure.
    Promise.resolve()
      .then(() => send("Runtime.enable"))
      .then(() => send("Debugger.enable"))
      .then(() => send("Debugger.setBreakpointByUrl", { url: tsUrl, lineNumber: line - 1 }))
      .then(() => send("Runtime.runIfWaitingForDebugger"))
      .catch(fail);
  });

  ws.addEventListener("error", (ev) => {
    console.error("websocket error:", (ev as ErrorEvent).message ?? ev);
    process.exit(1);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
