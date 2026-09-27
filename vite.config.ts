import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  server: {
    // Loopback only: the API behind this proxy can drive a browser and submit applications.
    host: "127.0.0.1",
    port: 8080,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
