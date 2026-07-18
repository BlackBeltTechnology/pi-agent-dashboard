import type { CommandInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/**
 * Filter commands by case-insensitive substring match on name or description.
 */
export function filterCommands(commands: CommandInfo[], filter: string): CommandInfo[] {
  if (!filter) return commands;
  const lower = filter.toLowerCase();
  return commands.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(lower) ||
      (cmd.description?.toLowerCase().includes(lower) ?? false)
  );
}
