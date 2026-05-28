/**
 * REST routes for editor (code-server) lifecycle management.
 */
import type { FastifyInstance } from "fastify";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { EditorManager } from "../editor-manager.js";
import type { NetworkGuard } from "./route-deps.js";

export function registerEditorRoutes(
  fastify: FastifyInstance,
  editorManager: EditorManager,
  deps: { networkGuard: NetworkGuard },
) {
  const { networkGuard } = deps;
  // Start or return existing editor instance
  fastify.post<{ Body: { cwd?: string; theme?: "dark" | "light" } }>(
    "/api/editor/start",
    { preHandler: networkGuard },
    async (request) => {
      const { cwd, theme } = request.body ?? {};
      if (!cwd) {
        return { success: false, error: "cwd required" } satisfies ApiResponse;
      }

      try {
        const info = await editorManager.start(cwd, theme);
        return { success: true, data: info } satisfies ApiResponse;
      } catch (err: any) {
        return { success: false, error: err.message } satisfies ApiResponse;
      }
    },
  );

  // Heartbeat to keep instance alive
  fastify.post<{ Params: { id: string } }>(
    "/api/editor/:id/heartbeat",
    { preHandler: networkGuard },
    async (request) => {
      const { id } = request.params;
      const inst = editorManager.get(id);
      if (!inst) {
        return { success: false, error: "instance not found" } satisfies ApiResponse;
      }
      editorManager.heartbeat(id);
      return { success: true } satisfies ApiResponse;
    },
  );

  // Stop an editor instance
  fastify.post<{ Params: { id: string } }>(
    "/api/editor/:id/stop",
    { preHandler: networkGuard },
    async (request) => {
      const { id } = request.params;
      await editorManager.stop(id);
      return { success: true } satisfies ApiResponse;
    },
  );

  // Update theme for a running editor instance
  fastify.post<{ Params: { id: string }; Body: { theme?: "dark" | "light" } }>(
    "/api/editor/:id/theme",
    { preHandler: networkGuard },
    async (request) => {
      const { id } = request.params;
      const { theme } = request.body ?? {};
      const inst = editorManager.get(id);
      if (!inst) {
        return { success: false, error: "instance not found" } satisfies ApiResponse;
      }
      if (theme) {
        editorManager.setTheme(inst.cwd, theme);
      }
      return { success: true } satisfies ApiResponse;
    },
  );

  // List all editor instances
  fastify.get(
    "/api/editor/status",
    { preHandler: networkGuard },
    async () => {
      return { success: true, data: editorManager.list() } satisfies ApiResponse;
    },
  );
}
