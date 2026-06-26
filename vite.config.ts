import { defineConfig } from "vite";

// Stable output filenames (no content hashes) so the WordPress theme can
// enqueue assets/app.js + assets/app.css without knowing a build hash.
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/app.[ext]",
      },
    },
  },
});
