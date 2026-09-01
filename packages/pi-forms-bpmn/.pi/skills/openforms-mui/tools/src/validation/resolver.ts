/**
 * react-hook-form resolver bridging the derived Zod schema. Nested repeater
 * errors are addressable at their array paths because zod issue paths
 * (`[key, index, childKey]`) map onto RHF field names directly.
 */
import { zodResolver } from "@hookform/resolvers/zod";
import type { Resolver } from "react-hook-form";
import type { z } from "zod";
import type { FormAnswers } from "../schema/types.js";

export function makeResolver(zodSchema: z.ZodType<FormAnswers>): Resolver<FormAnswers> {
  // zodResolver understands superRefine issues, including our form-level path.
  return zodResolver(zodSchema as never) as unknown as Resolver<FormAnswers>;
}
