import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @fig/shared is an npm-workspace-linked CommonJS package (server needs
  // CJS -- see shared/tsconfig.json). Vite's dev server resolves workspace
  // symlinks to their real path outside node_modules and, by default,
  // doesn't pre-bundle/CJS-interop packages found that way -- the browser
  // then tries to load its `exports.X = ...` syntax as native ESM and
  // fails. Forcing it into optimizeDeps makes esbuild pre-bundle (and
  // interop) it like a normal dependency.
  optimizeDeps: {
    include: ["@fig/shared"],
  },
  server: {
    proxy: {
      // Server (Express) runs on PORT from .env, default 4000.
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
