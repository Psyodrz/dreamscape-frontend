import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "assets/*",
          dest: "assets",
        },
      ],
    }),
  ],
  build: {
    // Ensure assets are handled correctly
    assetsInlineLimit: 0, // Don't inline any assets
    rollupOptions: {
      output: {
        // Preserve asset names for easier debugging
        assetFileNames: "assets/[name].[hash][extname]",
        chunkFileNames: "assets/[name].[hash].js",
        entryFileNames: "assets/[name].[hash].js",
      },
    },
  },
  // For development server
  server: {
    host: true, // Allow access from network (for mobile testing)
    port: 5173,
    hmr: {
      host: "localhost",
      port: 5173,
      overlay: true,
    },
  },
});
