import { defineConfig } from "vite";

export default defineConfig({
  // Static SPA, deployed to Vercel (BUILD_BRIEF §7).
  build: { outDir: "dist", sourcemap: true },
  server: { port: 5173 },
});
