import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(root, "index.html"),
        background: resolve(root, "src/extension/background.ts"),
        content: resolve(root, "src/extension/content.ts"),
      },
      output: {
        entryFileNames: "assets/[name].js",
      },
    },
  },
  test: {
    environment: "node",
  },
});
