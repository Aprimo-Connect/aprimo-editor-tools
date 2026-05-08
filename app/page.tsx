"use client"

import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { FileSpreadsheet, Upload, Clapperboard, House, LayoutTemplate } from "lucide-react"
import Link from "next/link"
import { useAprimo } from "@/context/aprimo-context"

export default function Home() {
  const { isConnected, connection } = useAprimo()

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="max-w-2xl w-full text-center space-y-6">
          <h1 className="text-4xl font-bold tracking-tight">Aprimo Editor Tools</h1>
          <p className="text-lg text-muted-foreground">
            {isConnected
              ? "You're connected. Choose a tool below to get started."
              : "Connect to your Aprimo environment to get started. This application requires PKCE auth."}
          </p>
          {!isConnected && (
            <Button
              onClick={() => window.dispatchEvent(new Event("aprimo:open-config"))}
            >
              Connect to Aprimo
            </Button>
          )}
          {isConnected && (
            <div className="grid gap-4 sm:grid-cols-2">
              <a href={`https://${connection?.environment}.dam.aprimo.com/dam`}>
                <div className="border border-border rounded-lg p-6 text-left hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <House className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Aprimo Home</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Go to the Spaces page for your Aprimo environment.
                  </p>
                </div>
              </a>
              <Link href="/video-studio">
                <div className="border border-border rounded-lg p-6 text-left hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <Clapperboard className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Video Studio</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Select assets from Aprimo and generate a video.
                  </p>
                </div>
              </Link>
              <Link href="/templates">
                <div className="border border-border rounded-lg p-6 text-left hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <LayoutTemplate className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Dynamic Content</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Build multi-format banners from a single asset and publish renditions back to the DAM.
                  </p>
                </div>
              </Link>
              <Link href="/bulk-upload">
                <div className="border border-border rounded-lg p-6 text-left hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <Upload className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Bulk Upload</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Upload files into Aprimo with shared or per-asset field values.
                  </p>
                </div>
              </Link>
              <Link href="/excel-import">
                <div className="border border-border rounded-lg p-6 text-left hover:bg-muted/50 transition-colors cursor-pointer">
                  <div className="flex items-center gap-3 mb-2">
                    <FileSpreadsheet className="h-5 w-5 text-primary" />
                    <h2 className="text-lg font-semibold">Excel Import</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Import records into Aprimo from an Excel spreadsheet.
                  </p>
                </div>
              </Link>
            </div>
          )}
        </div>
      </main>
      <Footer />
    </div>
  )
}
