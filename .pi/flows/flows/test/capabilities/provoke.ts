import type { CodeNodeContext } from "@blackbelt-technology/pi-flows";

// on_error coverage: a code step that ALWAYS soft-fails (plain Error).
// A soft failure routes to the step's `on_error` target; the flow recovers
// instead of aborting. No declared outputs (a no-output code step would
// otherwise have to return {}), so this never reaches a normal return.
interface Input {
  note: string;
}

export default async function (input: Input, ctx: CodeNodeContext): Promise<Record<string, never>> {
  ctx.logger(`provoke saw upstream note="${input.note}"; soft-failing to exercise on_error`);
  throw new Error("intentional soft failure to exercise on_error routing");
}
