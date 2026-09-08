import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const backendUrl = process.env.PROXUS_API_URL ?? "http://localhost:3000";
const port = Number(process.env.WEB_PORT ?? process.env.PORT ?? "5173");

export default defineConfig({
  root: "src",
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port,
    proxy: {
      "^/api(?:/|$)": {
        target: backendUrl,
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true
  }
});
