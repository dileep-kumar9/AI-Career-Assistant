import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  server: {
    // Loopback only (the API behind this proxy can drive a browser and submit applications).
    // "localhost" rather than 127.0.0.1: Firebase sign-in authorises localhost by default.
    host: "localhost",
    strictPort: true,
    port: 8081,
    proxy: {
      "/api": "http://127.0.0.1:8790",
    },
  },
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: Firebase Auth and React change rarely.
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth"],
          react: ["react", "react-dom", "react-router-dom", "@tanstack/react-query"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
