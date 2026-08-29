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
    },
  },
  // assets/ and packages/data/ live outside this package
  server: { port: 5173, fs: { allow: [repoRoot] } },
});
