/**
 * The one error type that carries a machine tool code (design D8). Everything below the MCP layer
 * throws it; `mcp/server.ts` turns it into an `isError` tool result.
 *
 * See change: add-blender-wasm-mcp (design D8).
 */
import type { ToolErrorCode } from "./host/protocol.js";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  constructor(code: ToolErrorCode, message: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
  }
}
