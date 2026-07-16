/**
 * Pi Dashboard bus CLI — the typed WebSocket command layer for the
 * `pi-dashboard` skill. Wraps `@blackbelt-technology/pi-dashboard-bus-client`
 * so slash commands and LLM-authored `.ts` scripts drive the dashboard over the
 * SAME bus the web client uses, instead of curling the REST facade.
 *
 * Tier 2 (this file): the session/flow COMMAND verbs that have a real
 * `BrowserToServerMessage` twin ride the WS. Read-only + no-WS-twin operations
 * stay on `dashboard-api.sh` (REST) — see SKILL.md.
 *
 * Invoke (Node everywhere via npx tsx):
 *   npx tsx ./scripts/dashboard-bus.ts sessions [--all] [--json]
 *   npx tsx ./scripts/dashboard-bus.ts spawn <cwd> [--prompt <text>] [--attach <change>]
 *   npx tsx ./scripts/dashboard-bus.ts prompt <id-prefix> <text...>
 *   npx tsx ./scripts/dashboard-bus.ts until <id-prefix> <status> [--timeout <ms>]
 *   npx tsx ./scripts/dashboard-bus.ts abort <id-prefix>
 *   npx tsx ./scripts/dashboard-bus.ts kill <id-prefix>
 *   npx tsx ./scripts/dashboard-bus.ts model <id-prefix> <provider> <modelId>
 *   npx tsx ./scripts/dashboard-bus.ts thinking <id-prefix> <level>
 *   npx tsx ./scripts/dashboard-bus.ts rename <id-prefix> <name...>
 *   npx tsx ./scripts/dashboard-bus.ts hide|unhide <id-prefix>
 *   npx tsx ./scripts/dashboard-bus.ts resume <id-prefix> [--fork]
 *   npx tsx ./scripts/dashboard-bus.ts flow <id-prefix> <abort|toggle_autonomous|dismiss_summary>
 *   npx tsx ./scripts/dashboard-bus.ts proposal-attach <id-prefix> <change>
 *   npx tsx ./scripts/dashboard-bus.ts proposal-detach <id-prefix>
 *   npx tsx ./scripts/dashboard-bus.ts plugin <pluginId> <action> [payloadJson] [--session <id-prefix>]
 *   npx tsx ./scripts/dashboard-bus.ts send '<BrowserToServerMessage json>'
 *
 * See OpenSpec change: add-dashboard-bus-client-scripting.
 */
import { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import type { SessionStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
function has(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}
function positionals(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      // Skip the flag and its value (except boolean flags).
      if (["all", "json", "fork"].includes(a.slice(2))) continue;
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd) die("usage: dashboard-bus.ts <command> … (see file header)");

  const client = new BusClient();
  await client.connect();

  const resolveId = (prefix: string): string => {
    const match = client.read.sessions().find((s) => s.id.startsWith(prefix));
    if (!match) die(`no session id starts with "${prefix}"`);
    return match.id;
  };
  const pos = positionals(rest);

  try {
    switch (cmd) {
      case "sessions": {
        const all = has(rest, "all");
        const rows = client.read.sessions().filter((s) => all || s.status !== "ended");
        if (has(rest, "json")) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          for (const s of rows) {
            console.log(
              `${s.id.slice(0, 8)}  ${s.status.padEnd(9)}  ${s.model ?? "-"}  ${s.cwd}`,
            );
          }
          console.log(`(${rows.length} session${rows.length === 1 ? "" : "s"})`);
        }
        break;
      }
      case "spawn": {
        const cwd = pos[0] ?? die("spawn needs <cwd>");
        const id = await client.spawn({
          cwd,
          initialPrompt: flag(rest, "prompt"),
          attachProposal: flag(rest, "attach"),
        });
        console.log(`spawned ${id}`);
        break;
      }
      case "prompt": {
        const id = resolveId(pos[0] ?? die("prompt needs <id-prefix> <text>"));
        const text = pos.slice(1).join(" ");
        if (!text) die("prompt needs text");
        client.prompt(id, text);
        console.log(`prompted ${id.slice(0, 8)}`);
        break;
      }
      case "until": {
        const id = resolveId(pos[0] ?? die("until needs <id-prefix> <status>"));
        const status = (pos[1] ?? die("until needs a status")) as SessionStatus;
        const timeout = Number(flag(rest, "timeout") ?? 300_000);
        await client.until(id, status, { timeout });
        console.log(`${id.slice(0, 8)} reached ${status}`);
        break;
      }
      case "abort": {
        const id = resolveId(pos[0] ?? die("abort needs <id-prefix>"));
        client.send({ type: "abort", sessionId: id });
        console.log(`aborted ${id.slice(0, 8)}`);
        break;
      }
      case "kill": {
        const id = resolveId(pos[0] ?? die("kill needs <id-prefix>"));
        client.send({ type: "force_kill", sessionId: id });
        console.log(`force-killed ${id.slice(0, 8)}`);
        break;
      }
      case "model": {
        const id = resolveId(pos[0] ?? die("model needs <id-prefix> <provider> <modelId>"));
        const provider = pos[1] ?? die("model needs <provider>");
        const modelId = pos[2] ?? die("model needs <modelId>");
        client.send({ type: "set_model", sessionId: id, provider, modelId });
        console.log(`set model ${provider}/${modelId} on ${id.slice(0, 8)}`);
        break;
      }
      case "thinking": {
        const id = resolveId(pos[0] ?? die("thinking needs <id-prefix> <level>"));
        const level = pos[1] ?? die("thinking needs <level>");
        client.send({ type: "set_thinking_level", sessionId: id, level });
        console.log(`set thinking ${level} on ${id.slice(0, 8)}`);
        break;
      }
      case "rename": {
        const id = resolveId(pos[0] ?? die("rename needs <id-prefix> <name>"));
        const name = pos.slice(1).join(" ") || die("rename needs a name");
        client.send({ type: "rename_session", sessionId: id, name });
        console.log(`renamed ${id.slice(0, 8)} → ${name}`);
        break;
      }
      case "hide":
      case "unhide": {
        const id = resolveId(pos[0] ?? die(`${cmd} needs <id-prefix>`));
        client.send({ type: cmd === "hide" ? "hide_session" : "unhide_session", sessionId: id });
        console.log(`${cmd} ${id.slice(0, 8)}`);
        break;
      }
      case "resume": {
        const id = resolveId(pos[0] ?? die("resume needs <id-prefix>"));
        const newId = await client.resume({ sessionId: id, mode: has(rest, "fork") ? "fork" : "continue" });
        console.log(`resumed ${id.slice(0, 8)} → ${newId}`);
        break;
      }
      case "flow": {
        const id = resolveId(pos[0] ?? die("flow needs <id-prefix> <action>"));
        const action = pos[1] as "abort" | "toggle_autonomous" | "dismiss_summary";
        if (!["abort", "toggle_autonomous", "dismiss_summary"].includes(action)) {
          die("flow action must be abort|toggle_autonomous|dismiss_summary");
        }
        client.send({ type: "flow_control", sessionId: id, action });
        console.log(`flow ${action} on ${id.slice(0, 8)}`);
        break;
      }
      case "proposal-attach": {
        const id = resolveId(pos[0] ?? die("proposal-attach needs <id-prefix> <change>"));
        const changeName = pos[1] ?? die("proposal-attach needs <change>");
        client.send({ type: "attach_proposal", sessionId: id, changeName });
        console.log(`attached ${changeName} to ${id.slice(0, 8)}`);
        break;
      }
      case "proposal-detach": {
        const id = resolveId(pos[0] ?? die("proposal-detach needs <id-prefix>"));
        client.send({ type: "detach_proposal", sessionId: id });
        console.log(`detached proposal from ${id.slice(0, 8)}`);
        break;
      }
      case "plugin": {
        const pluginId = pos[0] ?? die("plugin needs <pluginId> <action>");
        const action = pos[1] ?? die("plugin needs <action>");
        const payload = pos[2] ? (JSON.parse(pos[2]) as Record<string, unknown>) : undefined;
        const sessionPrefix = flag(rest, "session");
        const sessionId = sessionPrefix ? resolveId(sessionPrefix) : null;
        client.plugin(pluginId, action, payload, { sessionId });
        console.log(`plugin ${pluginId}.${action} sent`);
        break;
      }
      case "send": {
        const json = pos[0] ?? die("send needs a JSON message");
        client.send(JSON.parse(json));
        console.log("sent");
        break;
      }
      default:
        die(`unknown command: ${cmd}`);
    }
  } finally {
    // Give a beat for the last frame to flush, then close.
    await new Promise((r) => setTimeout(r, 50));
    client.close();
  }
}

main().catch((err) => {
  console.error(`ERROR: ${(err as Error).message}`);
  process.exit(1);
});
