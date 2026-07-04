import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// React Compiler runs as a Babel plugin; React 19 ships its runtime, so no extra runtime dep.
export default defineConfig({
  plugins: [react({ babel: { plugins: [["babel-plugin-react-compiler", {}]] } })],
  server: { host: true, port: 5173 },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
});
