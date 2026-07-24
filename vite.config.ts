import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    {
      name: "dev-disable-typhoon-api-preload",
      apply: "serve",
      transformIndexHtml(html) {
        return html.replace(/\s*<link rel="preload" href="\/api\/typhoon\/[^"]+" as="fetch" crossorigin\s*\/>/, "");
      },
    },
  ],
  build: {
    outDir: "dist",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          mapbox: ["mapbox-gl"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api/typhoon": {
        target: "https://typhoon.slt.zj.gov.cn",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/typhoon/, "/Api/TyphoonInfo"),
      },
    },
  },
});
