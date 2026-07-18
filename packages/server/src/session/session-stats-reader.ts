/**
 * Extract cumulative token stats and context usage from a session JSONL file.
 * Used to populate session card data after server restart.
 */
import { readFileSync, existsSync } from "node:fs";

export interface SessionStats {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  /** Last known total tokens (approximates context usage) */
  lastTotalTokens?: number;
  /** Context window size for the model */
  contextWindow?: number;
  model?: string;
  thinkingLevel?: string;
}

/**
 * Read a session JSONL file and extract cumulative stats.
 * Only reads the file once — accumulates from all assistant messages with usage.
 */
export function extractSessionStats(filePath: string): SessionStats | null {
  if (!existsSync(filePath)) return null;

  try {
    const content = readFileSync(filePath, "utf-8");
    const stats: SessionStats = {
      tokensIn: 0,
      tokensOut: 0,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
    };

    let lastTotalTokens: number | undefined;

    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        // Extract model info
        if (entry.type === "model_change") {
          stats.model = entry.provider && entry.modelId
            ? `${entry.provider}/${entry.modelId}`
            : undefined;
        }

        // Extract thinking level
        if (entry.type === "thinking_level_change" && entry.level) {
          stats.thinkingLevel = entry.level;
        }

        // Accumulate usage from assistant messages
        if (entry.type === "message" && entry.message?.role === "assistant" && entry.message?.usage) {
          const usage = entry.message.usage;
          stats.tokensIn += (usage.input ?? 0);
          stats.tokensOut += (usage.output ?? 0);
          stats.cacheRead += (usage.cacheRead ?? 0);
          stats.cacheWrite += (usage.cacheWrite ?? 0);
          if (usage.cost?.total) {
            stats.cost += usage.cost.total;
          }
          if (usage.totalTokens) {
            lastTotalTokens = usage.totalTokens;
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (lastTotalTokens) {
      stats.lastTotalTokens = lastTotalTokens;
    }
    if (stats.model) {
      stats.contextWindow = inferContextWindow(stats.model);
    }

    return stats;
  } catch {
    return null;
  }
}

/** Infer context window size from model string (provider/id format) */
function inferContextWindow(model: string): number {
  const id = model.toLowerCase();
  if (id.includes("claude")) return 200_000;
  if (id.includes("gpt-4o")) return 128_000;
  if (id.includes("gpt-4")) return 128_000;
  if (id.includes("o1") || id.includes("o3") || id.includes("o4")) return 200_000;
  if (id.includes("gemini")) return 1_000_000;
  if (id.includes("deepseek")) return 128_000;
  return 200_000;
}
