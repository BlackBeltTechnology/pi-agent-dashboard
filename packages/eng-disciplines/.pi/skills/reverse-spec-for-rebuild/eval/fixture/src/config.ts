import { readFileSync } from "node:fs";

// Runtime configuration. The deployed config file is NOT part of this repository.
export interface Config {
  autoApproveLimit: number;
  logLevel: string;
}

export function loadConfig(): Config {
  const path = process.env.ORDERS_CONFIG_PATH ?? "/etc/orders/config.json";
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return {
    // Orders whose total is at or below this limit are approved automatically.
    autoApproveLimit: Number(raw["approval.autoApproveLimit"]),
    logLevel: process.env.ORDERS_LOG_LEVEL ?? "info",
  };
}
