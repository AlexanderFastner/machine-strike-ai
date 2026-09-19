import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@data": fileURLToPath(new URL("../data", import.meta.url)),
      "@assets": fileURLToPath(new URL("../../assets", import.meta.url)),
      "@engine": fileURLToPath(new URL("../engine/src", import.meta.url)),
      // The workspace packages, resolved to source so the browser runs the exact
      // engine, agents and arena loop that the headless tests exercise.
      "@ms/engine": fileURLToPath(new URL("../engine/src/index.ts", import.meta.url)),
      "@ms/ai": fileURLToPath(new URL("../ai/src/index.ts", import.meta.url)),
      "@ms/arena": fileURLToPath(new URL("../arena/src/index.ts", import.meta.url)),
    },
  },
  // assets/ and packages/data/ live outside this package
  server: { port: 5173, fs: { allow: [repoRoot] } },
});
