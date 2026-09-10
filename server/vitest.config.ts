import { defineConfig } from "vitest/config";

// node:sqlite is a newer built-in Vite doesn't yet auto-externalize, so it tries
// to bundle it and fails. Keep it (and other node: builtins) external.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    server: { deps: { external: [/node:sqlite/] } },
  },
  ssr: { external: ["node:sqlite"] },
});
