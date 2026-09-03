import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Deduplicate React so component tests never load two instances (mirrors D14).
    server: { deps: { inline: [/@mui/, /@emotion/] } },
  },
  resolve: {
    dedupe: ["react", "react-dom", "@mui/material", "@emotion/react", "@emotion/styled"],
  },
});
