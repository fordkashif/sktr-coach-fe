import { useEffect } from "react"
import { Analytics } from "@vercel/analytics/react"
import { Outlet } from "react-router-dom"
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/toaster"
import { SupabaseAuthSync } from "@/lib/supabase/auth-sync"

export function RootLayout() {
  useEffect(() => {
    document.title = "SKTR Coach | Track and field coaching"
  }, [])

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
      <div className="font-sans antialiased">
        <SupabaseAuthSync />
        <Outlet />
        <Toaster />
        <Analytics />
      </div>
    </ThemeProvider>
  )
}
