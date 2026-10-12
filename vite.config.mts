import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 550,
    rollupOptions: {
      output: {
        // Merge very small shared files (mostly single icons) into their neighbours, so a screen
        // is a handful of downloads instead of dozens of tiny ones.
        experimentalMinChunkSize: 10_000,
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined

          if (id.includes("@radix-ui/")) return "radix-vendor"
          if (id.includes("@hugeicons/")) return "icons-vendor"
          if (id.includes("@supabase/")) return "supabase-vendor"
          if (id.includes("react-router")) return "router-vendor"
          // Only React itself. A looser match ("/react/") also caught @phosphor-icons/react, which put every
          // icon in the app into the first download.
          if (/node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor"
          return undefined
        },
      },
    },
  },
})
