import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Expose the real package version so the sidebar/About stay in sync with
// package.json instead of a hardcoded string.
const version = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // Dev-only: forward API calls to the team server (server/, port 8787) so
  // team mode works under `vite dev`. Production serves web + api same-origin.
  server: {
    proxy: { "/api": "http://localhost:8787" },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
} as Parameters<typeof defineConfig>[0]);
