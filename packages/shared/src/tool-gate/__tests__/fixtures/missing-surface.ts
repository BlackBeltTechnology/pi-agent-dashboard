/**
 * Compile-time fixture for the "no default presenter" guarantee: calling the
 * shared `createToolCallGuard` without `surface` MUST NOT type-check. The
 * `@ts-expect-error` below is itself an error if the call ever compiles.
 * Checked by the repo typecheck AND by `missing-surface.typecheck.test.ts`
 * (which also proves the expectation is not vacuous).
 *
 * See change: add-supervised-tool-approval (test-plan #X12).
 */
import { createToolCallGuard } from "../../guard.js";

// @ts-expect-error — `surface` is required; there is no chat-flavoured default
export const noSurface = createToolCallGuard({ policy: { approval: ["bash"] }, timeoutMs: 1000 });
