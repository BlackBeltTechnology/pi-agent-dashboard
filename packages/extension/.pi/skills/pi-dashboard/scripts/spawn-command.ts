/**
 * `dashboard-bus.ts spawn` verb: argv → `BusClient.spawn` options, printing
 * `spawned <id>` and any dropped-choice `warning: <text>`.
 *
 *   spawn <cwd> [--prompt <text>] [--attach <change>] [--model <ref>] [--thinking <level>]
 *
 * `--model` takes `provider/id`, `provider/id:<level>`, `@role` or
 * `@role:<level>`; the server resolves `@role` once at spawn time.
 * See change: add-spawn-model-choice (design D8).
 */
import type { SpawnOptions } from "@blackbelt-technology/pi-dashboard-bus-client";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

export function spawnCommandOptions(cwd: string, args: string[], onWarning: (w: string) => void): SpawnOptions {
  const opts: SpawnOptions = { cwd, onWarning };
  const entries: Array<[keyof SpawnOptions, string | undefined]> = [
    ["initialPrompt", flag(args, "prompt")],
    ["attachProposal", flag(args, "attach")],
    ["model", flag(args, "model")],
    ["thinkingLevel", flag(args, "thinking")],
  ];
  // The server validates `thinkingLevel` (an invalid one is dropped with a warning).
  for (const [key, value] of entries) if (value) (opts as unknown as Record<string, unknown>)[key] = value;
  return opts;
}

export async function runSpawnCommand(
  client: { spawn(opts: SpawnOptions): Promise<string> },
  cwd: string,
  args: string[],
  log: (line: string) => void = console.log,
): Promise<string> {
  const id = await client.spawn(spawnCommandOptions(cwd, args, (w) => log(`warning: ${w}`)));
  log(`spawned ${id}`);
  return id;
}
