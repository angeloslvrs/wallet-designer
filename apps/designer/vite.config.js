import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  return {
    root: ".",
    build: {
      target: "esnext",   // allow top-level await in main.js
      rollupOptions: {
        output: {
          // Pin the two heavy encoders/decoders into their own chunks. Both are
          // reached only via dynamic import() (bwip-js on issue/build/preview
          // barcode draw; @zxing/browser on scan) — forcing separate chunks stops
          // Rollup from folding them back into a first-paint shared chunk, so the
          // Designer view never downloads the ~900 kB barcode/scanner libs up front.
          manualChunks(id) {
            if (id.includes("node_modules/bwip-js")) return "bwip-js";
            if (id.includes("node_modules/@zxing")) return "zxing";
          }
        }
      }
    },
    server: {
      port: Number(env.VITE_PORT ?? 4318),
      proxy: {
        "/api": `http://localhost:${env.PORT ?? 4317}`
      }
    }
  };
});
