import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { AppRouter } from "@/router"
import { initializeSupabaseRuntime } from "@/lib/supabase/bootstrap"
import { registerServiceWorker } from "@/lib/pwa"
import "@fontsource-variable/outfit"
import "@/styles/globals.css"

initializeSupabaseRuntime()
registerServiceWorker()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </React.StrictMode>,
)
