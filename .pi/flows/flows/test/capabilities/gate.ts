import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

// Code-decision + loop coverage: returns a reserved `branch` to route.
// "again" points backward to an earlier step (loop edge); "go" exits forward.
// Terminates either when the worker reports done OR the iteration cap is hit;
// the engine's max_iterations also force-exits the loop as a backstop.
type Branch = "again" | "go";

interface Input {
  worker_summary: string;
  iteration: string;
  max: string;
}

export default async function (input: Input, ctx: CodeNodeContext): Promise<{ branch: Branch }> {
  const done = input.worker_summary === "done";
  const last = Number(input.iteration) >= Number(input.max);
  const branch: Branch = done || last ? "go" : "again";
  ctx.setSummary(`gate iter=${input.iteration}/${input.max} done=${done} -> ${branch}`);
  return { branch };
}
