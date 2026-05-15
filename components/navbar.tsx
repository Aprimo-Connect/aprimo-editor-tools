"use client"

import { Wifi, WifiOff, Settings } from "lucide-react"
import Link from "next/link"
import { useAprimo } from "@/context/aprimo-context"
import { Badge } from "@/components/ui/badge"
import { PageHeader } from "@/components/page-header"
import Image from "next/image"

export interface NavbarProps {
  /** When false, the breadcrumb sub-bar is suppressed. Default: true. */
  showPageHeader?: boolean
}

const ALL_FROM_ENV = !!(
  process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT &&
  process.env.NEXT_PUBLIC_APRIMO_CLIENT_ID &&
  process.env.NEXT_PUBLIC_APRIMO_CLIENT_SECRET
)

export function Navbar({ showPageHeader = true }: NavbarProps = {}) {
  const { isConnected, connection } = useAprimo()

  return (
    <nav className="bg-background sticky top-0 z-50">
      <div className="border-b border-border px-6">
        <div className="flex items-center justify-between h-20">
          <Link href="/" className="py-2">
            <Image src="/images/aprimo-extensions-logo-sm.png" alt="Aprimo Extensions" width={0} height={0} style={{ width: 160, height: "auto" }} loading="eager" priority />
          </Link>

          <div className="flex items-center gap-6 text-sm">
            {isConnected && (
              <Link href="/bulk-upload" className="text-muted-foreground hover:text-foreground transition-colors">
                Bulk Upload
              </Link>
            )}
            {isConnected && (
              <Link href="/excel-import" className="text-muted-foreground hover:text-foreground transition-colors">
                Excel Import
              </Link>
            )}
            {isConnected && (
              <Link href="/video-studio" className="text-muted-foreground hover:text-foreground transition-colors">
                Video Studio
              </Link>
            )}
            {isConnected && (
              <Link href="/templates" className="text-muted-foreground hover:text-foreground transition-colors">
                Dynamic Content
              </Link>
            )}
            {isConnected && connection?.environment && (
              <a
                href={`https://${connection.environment}.dam.aprimo.com/dam`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                Aprimo Home
              </a>
            )}
            {isConnected ? (
              <Badge variant="outline" className="flex items-center gap-1.5 border-success text-success">
                <Wifi className="h-3 w-3" />
                {connection?.environment}
              </Badge>
            ) : (
              <Badge variant="outline" className="flex items-center gap-1.5 border-muted-foreground text-muted-foreground">
                <WifiOff className="h-3 w-3" />
                Disconnected
              </Badge>
            )}
            {!ALL_FROM_ENV && isConnected && (
              <button
                onClick={() => window.dispatchEvent(new Event("aprimo:open-config"))}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Connections"
              >
                <Settings className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {showPageHeader && <PageHeader />}
    </nav>
  )
}
