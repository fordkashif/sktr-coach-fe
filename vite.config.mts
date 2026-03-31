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
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined

          if (id.includes("@mui/")) return "mui-vendor"
          if (id.includes("@radix-ui/")) return "radix-vendor"
          if (id.includes("@hugeicons/")) return "icons-vendor"
          if (id.includes("@supabase/")) return "supabase-vendor"
          if (id.includes("react-router")) return "router-vendor"
          if (id.includes("/react/") || id.includes("\\react\\") || id.includes("react-dom")) return "react-vendor"
          return undefined
        },
      },
    },
  },
})
