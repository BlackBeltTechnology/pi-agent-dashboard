import { readFileSync } from "node:fs";
import { loadConfig } from "./config";
import { OrderError } from "./errors";
import { createOrder, submitOrder } from "./orders";
import { totalFor } from "./pricing";

// orders <quote|submit> <order.json> [--dry-run]
export function main(argv: string[]): number {
  const [command, file] = argv;
  const dryRun = argv.includes("--dry-run");
  try {
    const order = createOrder(JSON.parse(readFileSync(file, "utf8")));
    if (command === "quote") {
      console.log(totalFor(order).toFixed(2));
      return 0;
    }
    if (command === "submit") {
      if (dryRun) {
        console.log(`would submit ${order.id}`);
        return 0;
      }
      console.log(submitOrder(order.id, loadConfig()).status);
      return 0;
    }
    console.error(`unknown command ${command}`);
    return 2;
  } catch (err) {
    if (err instanceof OrderError) {
      console.error(`${err.code}: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
