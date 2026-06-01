import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        landing: "index.html",
        pricing: "pricing.html",
        privacy: "privacy.html",
        terms: "terms.html",
        background: "src/extension/background.js",
        "content-script": "src/extension/content-script.js",
        reader: "reader.html"
      },
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]"
      }
    }
  }
});
