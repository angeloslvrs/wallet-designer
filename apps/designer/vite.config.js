import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../../", "");
  return {
    root: ".",
    server: {
      port: Number(env.VITE_PORT ?? 4318),
      proxy: {
        "/api": `http://localhost:${env.PORT ?? 4317}`
      }
    }
  };
});
